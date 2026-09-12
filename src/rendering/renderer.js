/**
 * WebGL2 renderer.
 *
 * Design notes
 *  - One instanced draw call per geometry primitive per frame. Static world
 *    chunks are frustum + distance culled on the CPU, then copied into a
 *    persistent scratch buffer together with dynamic instances and uploaded
 *    once per geometry.
 *  - Passes: shadow depth -> sky -> terrain -> instanced meshes -> water ->
 *    particles (additive + alpha) -> post processing.
 *  - Quality presets change shadow resolution, view distance, particle budget,
 *    device pixel ratio cap and whether the post stack runs at all.
 */
import { GEOMETRIES } from "./geometry.js"
import { INSTANCE_STRIDE } from "./scene.js"
import { QUALITY, RENDER } from "../config/graphics.js"
import {
	MESH_VS, MESH_FS, DEPTH_VS, DEPTH_PLAIN_VS, DEPTH_FS,
	TERRAIN_VS, TERRAIN_FS, WATER_VS, WATER_FS, SKY_VS, SKY_FS,
	PARTICLE_VS, PARTICLE_FS, POST_VS, POST_FS,
} from "./shaders.js"
import {
	mat4, mat4Compose, mat4Identity, mat4Invert, mat4LookAt,
	mat4Multiply, mat4Ortho, mat4Perspective, clamp,
} from "../core/math.js"

const INSTANCE_BYTES = INSTANCE_STRIDE * 4

function compile(gl, type, source, label) {
	const shader = gl.createShader(type)
	gl.shaderSource(shader, source)
	gl.compileShader(shader)
	if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
		const log = gl.getShaderInfoLog(shader)
		gl.deleteShader(shader)
		throw new Error(`[renderer] ${label} shader failed to compile: ${log}`)
	}
	return shader
}

function createProgram(gl, vsSource, fsSource, label) {
	const vs = compile(gl, gl.VERTEX_SHADER, vsSource, label + " vertex")
	const fs = compile(gl, gl.FRAGMENT_SHADER, fsSource, label + " fragment")
	const program = gl.createProgram()
	gl.attachShader(program, vs)
	gl.attachShader(program, fs)
	gl.linkProgram(program)
	gl.deleteShader(vs)
	gl.deleteShader(fs)
	if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
		const log = gl.getProgramInfoLog(program)
		throw new Error(`[renderer] ${label} program failed to link: ${log}`)
	}
	return { program, uniforms: new Map() }
}

export class Renderer {
	constructor(canvas, qualityName = "high") {
		this.canvas = canvas
		const gl = canvas.getContext("webgl2", {
			antialias: false,
			alpha: false,
			depth: true,
			stencil: false,
			powerPreference: "high-performance",
			preserveDrawingBuffer: false,
		})
		if (!gl) throw new Error("WEBGL2_UNAVAILABLE")
		this.gl = gl
		this.floatColor = !!gl.getExtension("EXT_color_buffer_float")

		this.programs = {
			mesh: createProgram(gl, MESH_VS, MESH_FS, "mesh"),
			depth: createProgram(gl, DEPTH_VS, DEPTH_FS, "depth"),
			depthPlain: createProgram(gl, DEPTH_PLAIN_VS, DEPTH_FS, "depthPlain"),
			terrain: createProgram(gl, TERRAIN_VS, TERRAIN_FS, "terrain"),
			water: createProgram(gl, WATER_VS, WATER_FS, "water"),
			sky: createProgram(gl, SKY_VS, SKY_FS, "sky"),
			particle: createProgram(gl, PARTICLE_VS, PARTICLE_FS, "particle"),
			post: createProgram(gl, POST_VS, POST_FS, "post"),
		}

		this.geoms = new Map()
		for (const name of Object.keys(GEOMETRIES)) this.createGeometry(name, GEOMETRIES[name])

		this.quad = this.createQuad()
		this.water = this.createWaterGrid(64, 900)
		this.terrain = null

		this.particleBuffers = {
			additive: this.createParticleBuffer(RENDER.particleCapacity),
			alpha: this.createParticleBuffer(RENDER.particleCapacity),
		}

		// Matrices reused every frame (no per-frame allocation).
		this.view = mat4()
		this.proj = mat4()
		this.viewProj = mat4()
		this.invViewProj = mat4()
		this.shadowView = mat4()
		this.shadowProj = mat4()
		this.shadowViewProj = mat4()
		this.tmpMat = mat4()
		this.frustum = new Float32Array(24)
		this.lightPos = new Float32Array(RENDER.maxLights * 4)
		this.lightColor = new Float32Array(RENDER.maxLights * 3)

		this.scratch = new Map()
		this.visibleChunks = []

		this.shadow = null
		this.sceneTarget = null
		this.width = 1
		this.height = 1
		this.dpr = 1
		this.stats = { drawCalls: 0, instances: 0, chunks: 0, particles: 0, triangles: 0 }

		this.setQuality(qualityName)
		this.resize()

		gl.enable(gl.DEPTH_TEST)
		gl.enable(gl.CULL_FACE)
		gl.cullFace(gl.BACK)
		gl.clearColor(0.5, 0.6, 0.7, 1)
	}

