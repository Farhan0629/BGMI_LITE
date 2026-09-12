/**
 * World builder for RAVENFALL ISLAND.
 *
 * The build is split into labelled async steps so the loading screen can show
 * real progress ("LOADING RAVENFALL ISLAND ... 78%") without freezing the
 * main thread: the game loop awaits one step per animation frame.
 */
import { Scene } from "../rendering/scene.js"
import { CollisionWorld } from "../physics/collision.js"
import { Rng } from "../core/random.js"
import { GAME } from "../config/game.js"
import { REGIONS, WATER_LEVEL, regionAt } from "./regions.js"
import {
	buildTerrainMesh, heightAt, slopeAt, terrainSurface, islandRadius, clampToIsland,
} from "./terrain.js"
import { PropBuilder, MAT } from "./props.js"

const COVER_CELL = 22

export class World {
	constructor(seed = GAME.worldSeed) {
		this.rng = new Rng(seed)
		this.scene = new Scene(125, 6000)
		this.collision = new CollisionWorld(14)
		this.coverPoints = []
		this.coverGrid = new Map()
		this.lights = []
		this.lootSpawns = []
		this.spawns = []
		this.vehicleSpawns = []
		this.pois = []
		this.explosives = []
		this.terrain = null
		this.scene.hasWater = true
		this.scene.waterLevel = WATER_LEVEL
		this.props = new PropBuilder(this)
		this.radius = islandRadius()
		/** Scratch array reused by spatial queries to avoid per-call garbage. */
		this.queryScratch = []
	}

	// ------------------------------------------------------------- sampling

	groundAt(x, z) {
		return heightAt(x, z)
	}

	slopeAt(x, z) {
		return slopeAt(x, z)
	}

	surfaceAt(x, z) {
		return terrainSurface(x, z)
	}

	regionAt(x, z) {
		return regionAt(x, z)
	}

	clamp(x, z) {
		return clampToIsland(x, z)
	}

	inBounds(x, z) {
		return Math.hypot(x, z) < this.radius * 0.9
	}

	/** Land point away from water, used for spawning anything. */
	randomLandPoint(region, tries = 24) {
		for (let i = 0; i < tries; i++) {
			let x, z
			if (region) {
				const a = this.rng.angle()
				const r = Math.sqrt(this.rng.range(0, 1)) * region.radius
				x = region.x + Math.cos(a) * r
				z = region.z + Math.sin(a) * r
			} else {
				const a = this.rng.angle()
				const r = Math.sqrt(this.rng.range(0, 1)) * this.radius * 0.85
				x = Math.cos(a) * r
				z = Math.sin(a) * r
			}
			if (heightAt(x, z) > WATER_LEVEL + 0.6 && slopeAt(x, z) < 0.9) return { x, z }
		}
		return { x: 0, z: 0 }
	}

	/** Cover points near a position, using the uniform cover grid. */
	nearbyCover(x, z, radius, out = []) {
		out.length = 0
		const minX = Math.floor((x - radius) / COVER_CELL)
		const maxX = Math.floor((x + radius) / COVER_CELL)
		const minZ = Math.floor((z - radius) / COVER_CELL)
		const maxZ = Math.floor((z + radius) / COVER_CELL)
		const r2 = radius * radius
		for (let cz = minZ; cz <= maxZ; cz++) {
			for (let cx = minX; cx <= maxX; cx++) {
				const bucket = this.coverGrid.get(cx * 8192 + cz)
				if (!bucket) continue
				for (let i = 0; i < bucket.length; i++) {
					const c = bucket[i]
					const dx = c.x - x
					const dz = c.z - z
					if (dx * dx + dz * dz <= r2) out.push(c)
				}
			}
		}
		return out
	}

	buildCoverGrid() {
		this.coverGrid.clear()
		for (const c of this.coverPoints) {
			const key = Math.floor(c.x / COVER_CELL) * 8192 + Math.floor(c.z / COVER_CELL)
			let bucket = this.coverGrid.get(key)
			if (!bucket) {
				bucket = []
				this.coverGrid.set(key, bucket)
			}
			bucket.push(c)
		}
	}

	// ------------------------------------------------------------ build steps

