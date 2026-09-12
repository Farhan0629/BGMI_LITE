/**
 * Render data container.
 *
 * Static world geometry is bucketed into spatial chunks (for frustum and
 * distance culling) and, inside each chunk, into per-geometry instance
 * batches (for instanced drawing). Dynamic instances (characters, weapons,
 * loot beacons, vehicles) are rebuilt every frame into pre-allocated typed
 * arrays so the render loop produces no garbage.
 *
 * Instance attribute layout (24 floats):
 *   0-15  model matrix
 *   16-18 colour rgb
 *   19    roughness
 *   20    emissive
 *   21    wind amount
 *   22    baked ambient occlusion
 *   23    reserved
 */
export const INSTANCE_STRIDE = 24

export class Scene {
	constructor(chunkSize = 125, dynamicCapacity = 6000) {
		this.chunkSize = chunkSize
		this.dynamicCapacity = dynamicCapacity
		/** @type {Map<number, any>} */
		this.chunks = new Map()
		/** @type {Map<string, {data: Float32Array, count: number}>} */
		this.dynamic = new Map()
		this.terrain = null
		this.waterLevel = 0
		this.hasWater = false
		this.revision = 0
	}

	chunkKey(cx, cz) {
		return (cx + 512) * 1024 + (cz + 512)
	}

	addStatic(geom, m, r, g, b, roughness, emissive = 0, wind = 0, ao = 1) {
		const x = m[12], y = m[13], z = m[14]
		const cx = Math.floor(x / this.chunkSize)
		const cz = Math.floor(z / this.chunkSize)
		const key = this.chunkKey(cx, cz)
		let chunk = this.chunks.get(key)
		if (!chunk) {
			chunk = {
				cx, cz,
				centerX: (cx + 0.5) * this.chunkSize,
				centerZ: (cz + 0.5) * this.chunkSize,
				minY: y, maxY: y,
				batches: new Map(),
			}
			this.chunks.set(key, chunk)
		}
		if (y < chunk.minY) chunk.minY = y
		if (y > chunk.maxY) chunk.maxY = y
		let batch = chunk.batches.get(geom)
		if (!batch) {
			batch = { list: [], count: 0, array: null }
			chunk.batches.set(geom, batch)
		}
		for (let i = 0; i < 16; i++) batch.list.push(m[i])
		batch.list.push(r, g, b, roughness, emissive, wind, ao, 0)
		batch.count++
		batch.array = null
		this.revision++
	}

	/** Freeze static batches into typed arrays ready for GPU upload. */
	finalize() {
		for (const chunk of this.chunks.values()) {
			chunk.radius = Math.hypot(this.chunkSize, chunk.maxY - chunk.minY, this.chunkSize) * 0.62
			chunk.centerY = (chunk.minY + chunk.maxY) * 0.5
			for (const batch of chunk.batches.values()) {
				if (!batch.array) {
					batch.array = new Float32Array(batch.list)
					batch.list.length = 0
				}
			}
		}
		this.revision++
	}

	beginFrame() {
		for (const entry of this.dynamic.values()) entry.count = 0
	}

	addDynamic(geom, m, r, g, b, roughness, emissive = 0, wind = 0, ao = 1) {
		let entry = this.dynamic.get(geom)
		if (!entry) {
			entry = { data: new Float32Array(this.dynamicCapacity * INSTANCE_STRIDE), count: 0 }
			this.dynamic.set(geom, entry)
		}
		if (entry.count >= this.dynamicCapacity) return
		const o = entry.count * INSTANCE_STRIDE
		entry.data.set(m, o)
		entry.data[o + 16] = r
		entry.data[o + 17] = g
		entry.data[o + 18] = b
		entry.data[o + 19] = roughness
		entry.data[o + 20] = emissive
		entry.data[o + 21] = wind
		entry.data[o + 22] = ao
		entry.data[o + 23] = 0
		entry.count++
	}

	staticInstanceCount() {
		let total = 0
		for (const chunk of this.chunks.values()) for (const b of chunk.batches.values()) total += b.count
		return total
	}

	dynamicInstanceCount() {
		let total = 0
		for (const d of this.dynamic.values()) total += d.count
		return total
	}

	clear() {
		this.chunks.clear()
		this.dynamic.clear()
		this.terrain = null
		this.hasWater = false
		this.revision++
	}
}
