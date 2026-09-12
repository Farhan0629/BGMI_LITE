/**
 * Analytic terrain heightfield.
 *
 * `heightAt` is the single source of truth: the render mesh, character
 * physics, prop placement and AI navigation all sample the same function, so
 * nothing can ever be out of sync with what the player sees.
 */
import { fbm2D } from "../core/random.js"
import { smoothstep, clamp } from "../core/math.js"
import { REGIONS, WATER_LEVEL } from "./regions.js"
import { GAME } from "../config/game.js"

const ISLAND_RADIUS = (GAME.worldSize / 2) * 0.82

export function heightAt(x, z) {
	// Base rolling terrain.
	let h = (fbm2D(x * 0.0024 + 12.3, z * 0.0024 - 5.7, 4) - 0.42) * 40
	h += (fbm2D(x * 0.011 - 3.1, z * 0.011 + 7.9, 3) - 0.5) * 5.5

	for (let i = 0; i < REGIONS.length; i++) {
		const r = REGIONS[i]
		const d = Math.hypot(x - r.x, z - r.z)
		if (d > r.radius * 1.2) continue
		if (r.flatten > 0) {
			// Built-up areas are levelled into a plateau with a soft apron.
			const t = smoothstep(r.flatten * 1.25, r.flatten * 0.6, d)
			h = h + (r.height - h) * t
		} else {
			// Natural regions add elevation instead of replacing it.
			const t = smoothstep(r.radius, r.radius * 0.18, d)
			h += r.height * t * r.weight
		}
	}

	// Island falloff into the ocean.
	const rr = Math.hypot(x, z)
	const edge = smoothstep(ISLAND_RADIUS * 0.84, ISLAND_RADIUS * 1.04, rr)
	h = h + (-14 - h) * edge

	return h
}

export function slopeAt(x, z) {
	const e = 1.5
	const hx = heightAt(x + e, z) - heightAt(x - e, z)
	const hz = heightAt(x, z + e) - heightAt(x, z - e)
	return Math.hypot(hx, hz) / (2 * e)
}

export function isWater(x, z) {
	return heightAt(x, z) < WATER_LEVEL
}

/** Surface material used for footstep audio and impact particles. */
export function terrainSurface(x, z) {
	const h = heightAt(x, z)
	if (h < WATER_LEVEL + 0.25) return "water"
	if (h < 3.2) return "dirt"
	return slopeAt(x, z) > 0.45 ? "dirt" : "grass"
}

/**
 * Build an indexed triangle mesh for the island.
 * Uses Uint32 indices (WebGL2 supports them natively) so one draw call covers
 * the whole terrain.
 */
export function buildTerrainMesh(segments, worldSize = GAME.worldSize) {
	const verts = segments + 1
	const positions = new Float32Array(verts * verts * 3)
	const normals = new Float32Array(verts * verts * 3)
	const indices = new Uint32Array(segments * segments * 6)
	const half = worldSize / 2
	const step = worldSize / segments

	let p = 0
	for (let z = 0; z < verts; z++) {
		for (let x = 0; x < verts; x++) {
			const wx = -half + x * step
			const wz = -half + z * step
			positions[p] = wx
			positions[p + 1] = heightAt(wx, wz)
			positions[p + 2] = wz
			p += 3
		}
	}

	// Central-difference normals from the analytic height function.
	p = 0
	for (let z = 0; z < verts; z++) {
		for (let x = 0; x < verts; x++) {
			const wx = -half + x * step
			const wz = -half + z * step
			const hl = heightAt(wx - step, wz)
			const hr = heightAt(wx + step, wz)
			const hd = heightAt(wx, wz - step)
			const hu = heightAt(wx, wz + step)
			let nx = hl - hr
			let ny = 2 * step
			let nz = hd - hu
			const len = Math.hypot(nx, ny, nz) || 1
			normals[p] = nx / len
			normals[p + 1] = ny / len
			normals[p + 2] = nz / len
			p += 3
		}
	}

	let i = 0
	for (let z = 0; z < segments; z++) {
		for (let x = 0; x < segments; x++) {
			const a = z * verts + x
			indices[i++] = a
			indices[i++] = a + verts
			indices[i++] = a + 1
			indices[i++] = a + 1
			indices[i++] = a + verts
			indices[i++] = a + verts + 1
		}
	}

	return { positions, normals, indices }
}

/** Clamp a position inside the playable ring. */
export function clampToIsland(x, z) {
	const limit = ISLAND_RADIUS * 0.86
	const r = Math.hypot(x, z)
	if (r <= limit) return { x, z }
	const s = limit / r
	return { x: x * s, z: z * s }
}

export function islandRadius() {
	return ISLAND_RADIUS
}

export function safeGround(x, z) {
	return clamp(heightAt(x, z), WATER_LEVEL, 1e4)
}