	/**
	 * @param {number} terrainSegments mesh resolution from the quality preset
	 * @returns {Array<{label: string, run: () => void}>}
	 */
	buildSteps(terrainSegments) {
		const r = (id) => REGIONS.find((x) => x.id === id)
		return [
			{ label: "Shaping island terrain", run: () => { this.terrain = buildTerrainMesh(terrainSegments) } },
			{ label: "Raising RAVENFALL CITY", run: () => this.buildCity(r("city")) },
			{ label: "Fortifying OUTPOST GRAVEL", run: () => this.buildMilitary(r("militaryBase")) },
			{ label: "Assembling DRYDOCK WORKS", run: () => this.buildIndustrial(r("industrial")) },
			{ label: "Planting HOLLOW PINES", run: () => this.buildForest(r("forest")) },
			{ label: "Carving RAVEN RIDGE", run: () => this.buildMountain(r("mountain")) },
			{ label: "Flooding SALT PIER", run: () => this.buildCoast(r("coast")) },
			{ label: "Scattering wilderness detail", run: () => this.buildWilds() },
			{ label: "Baking spatial indices", run: () => this.finalize() },
		]
	}

	finalize() {
		this.scene.finalize()
		this.buildCoverGrid()
		this.buildSpawnRing()
	}

	/** Deployment ring: spread spawn points over land across the whole island. */
	buildSpawnRing() {
		this.spawns.length = 0
		const wanted = 40
		const pad = 2.5
		let guard = 0
		while (this.spawns.length < wanted && guard++ < 600) {
			const p = this.randomLandPoint(null)
			let ok = true
			for (const s of this.spawns) {
				if (Math.hypot(s.x - p.x, s.z - p.z) < 55) { ok = false; break }
			}
			if (!ok) continue
			// Reject spawn points that overlap solid geometry. queryRegion takes
			// an AABB in the XZ plane plus a reusable output array.
			const blockers = this.collision.queryRegion(
				p.x - pad, p.z - pad, p.x + pad, p.z + pad, this.queryScratch)
			if (blockers.length > 0) continue
			this.spawns.push({ x: p.x, z: p.z })
		}
		// Guarantee at least one spawn so a degenerate world still deploys.
		if (this.spawns.length === 0) {
			const p = this.randomLandPoint(null)
			this.spawns.push({ x: p.x, z: p.z })
		}
	}

	// ---------------------------------------------------------------- regions

	buildCity(region) {
		const P = this.props
		const rng = this.rng
		const blocks = 4
		const spacing = 62
		const origin = { x: region.x - (blocks - 1) * spacing * 0.5, z: region.z - (blocks - 1) * spacing * 0.5 }

		// Street grid.
		for (let i = 0; i < blocks; i++) {
			const offset = origin.x + i * spacing + spacing * 0.5
			P.roadStrip(offset, region.z, spacing * blocks, 0, 9)
			P.roadStrip(region.x, origin.z + i * spacing + spacing * 0.5, spacing * blocks, Math.PI / 2, 9)
		}

		// City blocks: 1-3 buildings each, alleys between.
		for (let bx = 0; bx < blocks; bx++) {
			for (let bz = 0; bz < blocks; bz++) {
				const cx = origin.x + bx * spacing
				const cz = origin.z + bz * spacing
				if (Math.hypot(cx - region.x, cz - region.z) > region.radius * 0.95) continue
				const count = rng.int(1, 3)
				for (let i = 0; i < count; i++) {
					const ox = rng.range(-14, 14)
					const oz = rng.range(-14, 14)
					const w = rng.range(12, 20)
					const d = rng.range(12, 20)
					P.building(cx + ox, cz + oz, w, d, rng.int(2, 5), {
						lootTable: "city", lit: true, label: "APARTMENTS",
						yaw: rng.chance(0.5) ? 0 : Math.PI / 2,
					})
				}
				// Block dressing.
				for (let i = 0; i < rng.int(1, 3); i++) {
					const p = { x: cx + rng.range(-24, 24), z: cz + rng.range(-24, 24) }
					P.car(p.x, p.z, rng.angle())
				}
				if (rng.chance(0.7)) P.dumpster(cx + rng.range(-22, 22), cz + rng.range(-22, 22), rng.angle())
				if (rng.chance(0.8)) P.debris(cx + rng.range(-20, 20), cz + rng.range(-20, 20), rng.int(3, 7))
				if (rng.chance(0.6)) P.barrier(cx + rng.range(-26, 26), cz + rng.range(-26, 26), rng.angle())
				if (rng.chance(0.5)) P.sign(cx + rng.range(-26, 26), cz + rng.range(-26, 26), rng.angle())
				for (let i = 0; i < 2; i++) {
					P.crate(cx + rng.range(-24, 24), cz + rng.range(-24, 24))
				}
				if (rng.chance(0.35)) P.barrel(cx + rng.range(-24, 24), cz + rng.range(-24, 24), true)
			}
		}

		// Street lamps and power lines along the main avenues.
		for (let i = 0; i < blocks * 4; i++) {
			const along = origin.z + rng.range(0, spacing * blocks)
			const lane = origin.x + rng.int(0, blocks - 1) * spacing + spacing * 0.5
			P.streetLamp(lane + 5.5, along, rng.chance(0.5) ? Math.PI : 0)
		}
		let prev = null
		for (let i = 0; i < 10; i++) {
			const x = region.x - 120 + i * 26
			const z = region.z + 96
			P.utilityPole(x, z)
			const y = this.groundAt(x, z) + 8.2
			if (prev) P.powerCable(prev.x, prev.z, x, z, y)
			prev = { x, z }
		}
		this.vehicleSpawns.push({ x: region.x + 30, z: region.z + 40 })
		this.pois.push({ x: region.x, z: region.z, label: region.label, name: region.label, height: 20, major: true })
	}