	// ----------------------------------------------------------------- buffers

	createGeometry(name, data) {
		const gl = this.gl
		const vao = gl.createVertexArray()
		gl.bindVertexArray(vao)

		const posBuf = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, posBuf)
		gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW)
		gl.enableVertexAttribArray(0)
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)

		const normBuf = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, normBuf)
		gl.bufferData(gl.ARRAY_BUFFER, data.normals, gl.STATIC_DRAW)
		gl.enableVertexAttribArray(1)
		gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0)

		const instBuf = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, instBuf)
		gl.bufferData(gl.ARRAY_BUFFER, 1024 * INSTANCE_BYTES, gl.DYNAMIC_DRAW)
		for (let i = 0; i < 4; i++) {
			const loc = 2 + i
			gl.enableVertexAttribArray(loc)
			gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, INSTANCE_BYTES, i * 16)
			gl.vertexAttribDivisor(loc, 1)
		}
		gl.enableVertexAttribArray(6)
		gl.vertexAttribPointer(6, 4, gl.FLOAT, false, INSTANCE_BYTES, 64)
		gl.vertexAttribDivisor(6, 1)
		gl.enableVertexAttribArray(7)
		gl.vertexAttribPointer(7, 4, gl.FLOAT, false, INSTANCE_BYTES, 80)
		gl.vertexAttribDivisor(7, 1)

		const idxBuf = gl.createBuffer()
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf)
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW)

		gl.bindVertexArray(null)
		this.geoms.set(name, {
			vao, instBuf, indexCount: data.indices.length, capacity: 1024,
			doubleSided: name === "card" || name === "plane",
		})
	}

	createQuad() {
		const gl = this.gl
		const vao = gl.createVertexArray()
		gl.bindVertexArray(vao)
		const buf = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, buf)
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
		gl.enableVertexAttribArray(0)
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
		gl.bindVertexArray(null)
		return { vao }
	}

	createWaterGrid(segments, span) {
		const gl = this.gl
		const verts = []
		const idx = []
		const half = span / 2
		for (let z = 0; z <= segments; z++) {
			for (let x = 0; x <= segments; x++) {
				verts.push((x / segments) * span - half, (z / segments) * span - half)
			}
		}
		const stride = segments + 1
		for (let z = 0; z < segments; z++) {
			for (let x = 0; x < segments; x++) {
				const a = z * stride + x
				idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1)
			}
		}
		const vao = gl.createVertexArray()
		gl.bindVertexArray(vao)
		const vbo = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
		gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.STATIC_DRAW)
		gl.enableVertexAttribArray(0)
		gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
		const ibo = gl.createBuffer()
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW)
		gl.bindVertexArray(null)
		return { vao, count: idx.length }
	}

	createParticleBuffer(capacity) {
		const gl = this.gl
		const vao = gl.createVertexArray()
		gl.bindVertexArray(vao)
		const buf = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, buf)
		gl.bufferData(gl.ARRAY_BUFFER, capacity * 32, gl.DYNAMIC_DRAW)
		gl.enableVertexAttribArray(0)
		gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 32, 0)
		gl.enableVertexAttribArray(1)
		gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 32, 16)
		gl.bindVertexArray(null)
		return { vao, buf, capacity }
	}

	/** Upload a generated terrain mesh. Called once per match. */
	uploadTerrain(mesh) {
		const gl = this.gl
		if (this.terrain) {
			gl.deleteVertexArray(this.terrain.vao)
		}
		const vao = gl.createVertexArray()
		gl.bindVertexArray(vao)
		const pos = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, pos)
		gl.bufferData(gl.ARRAY_BUFFER, mesh.positions, gl.STATIC_DRAW)
		gl.enableVertexAttribArray(0)
		gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0)
		const nor = gl.createBuffer()
		gl.bindBuffer(gl.ARRAY_BUFFER, nor)
		gl.bufferData(gl.ARRAY_BUFFER, mesh.normals, gl.STATIC_DRAW)
		gl.enableVertexAttribArray(1)
		gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0)
		const ibo = gl.createBuffer()
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo)
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW)
		gl.bindVertexArray(null)
		this.terrain = { vao, count: mesh.indices.length }
	}

	// --------------------------------------------------------------- pipeline

	setQuality(name) {
		this.qualityName = QUALITY[name] ? name : "high"
		this.quality = QUALITY[this.qualityName]
		this.createShadowTarget(this.quality.shadowMapSize)
		this.resize()
	}

	createShadowTarget(size) {
		const gl = this.gl
		if (this.shadow) {
			gl.deleteFramebuffer(this.shadow.fbo)
			gl.deleteTexture(this.shadow.texture)
			this.shadow = null
		}
		if (!size) return
		const texture = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_2D, texture)
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		const fbo = gl.createFramebuffer()
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, texture, 0)
		gl.bindFramebuffer(gl.FRAMEBUFFER, null)
		this.shadow = { fbo, texture, size }
	}

	createSceneTarget(width, height) {
		const gl = this.gl
		if (this.sceneTarget) {
			gl.deleteFramebuffer(this.sceneTarget.fbo)
			gl.deleteTexture(this.sceneTarget.color)
			gl.deleteRenderbuffer(this.sceneTarget.depth)
			this.sceneTarget = null
		}
		if (!this.quality.post) return
		const color = gl.createTexture()
		gl.bindTexture(gl.TEXTURE_2D, color)
		const internal = this.floatColor ? gl.RGBA16F : gl.RGBA8
		const type = this.floatColor ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE
		gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, null)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
		const depth = gl.createRenderbuffer()
		gl.bindRenderbuffer(gl.RENDERBUFFER, depth)
		gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height)
		const fbo = gl.createFramebuffer()
		gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
		gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0)
		gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth)
		const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
		gl.bindFramebuffer(gl.FRAMEBUFFER, null)
		if (!ok) {
			console.warn("[renderer] post-processing framebuffer incomplete, falling back to direct rendering")
			return
		}
		this.sceneTarget = { fbo, color, depth, width, height }
	}

	/** Match the drawing buffer to the CSS size and device pixel ratio. */
	resize() {
		const dpr = Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap)
		const cssWidth = this.canvas.clientWidth || window.innerWidth
		const cssHeight = this.canvas.clientHeight || window.innerHeight
		const width = Math.max(1, Math.floor(cssWidth * dpr))
		const height = Math.max(1, Math.floor(cssHeight * dpr))
		if (width === this.width && height === this.height && dpr === this.dpr) return
		this.canvas.width = width
		this.canvas.height = height
		this.width = width
		this.height = height
		this.dpr = dpr
		this.createSceneTarget(width, height)
	}

	getUniform(entry, name) {
		let loc = entry.uniforms.get(name)
		if (loc === undefined) {
			loc = this.gl.getUniformLocation(entry.program, name)
			entry.uniforms.set(name, loc)
		}
		return loc
	}

	/** Extract the six frustum planes from a view-projection matrix. */
	extractFrustum(m) {
		const f = this.frustum
		const rows = [
			[m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]],
			[m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]],
			[m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]],
			[m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]],
			[m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]],
			[m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]],
		]
		for (let i = 0; i < 6; i++) {
			const r = rows[i]
			const len = Math.hypot(r[0], r[1], r[2]) || 1
			f[i * 4] = r[0] / len
			f[i * 4 + 1] = r[1] / len
			f[i * 4 + 2] = r[2] / len
			f[i * 4 + 3] = r[3] / len
		}
	}

	sphereVisible(x, y, z, radius) {
		const f = this.frustum
		for (let i = 0; i < 6; i++) {
			const d = f[i * 4] * x + f[i * 4 + 1] * y + f[i * 4 + 2] * z + f[i * 4 + 3]
			if (d < -radius) return false
		}
		return true
	}

	getScratch(name, floats) {
		let entry = this.scratch.get(name)
		if (!entry) {
			entry = { array: new Float32Array(Math.max(floats, 1024 * INSTANCE_STRIDE)), count: 0 }
			this.scratch.set(name, entry)
		}
		if (entry.array.length < floats) {
			entry.array = new Float32Array(Math.ceil(floats * 1.5))
		}
		return entry
	}

	/**
	 * Cull static chunks, merge with dynamic instances and upload one instance
	 * buffer per geometry. Returns the list of geometries with instances.
	 */
	prepareInstances(scene, camX, camY, camZ) {
		const gl = this.gl
		const viewDistance = this.quality.viewDistance
		this.visibleChunks.length = 0
		for (const chunk of scene.chunks.values()) {
			const dx = chunk.centerX - camX
			const dz = chunk.centerZ - camZ
			if (dx * dx + dz * dz > (viewDistance + chunk.radius) * (viewDistance + chunk.radius)) continue
			if (!this.sphereVisible(chunk.centerX, chunk.centerY, chunk.centerZ, chunk.radius)) continue
			this.visibleChunks.push(chunk)
		}
		this.stats.chunks = this.visibleChunks.length

		const counts = new Map()
		for (const chunk of this.visibleChunks) {
			for (const [geom, batch] of chunk.batches) {
				counts.set(geom, (counts.get(geom) || 0) + batch.count)
			}
		}
		for (const [geom, entry] of scene.dynamic) {
			if (entry.count > 0) counts.set(geom, (counts.get(geom) || 0) + entry.count)
		}

		const active = []
		let totalInstances = 0
		for (const [geom, count] of counts) {
			const record = this.geoms.get(geom)
			if (!record || count === 0) continue
			const scratch = this.getScratch(geom, count * INSTANCE_STRIDE)
			let offset = 0
			for (const chunk of this.visibleChunks) {
				const batch = chunk.batches.get(geom)
				if (!batch || !batch.array) continue
				scratch.array.set(batch.array, offset)
				offset += batch.array.length
			}
			const dyn = scene.dynamic.get(geom)
			if (dyn && dyn.count > 0) {
				scratch.array.set(dyn.data.subarray(0, dyn.count * INSTANCE_STRIDE), offset)
				offset += dyn.count * INSTANCE_STRIDE
			}
			const instanceCount = offset / INSTANCE_STRIDE
			if (instanceCount === 0) continue
			gl.bindBuffer(gl.ARRAY_BUFFER, record.instBuf)
			if (instanceCount > record.capacity) {
				record.capacity = Math.ceil(instanceCount * 1.4)
				gl.bufferData(gl.ARRAY_BUFFER, record.capacity * INSTANCE_BYTES, gl.DYNAMIC_DRAW)
			}
			gl.bufferSubData(gl.ARRAY_BUFFER, 0, scratch.array, 0, offset)
			active.push({ geom, record, instanceCount })
			totalInstances += instanceCount
		}
		this.stats.instances = totalInstances
		return active
	}

	drawInstanced(active, program) {
		const gl = this.gl
		for (const item of active) {
			if (item.record.doubleSided) gl.disable(gl.CULL_FACE)
			gl.bindVertexArray(item.record.vao)
			gl.drawElementsInstanced(gl.TRIANGLES, item.record.indexCount, gl.UNSIGNED_SHORT, 0, item.instanceCount)
			if (item.record.doubleSided) gl.enable(gl.CULL_FACE)
			this.stats.drawCalls++
		}
		gl.bindVertexArray(null)
		void program
	}

	setLightingUniforms(entry, env, camera) {
		const gl = this.gl
		gl.uniform3f(this.getUniform(entry, "uSunDir"), env.sunDir[0], env.sunDir[1], env.sunDir[2])
		gl.uniform3f(this.getUniform(entry, "uSunColor"), env.sunColor[0], env.sunColor[1], env.sunColor[2])
		gl.uniform3f(this.getUniform(entry, "uAmbientSky"), env.ambientSky[0], env.ambientSky[1], env.ambientSky[2])
		gl.uniform3f(this.getUniform(entry, "uAmbientGround"), env.ambientGround[0], env.ambientGround[1], env.ambientGround[2])
		gl.uniform3f(this.getUniform(entry, "uFogColor"), env.fogColor[0], env.fogColor[1], env.fogColor[2])
		gl.uniform1f(this.getUniform(entry, "uFogDensity"), env.fogDensity)
		gl.uniform1f(this.getUniform(entry, "uFogHeight"), env.fogHeight || 26)
		gl.uniform3f(this.getUniform(entry, "uCamPos"), camera.x, camera.y, camera.z)
		gl.uniformMatrix4fv(this.getUniform(entry, "uShadowMatrix"), false, this.shadowViewProj)
		gl.uniform1f(this.getUniform(entry, "uShadowEnabled"), this.shadow ? 1 : 0)
		if (this.shadow) {
			gl.activeTexture(gl.TEXTURE0)
			gl.bindTexture(gl.TEXTURE_2D, this.shadow.texture)
			gl.uniform1i(this.getUniform(entry, "uShadowMap"), 0)
		}
		gl.uniform1i(this.getUniform(entry, "uLightCount"), this.activeLightCount)
		if (this.activeLightCount > 0) {
			gl.uniform4fv(this.getUniform(entry, "uLightPos"), this.lightPos)
			gl.uniform3fv(this.getUniform(entry, "uLightColor"), this.lightColor)
		}
	}

	/** Pick the closest dynamic lights and pack them into uniform arrays. */
	packLights(lights, camX, camY, camZ) {
		const max = RENDER.maxLights
		let count = 0
		if (lights && lights.length) {
			const sorted = lights
				.filter((l) => l.intensity > 0.001)
				.map((l) => ({ l, d: (l.x - camX) ** 2 + (l.y - camY) ** 2 + (l.z - camZ) ** 2 }))
				.sort((a, b) => a.d - b.d)
			for (const item of sorted) {
				if (count >= max) break
				const l = item.l
				if (Math.sqrt(item.d) - l.range > this.quality.viewDistance) continue
				this.lightPos[count * 4] = l.x
				this.lightPos[count * 4 + 1] = l.y
				this.lightPos[count * 4 + 2] = l.z
				this.lightPos[count * 4 + 3] = l.range
				this.lightColor[count * 3] = l.r * l.intensity
				this.lightColor[count * 3 + 1] = l.g * l.intensity
				this.lightColor[count * 3 + 2] = l.b * l.intensity
				count++
			}
		}
		for (let i = count; i < max; i++) {
			this.lightPos[i * 4 + 3] = 0
			this.lightColor[i * 3] = 0
			this.lightColor[i * 3 + 1] = 0
			this.lightColor[i * 3 + 2] = 0
		}
		this.activeLightCount = count
	}

	computeShadowMatrix(camera, env) {
		if (!this.shadow) {
			mat4Identity(this.shadowViewProj)
			return
		}
		const d = this.quality.shadowDistance
		const forwardX = Math.sin(camera.yaw) * Math.cos(camera.pitch)
		const forwardZ = -Math.cos(camera.yaw) * Math.cos(camera.pitch)
		// Snap the focus point to texel-ish increments to reduce shadow crawling.
		const step = d / 64
		const fx = Math.round((camera.x + forwardX * d * 0.35) / step) * step
		const fz = Math.round((camera.z + forwardZ * d * 0.35) / step) * step
		const fy = camera.y
		const sx = fx + env.sunDir[0] * d
		const sy = fy + Math.max(env.sunDir[1], 0.22) * d
		const sz = fz + env.sunDir[2] * d
		mat4LookAt(this.shadowView, sx, sy, sz, fx, fy, fz)
		mat4Ortho(this.shadowProj, -d, d, -d, d, 1, d * 3.4)
		mat4Multiply(this.shadowViewProj, this.shadowProj, this.shadowView)
	}

	// ------------------------------------------------------------------ render

	render(scene, camera, env, particles, lights, fx = {}) {
		const gl = this.gl
		this.stats.drawCalls = 0

		const aspect = this.width / Math.max(1, this.height)
		const fov = (camera.fov || RENDER.baseFov) * Math.PI / 180
		mat4Perspective(this.proj, fov, aspect, RENDER.near, RENDER.far)

		const cp = Math.cos(camera.pitch)
		const dirX = Math.sin(camera.yaw) * cp
		const dirY = Math.sin(camera.pitch)
		const dirZ = -Math.cos(camera.yaw) * cp
		mat4LookAt(this.view, camera.x, camera.y, camera.z,
			camera.x + dirX, camera.y + dirY, camera.z + dirZ)
		mat4Multiply(this.viewProj, this.proj, this.view)
		mat4Invert(this.invViewProj, this.viewProj)
		this.extractFrustum(this.viewProj)

		this.packLights(lights, camera.x, camera.y, camera.z)
		this.computeShadowMatrix(camera, env)

		const active = this.prepareInstances(scene, camera.x, camera.y, camera.z)

		// --- shadow depth pass
		if (this.shadow) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadow.fbo)
			gl.viewport(0, 0, this.shadow.size, this.shadow.size)
			gl.clear(gl.DEPTH_BUFFER_BIT)
			gl.colorMask(false, false, false, false)
			const depth = this.programs.depth
			gl.useProgram(depth.program)
			gl.uniformMatrix4fv(this.getUniform(depth, "uViewProj"), false, this.shadowViewProj)
			this.drawInstanced(active, depth)
			if (this.terrain) {
				const plain = this.programs.depthPlain
				gl.useProgram(plain.program)
				gl.uniformMatrix4fv(this.getUniform(plain, "uViewProj"), false, this.shadowViewProj)
				gl.bindVertexArray(this.terrain.vao)
				gl.drawElements(gl.TRIANGLES, this.terrain.count, gl.UNSIGNED_INT, 0)
				gl.bindVertexArray(null)
				this.stats.drawCalls++
			}
			gl.colorMask(true, true, true, true)
		}

		// --- main pass
		const target = this.sceneTarget
		gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null)
		gl.viewport(0, 0, this.width, this.height)
		gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

		// Sky
		const sky = this.programs.sky
		gl.useProgram(sky.program)
		gl.depthMask(false)
		gl.uniformMatrix4fv(this.getUniform(sky, "uInvViewProj"), false, this.invViewProj)
		gl.uniform3f(this.getUniform(sky, "uCamPos"), camera.x, camera.y, camera.z)
		gl.uniform3f(this.getUniform(sky, "uSunDir"), env.sunDir[0], env.sunDir[1], env.sunDir[2])
		gl.uniform3f(this.getUniform(sky, "uSunColor"), env.sunColor[0], env.sunColor[1], env.sunColor[2])
		gl.uniform3f(this.getUniform(sky, "uSkyTop"), env.skyTop[0], env.skyTop[1], env.skyTop[2])
		gl.uniform3f(this.getUniform(sky, "uSkyHorizon"), env.skyHorizon[0], env.skyHorizon[1], env.skyHorizon[2])
		gl.uniform3f(this.getUniform(sky, "uFogColor"), env.fogColor[0], env.fogColor[1], env.fogColor[2])
		gl.uniform1f(this.getUniform(sky, "uNight"), env.night)
		gl.bindVertexArray(this.quad.vao)
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
		gl.bindVertexArray(null)
		gl.depthMask(true)
		this.stats.drawCalls++

		// Terrain
		if (this.terrain) {
			const terrain = this.programs.terrain
			gl.useProgram(terrain.program)
			gl.uniformMatrix4fv(this.getUniform(terrain, "uViewProj"), false, this.viewProj)
			this.setLightingUniforms(terrain, env, camera)
			gl.bindVertexArray(this.terrain.vao)
			gl.drawElements(gl.TRIANGLES, this.terrain.count, gl.UNSIGNED_INT, 0)
			gl.bindVertexArray(null)
			this.stats.drawCalls++
		}

		// Instanced world + characters
		const mesh = this.programs.mesh
		gl.useProgram(mesh.program)
		gl.uniformMatrix4fv(this.getUniform(mesh, "uViewProj"), false, this.viewProj)
		gl.uniform1f(this.getUniform(mesh, "uTime"), env.time)
		gl.uniform1f(this.getUniform(mesh, "uWindStrength"), env.windStrength)
		this.setLightingUniforms(mesh, env, camera)
		this.drawInstanced(active, mesh)

		// Water
		if (scene.hasWater) {
			const water = this.programs.water
			gl.useProgram(water.program)
			gl.uniformMatrix4fv(this.getUniform(water, "uViewProj"), false, this.viewProj)
			gl.uniform3f(this.getUniform(water, "uCenter"), Math.round(camera.x), 0, Math.round(camera.z))
			gl.uniform1f(this.getUniform(water, "uTime"), env.time)
			gl.uniform1f(this.getUniform(water, "uWaterLevel"), scene.waterLevel)
			gl.uniform3f(this.getUniform(water, "uSkyColor"), env.skyHorizon[0], env.skyHorizon[1], env.skyHorizon[2])
			this.setLightingUniforms(water, env, camera)
			gl.disable(gl.CULL_FACE)
			gl.bindVertexArray(this.water.vao)
			gl.drawElements(gl.TRIANGLES, this.water.count, gl.UNSIGNED_INT, 0)
			gl.bindVertexArray(null)
			gl.enable(gl.CULL_FACE)
			this.stats.drawCalls++
		}

		// Particles
		if (particles) this.renderParticles(particles)

		// Post processing
		if (target) {
			gl.bindFramebuffer(gl.FRAMEBUFFER, null)
			gl.viewport(0, 0, this.width, this.height)
			const post = this.programs.post
			gl.useProgram(post.program)
			gl.activeTexture(gl.TEXTURE0)
			gl.bindTexture(gl.TEXTURE_2D, target.color)
			gl.uniform1i(this.getUniform(post, "uScene"), 0)
			gl.uniform2f(this.getUniform(post, "uTexel"), 1 / this.width, 1 / this.height)
			gl.uniform1f(this.getUniform(post, "uExposure"), (fx.exposure || RENDER.exposure))
			gl.uniform1f(this.getUniform(post, "uBloom"), this.quality.bloom ? (fx.bloom !== undefined ? fx.bloom : 0.55) : 0)
			gl.uniform1f(this.getUniform(post, "uVignette"), fx.vignette !== undefined ? fx.vignette : 0.32)
			gl.uniform1f(this.getUniform(post, "uDamage"), clamp(fx.damage || 0, 0, 1))
			gl.uniform1f(this.getUniform(post, "uSaturation"), fx.saturation !== undefined ? fx.saturation : 1.04)
			const grade = fx.grade || [1.02, 1.0, 0.97]
			gl.uniform3f(this.getUniform(post, "uGrade"), grade[0], grade[1], grade[2])
			gl.disable(gl.DEPTH_TEST)
			gl.bindVertexArray(this.quad.vao)
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
			gl.bindVertexArray(null)
			gl.enable(gl.DEPTH_TEST)
			this.stats.drawCalls++
		}
	}

	renderParticles(particles) {
		const gl = this.gl
		const program = this.programs.particle
		const total = particles.additiveCount + particles.alphaCount
		this.stats.particles = total
		if (total === 0) return
		gl.useProgram(program.program)
		gl.uniformMatrix4fv(this.getUniform(program, "uViewProj"), false, this.viewProj)
		gl.uniform1f(this.getUniform(program, "uViewportHeight"), this.height)
		gl.enable(gl.BLEND)
		gl.depthMask(false)

		if (particles.alphaCount > 0) {
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
			this.drawParticleBatch(this.particleBuffers.alpha, particles.alphaData, particles.alphaCount)
		}
		if (particles.additiveCount > 0) {
			gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
			this.drawParticleBatch(this.particleBuffers.additive, particles.additiveData, particles.additiveCount)
		}

		gl.depthMask(true)
		gl.disable(gl.BLEND)
	}

	drawParticleBatch(buffer, data, count) {
		const gl = this.gl
		const used = Math.min(count, buffer.capacity)
		gl.bindBuffer(gl.ARRAY_BUFFER, buffer.buf)
		gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, used * 8)
		gl.bindVertexArray(buffer.vao)
		gl.drawArrays(gl.POINTS, 0, used)
		gl.bindVertexArray(null)
		this.stats.drawCalls++
	}

	/** Convenience helper for one-off debug transforms. */
	composeMatrix(x, y, z, yaw, pitch, roll, sx, sy, sz) {
		return mat4Compose(this.tmpMat, x, y, z, yaw, pitch, roll, sx, sy, sz)
	}
}