	buildMilitary(region) {
		const P = this.props
		const rng = this.rng
		const half = 92

		// Perimeter fence with a gate gap on each side.
		const corners = [
			[region.x - half, region.z - half], [region.x + half, region.z - half],
			[region.x + half, region.z + half], [region.x - half, region.z + half],
		]
		for (let i = 0; i < 4; i++) {
			const a = corners[i]
			const b = corners[(i + 1) % 4]
			const mx = (a[0] + b[0]) / 2
			const mz = (a[1] + b[1]) / 2
			P.fenceLine(a[0], a[1], mx + (a[0] - mx) * 0.15, mz + (a[1] - mz) * 0.15)
			P.fenceLine(mx + (b[0] - mx) * 0.15, mz + (b[1] - mz) * 0.15, b[0], b[1])
		}
		for (const c of corners) P.watchTower(c[0] * 0.985 + region.x * 0.015, c[1] * 0.985 + region.z * 0.015)

		// Barracks row.
		for (let i = 0; i < 3; i++) {
			P.building(region.x - 50, region.z - 50 + i * 30, 26, 14, 1, {
				lootTable: "military", label: "BARRACKS", mat: MAT.olive, stairs: false, floorHeight: 4.2,
			})
		}
		// Warehouses and control building.
		P.building(region.x + 38, region.z - 30, 40, 26, 1, {
			lootTable: "military", label: "WAREHOUSE", mat: MAT.metal, floorHeight: 8, openFront: true,
		})
		P.building(region.x + 20, region.z + 46, 22, 22, 3, {
			lootTable: "military", label: "CONTROL", mat: MAT.concrete, lit: true,
		})
		P.radarDish(region.x - 10, region.z + 70)
		P.helipad(region.x + 62, region.z + 52)

		// Vehicle park, containers, sandbag-style barriers.
		for (let i = 0; i < 5; i++) P.militaryTruck(region.x - 20 + i * 9, region.z + 10, Math.PI / 2)
		for (let i = 0; i < 14; i++) {
			const p = this.randomLandPoint(region)
			if (Math.abs(p.x - region.x) > half - 8 || Math.abs(p.z - region.z) > half - 8) continue
			P.container(p.x, p.z, rng.chance(0.5) ? 0 : Math.PI / 2)
		}
		for (let i = 0; i < 16; i++) {
			const p = this.randomLandPoint(region)
			P.barrier(p.x, p.z, rng.angle())
		}
		for (let i = 0; i < 10; i++) {
			const p = this.randomLandPoint(region)
			P.crate(p.x, p.z)
		}
		for (let i = 0; i < 6; i++) {
			const p = this.randomLandPoint(region)
			P.barrel(p.x, p.z, true)
		}
		// High-value loot cluster in the middle.
		for (let i = 0; i < 8; i++) {
			P.lootSpawn(region.x + rng.range(-16, 16), region.z + rng.range(-16, 16), "military")
		}
		this.vehicleSpawns.push({ x: region.x - 70, z: region.z + 70 })
		this.pois.push({ x: region.x, z: region.z, label: region.label, name: region.label, height: 20, major: true })
	}

	buildIndustrial(region) {
		const P = this.props
		const rng = this.rng

		P.building(region.x - 40, region.z - 20, 46, 32, 1, {
			lootTable: "industrial", label: "FACTORY", mat: MAT.metal, floorHeight: 11, openFront: true,
		})
		P.building(region.x + 34, region.z + 28, 34, 24, 2, {
			lootTable: "industrial", label: "WORKSHOP", mat: MAT.brick, lit: true, floorHeight: 5,
		})
		P.storageTank(region.x + 52, region.z - 46, 7, 12)
		P.storageTank(region.x + 72, region.z - 30, 5.5, 9)
		P.pipeline(region.x + 45, region.z - 40, region.x - 30, region.z - 5, 2.2)
		P.pipeline(region.x - 30, region.z - 5, region.x - 30, region.z + 60, 2.2)
		P.crane(region.x - 6, region.z + 64, 0.6)
		P.crane(region.x + 24, region.z - 62, -0.4)

		// Container yard laid out in rows, some stacked two high.
		for (let row = 0; row < 5; row++) {
			for (let col = 0; col < 6; col++) {
				const x = region.x - 26 + col * 7.5
				const z = region.z + 6 + row * 9
				const top = P.container(x, z, 0)
				if (rng.chance(0.35)) {
					P.solid("box", x, top + 1.3, z, 2.6, 2.6, 6.2, 0, MAT.rust, "metal")
				}
			}
		}
		for (let i = 0; i < 22; i++) {
			const p = this.randomLandPoint(region)
			P.crate(p.x, p.z)
		}
		for (let i = 0; i < 12; i++) {
			const p = this.randomLandPoint(region)
			P.barrel(p.x, p.z, true)
		}
		for (let i = 0; i < 8; i++) {
			const p = this.randomLandPoint(region)
			P.debris(p.x, p.z, rng.int(3, 8))
		}
		for (let i = 0; i < 6; i++) {
			const p = this.randomLandPoint(region)
			P.streetLamp(p.x, p.z, rng.angle())
		}
		P.roadStrip(region.x, region.z - 90, 180, Math.PI / 2, 10)
		this.vehicleSpawns.push({ x: region.x - 60, z: region.z - 60 })
		this.pois.push({ x: region.x, z: region.z, label: region.label, name: region.label, height: 18, major: true })
	}

	buildForest(region) {
		const P = this.props
		const rng = this.rng
		// Trees are cheap instanced primitives, so density is affordable.
		for (let i = 0; i < 520; i++) {
			const p = this.randomLandPoint(region, 6)
			if (Math.hypot(p.x - region.x, p.z - region.z) > region.radius) continue
			P.tree(p.x, p.z, rng.range(0.75, 1.3))
		}
		for (let i = 0; i < 280; i++) {
			const p = this.randomLandPoint(region, 4)
			P.bush(p.x, p.z)
		}
		for (let i = 0; i < 220; i++) {
			const p = this.randomLandPoint(region, 4)
			P.grassPatch(p.x, p.z, rng.int(4, 9))
		}
		for (let i = 0; i < 60; i++) {
			const p = this.randomLandPoint(region, 4)
			P.rock(p.x, p.z, rng.range(0.6, 1.4))
		}
		for (let i = 0; i < 40; i++) {
			const p = this.randomLandPoint(region, 4)
			P.log(p.x, p.z)
		}
		// Hunting cabins hide the best wilderness loot.
		for (let i = 0; i < 5; i++) {
			const p = this.randomLandPoint(region)
			P.building(p.x, p.z, 10, 9, 1, {
				lootTable: "wild", label: "CABIN", mat: MAT.wood, stairs: false, floorHeight: 3.2,
			})
		}
		for (let i = 0; i < 18; i++) {
			const p = this.randomLandPoint(region)
			P.lootSpawn(p.x, p.z, "wild")
		}
		this.pois.push({ x: region.x, z: region.z, label: region.label, name: region.label, height: 14, major: true })
	}

	buildMountain(region) {
		const P = this.props
		const rng = this.rng
		for (let i = 0; i < 150; i++) {
			const p = this.randomLandPoint(region, 6)
			P.rock(p.x, p.z, rng.range(0.9, 2.4))
		}
		for (let i = 0; i < 90; i++) {
			const p = this.randomLandPoint(region, 4)
			P.grassPatch(p.x, p.z, rng.int(3, 6))
		}
		for (let i = 0; i < 50; i++) {
			const p = this.randomLandPoint(region, 4)
			P.tree(p.x, p.z, rng.range(0.6, 1))
		}
		// Lookout bunkers on the high ground.
		for (let i = 0; i < 4; i++) {
			const a = (i / 4) * Math.PI * 2 + 0.4
			const x = region.x + Math.cos(a) * 52
			const z = region.z + Math.sin(a) * 52
			P.building(x, z, 12, 10, 1, {
				lootTable: "military", label: "LOOKOUT", mat: MAT.concreteDark, floorHeight: 3.6,
			})
			P.lootSpawn(x, z + 6, "military")
		}
		P.watchTower(region.x, region.z)
		for (let i = 0; i < 12; i++) {
			const p = this.randomLandPoint(region)
			P.crate(p.x, p.z)
		}
		this.pois.push({ x: region.x, z: region.z, label: region.label, name: region.label, height: 46, major: true })
	}

	buildCoast(region) {
		const P = this.props
		const rng = this.rng
		P.dock(region.x - 30, region.z - 10, 46, 0)
		P.dock(region.x + 26, region.z - 6, 34, 0.15)
		for (let i = 0; i < 5; i++) {
			P.boat(region.x - 44 + i * 20, region.z + 34 + rng.range(-6, 6), rng.angle())
		}
		for (let i = 0; i < 4; i++) {
			const p = this.randomLandPoint(region)
			P.building(p.x, p.z, 14, 12, rng.int(1, 2), {
				lootTable: "industrial", label: "BOATHOUSE", mat: MAT.wood, floorHeight: 3.6,
			})
		}
		for (let i = 0; i < 70; i++) {
			const p = this.randomLandPoint(region, 4)
			P.rock(p.x, p.z, rng.range(0.5, 1.5))
		}
		for (let i = 0; i < 40; i++) {
			const p = this.randomLandPoint(region, 4)
			P.grassPatch(p.x, p.z, rng.int(3, 7))
		}
		for (let i = 0; i < 14; i++) {
			const p = this.randomLandPoint(region)
			P.crate(p.x, p.z)
		}
		for (let i = 0; i < 10; i++) {
			const p = this.randomLandPoint(region)
			P.lootSpawn(p.x, p.z, "wild")
		}
		this.vehicleSpawns.push({ x: region.x + 40, z: region.z - 40 })
		this.pois.push({ x: region.x, z: region.z, label: region.label, name: region.label, height: 6, major: true })
	}

	/** Detail between the named regions so the island never feels empty. */
	buildWilds() {
		const P = this.props
		const rng = this.rng
		for (let i = 0; i < 340; i++) {
			const p = this.randomLandPoint(null, 5)
			if (this.regionAt(p.x, p.z)) { if (rng.chance(0.6)) continue }
			P.tree(p.x, p.z, rng.range(0.7, 1.15))
		}
		for (let i = 0; i < 260; i++) {
			const p = this.randomLandPoint(null, 4)
			P.grassPatch(p.x, p.z, rng.int(3, 8))
		}
		for (let i = 0; i < 120; i++) {
			const p = this.randomLandPoint(null, 4)
			P.rock(p.x, p.z, rng.range(0.6, 1.6))
		}
		for (let i = 0; i < 90; i++) {
			const p = this.randomLandPoint(null, 4)
			P.bush(p.x, p.z)
		}
		// Roadside outposts and abandoned checkpoints.
		for (let i = 0; i < 10; i++) {
			const p = this.randomLandPoint(null)
			P.building(p.x, p.z, 9, 8, 1, {
				lootTable: "wild", label: "SHACK", mat: MAT.wood, stairs: false, floorHeight: 3.2,
			})
			P.car(p.x + 7, p.z + 3, rng.angle())
			P.barrier(p.x - 6, p.z + 4, rng.angle())
		}
		for (let i = 0; i < 26; i++) {
			const p = this.randomLandPoint(null)
			P.lootSpawn(p.x, p.z, "wild")
		}
		for (let i = 0; i < 5; i++) {
			const p = this.randomLandPoint(null)
			this.vehicleSpawns.push({ x: p.x, z: p.z })
		}
	}

	/** Update night-only light intensity; called by the day/night system. */
	updateLights(nightFactor) {
		for (const l of this.lights) {
			l.intensity = l.nightOnly ? l.base * nightFactor : l.base
		}
	}

	dispose() {
		this.scene.clear()
		this.collision.clear && this.collision.clear()
		this.coverPoints.length = 0
		this.coverGrid.clear()
		this.lights.length = 0
		this.lootSpawns.length = 0
		this.pois.length = 0
		this.explosives.length = 0
	}
}
