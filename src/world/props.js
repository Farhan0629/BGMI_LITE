/**
 * Procedural prop library.
 *
 * Every builder method pushes instanced geometry into the scene and, where
 * relevant, collision boxes, cover points, dynamic lights and loot spawn
 * anchors. Props are intentionally composed of many small pieces (pipes,
 * railings, cables, debris) because that layered detail is what sells the
 * environment far more than raw object count.
 */
import { mat4 } from "../core/math.js"

export const MAT = {
	concrete: { color: [0.55, 0.54, 0.51], rough: 0.92 },
	concreteDark: { color: [0.36, 0.36, 0.35], rough: 0.9 },
	plaster: { color: [0.6, 0.56, 0.49], rough: 0.88 },
	brick: { color: [0.42, 0.3, 0.25], rough: 0.9 },
	metal: { color: [0.44, 0.46, 0.49], rough: 0.45 },
	metalDark: { color: [0.25, 0.26, 0.28], rough: 0.5 },
	rust: { color: [0.41, 0.25, 0.16], rough: 0.85 },
	wood: { color: [0.36, 0.26, 0.16], rough: 0.85 },
	glass: { color: [0.29, 0.38, 0.42], rough: 0.12 },
	glassBroken: { color: [0.14, 0.17, 0.18], rough: 0.3 },
	foliage: { color: [0.16, 0.26, 0.13], rough: 0.95 },
	foliageDry: { color: [0.28, 0.29, 0.16], rough: 0.95 },
	bark: { color: [0.22, 0.17, 0.12], rough: 0.95 },
	rock: { color: [0.3, 0.3, 0.31], rough: 0.9 },
	asphalt: { color: [0.15, 0.15, 0.16], rough: 0.85 },
	paint: { color: [0.7, 0.66, 0.2], rough: 0.7 },
	canvas: { color: [0.3, 0.32, 0.24], rough: 0.95 },
	olive: { color: [0.22, 0.27, 0.18], rough: 0.8 },
	carBody: { color: [0.3, 0.33, 0.36], rough: 0.55 },
	tire: { color: [0.08, 0.08, 0.09], rough: 0.95 },
}

export class PropBuilder {
	constructor(world) {
		this.world = world
		this.scene = world.scene
		this.collision = world.collision
		this.rng = world.rng
		this.m = mat4()
	}

	/** Visual-only instance. */
	add(geom, x, y, z, sx, sy, sz, yaw = 0, mat = MAT.concrete, emissive = 0, wind = 0, ao = 1, pitch = 0) {
		const m = this.m
		const cy = Math.cos(yaw), sy2 = Math.sin(yaw)
		const cp = Math.cos(pitch), sp = Math.sin(pitch)
		// Inline compose (yaw then pitch) to avoid a function call per instance.
		m[0] = cy * sx; m[1] = 0; m[2] = -sy2 * sx; m[3] = 0
		m[4] = sy2 * sp * sy; m[5] = cp * sy; m[6] = cy * sp * sy; m[7] = 0
		m[8] = sy2 * cp * sz; m[9] = -sp * sz; m[10] = cy * cp * sz; m[11] = 0
		m[12] = x; m[13] = y; m[14] = z; m[15] = 1
		const c = mat.color
		this.scene.addStatic(geom, m, c[0], c[1], c[2], mat.rough, emissive, wind, ao)
	}

	/** Instance plus an axis-aligned collision box. */
	solid(geom, x, y, z, sx, sy, sz, yaw = 0, mat = MAT.concrete, surface = "concrete", opts) {
		this.add(geom, x, y, z, sx, sy, sz, yaw, mat, 0, 0, opts && opts.ao !== undefined ? opts.ao : 0.85)
		// Rotated boxes use a conservative axis-aligned bound.
		const c = Math.abs(Math.cos(yaw)), s = Math.abs(Math.sin(yaw))
		const ex = sx * c + sz * s
		const ez = sx * s + sz * c
		const box = this.collision.addAabb(x, y, z, ex, sy, ez, surface, opts)
		if (sy > 0.7 && sy < 2.6 && !(opts && opts.noCover)) {
			this.world.coverPoints.push({ x, z, height: y + sy / 2 })
		}
		return box
	}

	light(x, y, z, range, r, g, b, intensity, nightOnly = true) {
		this.world.lights.push({ x, y, z, range, r, g, b, intensity, base: intensity, nightOnly })
	}

	lootSpawn(x, z, table, y) {
		this.world.lootSpawns.push({ x, y: y !== undefined ? y : this.world.groundAt(x, z), table })
	}

	// ----------------------------------------------------------------- urban

	/**
	 * Multi-storey building with floor slabs, window bands, a roof parapet,
	 * a door recess, roof-top clutter and interior loot anchors.
	 */
	building(x, z, w, d, floors, opts = {}) {
		const rng = this.rng
		const g = this.world.groundAt(x, z)
		const floorHeight = opts.floorHeight || 3.4
		const wallMat = opts.mat || (rng.chance(0.4) ? MAT.brick : MAT.plaster)
		const yaw = opts.yaw || 0
		const height = floors * floorHeight

		// Shell: four walls, so the interior is enterable and fightable.
		const t = 0.35
		const cy = Math.cos(yaw), sy = Math.sin(yaw)
		const place = (ox, oz, sx, sz) => {
			const wx = x + ox * cy + oz * sy
			const wz = z - ox * sy + oz * cy
			this.solid("box", wx, g + height / 2, wz, sx, height, sz, yaw, wallMat, "concrete", { ao: 0.7 })
		}
		place(0, -d / 2, w, t)
		place(0, d / 2, w, t)
		place(-w / 2, 0, t, d)
		if (!opts.openFront) place(w / 2, 0, t, d)

		// Floor slabs (walkable) and window bands.
		for (let f = 0; f <= floors; f++) {
			const y = g + f * floorHeight
			if (f > 0) this.solid("box", x, y, z, w - 0.4, 0.3, d - 0.4, yaw, MAT.concreteDark, "concrete", { noCover: true, ao: 0.55 })
			if (f < floors) {
				const broken = rng.chance(0.45)
				const glass = broken ? MAT.glassBroken : MAT.glass
				const wy = y + floorHeight * 0.62
				for (const side of [-1, 1]) {
					const ox = 0, oz = (d / 2) * side
					const wx = x + ox * cy + oz * sy
					const wz = z - ox * sy + oz * cy
					this.add("box", wx, wy, wz, w * 0.8, 1.25, 0.12, yaw, glass, broken ? 0 : 0.02)
				}
				if (rng.chance(0.5)) {
					const ox = (w / 2) * (rng.chance(0.5) ? 1 : -1)
					const wx = x + ox * cy
					const wz = z - ox * sy
					this.add("box", wx, wy, wz, 0.12, 1.2, d * 0.7, yaw, glass)
				}
				// Interior light at night on a few floors.
				if (opts.lit && rng.chance(0.3)) {
					this.light(x, y + 2.4, z, 14, 1, 0.85, 0.6, 0.55)
				}
				// Interior loot.
				if (rng.chance(0.85)) {
					this.lootSpawn(x + rng.range(-w * 0.3, w * 0.3), z + rng.range(-d * 0.3, d * 0.3),
						opts.lootTable || "city", y + 0.2)
				}
				if (rng.chance(0.5)) {
					this.crate(x + rng.range(-w * 0.35, w * 0.35), z + rng.range(-d * 0.35, d * 0.35), y)
				}
			}
		}

		// Roof parapet and clutter.
		const roofY = g + height
		for (const [ox, oz, sx, sz] of [[0, -d / 2, w, 0.3], [0, d / 2, w, 0.3], [-w / 2, 0, 0.3, d], [w / 2, 0, 0.3, d]]) {
			const wx = x + ox * cy + oz * sy
			const wz = z - ox * sy + oz * cy
			this.solid("box", wx, roofY + 0.55, wz, sx, 1.1, sz, yaw, MAT.concrete, "concrete")
		}
		this.solid("box", x + w * 0.2, roofY + 0.9, z - d * 0.2, 2.2, 1.8, 2.2, yaw, MAT.metalDark, "metal")
		if (rng.chance(0.6)) this.add("cyl", x - w * 0.25, roofY + 1.4, z + d * 0.25, 1.2, 2.8, 1.2, 0, MAT.rust)
		this.lootSpawn(x + rng.range(-w * 0.3, w * 0.3), z + rng.range(-d * 0.3, d * 0.3), opts.lootTable || "city", roofY + 0.2)

		// External stairs give roof access.
		if (opts.stairs !== false) this.stairs(x + (w / 2 + 1.6) * cy, z - (w / 2 + 1.6) * sy, g, roofY, yaw + Math.PI / 2)

		// Ground-level detail: pipes and a door frame.
		this.add("cyl", x + (w / 2 - 0.3) * cy, g + height / 2, z - (w / 2 - 0.3) * sy, 0.22, height, 0.22, 0, MAT.rust)
		this.world.pois.push({ x, z, label: opts.label || "BUILDING", height })
		return { x, z, roofY, height }
	}

	/** Simple stepped ramp used for roof and tower access. */
	stairs(x, z, fromY, toY, yaw = 0) {
		const steps = Math.max(3, Math.round((toY - fromY) / 0.45))
		const cy = Math.cos(yaw), sy = Math.sin(yaw)
		for (let i = 0; i < steps; i++) {
			const t = i / steps
			const y = fromY + (toY - fromY) * t
			const off = -2 + t * 4.5
			this.solid("box", x + off * cy, y + 0.2, z - off * sy, 1.5, 0.42, 1.1, yaw, MAT.concreteDark, "concrete", { noCover: true })
		}
	}

	car(x, z, yaw, wrecked = true) {
		const g = this.world.groundAt(x, z)
		const body = wrecked && this.rng.chance(0.5) ? MAT.rust : MAT.carBody
		this.solid("box", x, g + 0.75, z, 2.0, 0.85, 4.3, yaw, body, "metal")
		this.add("box", x, g + 1.42, z, 1.75, 0.62, 2.1, yaw, MAT.glassBroken)
		const cy = Math.cos(yaw), sy = Math.sin(yaw)
		for (const [ox, oz] of [[-0.95, -1.5], [0.95, -1.5], [-0.95, 1.5], [0.95, 1.5]]) {
			this.add("cyl", x + ox * cy + oz * sy, g + 0.34, z - ox * sy + oz * cy, 0.68, 0.32, 0.68, yaw + Math.PI / 2, MAT.tire, 0, 0, 0.7, Math.PI / 2)
		}
		if (this.rng.chance(0.35)) this.lootSpawn(x + 1.6, z, "city", g)
	}

	streetLamp(x, z, yaw = 0) {
		const g = this.world.groundAt(x, z)
		this.solid("cyl", x, g + 3.2, z, 0.22, 6.4, 0.22, 0, MAT.metalDark, "metal", { noCover: true })
		this.add("box", x + Math.cos(yaw) * 0.9, g + 6.3, z - Math.sin(yaw) * 0.9, 2, 0.16, 0.3, yaw, MAT.metalDark)
		this.add("box", x + Math.cos(yaw) * 1.7, g + 6.1, z - Math.sin(yaw) * 1.7, 0.75, 0.22, 0.4, yaw, MAT.paint, 0.9)
		this.light(x + Math.cos(yaw) * 1.7, g + 6, z - Math.sin(yaw) * 1.7, 26, 1, 0.86, 0.62, 1.5)
	}

	utilityPole(x, z) {
		const g = this.world.groundAt(x, z)
		this.solid("cyl", x, g + 4.5, z, 0.3, 9, 0.3, 0, MAT.wood, "wood", { noCover: true })
		this.add("box", x, g + 8.2, z, 3.2, 0.2, 0.2, 0, MAT.wood)
		this.add("box", x, g + 7.4, z, 2.4, 0.16, 0.16, 0, MAT.wood)
	}

	/** Sagging cable between two points, approximated with short segments. */
	powerCable(x0, z0, x1, z1, y) {
		const segments = 6
		const dx = (x1 - x0) / segments
		const dz = (z1 - z0) / segments
		const len = Math.hypot(x1 - x0, z1 - z0) / segments
		const yaw = Math.atan2(x1 - x0, z1 - z0)
		for (let i = 0; i < segments; i++) {
			const t = (i + 0.5) / segments
			const sag = Math.sin(t * Math.PI) * 1.3
			this.add("box", x0 + dx * (i + 0.5), y - sag, z0 + dz * (i + 0.5), 0.08, 0.08, len * 1.05, yaw, MAT.metalDark)
		}
	}

	barrier(x, z, yaw) {
		const g = this.world.groundAt(x, z)
		this.solid("box", x, g + 0.55, z, 2.4, 1.1, 0.7, yaw, MAT.concrete, "concrete")
		this.add("box", x, g + 1.12, z, 2.4, 0.12, 0.5, yaw, MAT.paint)
	}

	dumpster(x, z, yaw) {
		const g = this.world.groundAt(x, z)
		this.solid("box", x, g + 0.8, z, 2.2, 1.6, 1.3, yaw, MAT.rust, "metal")
		this.add("box", x, g + 1.66, z, 2.2, 0.12, 1.3, yaw, MAT.metalDark)
		if (this.rng.chance(0.4)) this.lootSpawn(x, z + 1.4, "city", g)
	}

	debris(x, z, amount = 5) {
		const g = this.world.groundAt(x, z)
		for (let i = 0; i < amount; i++) {
			const rx = x + this.rng.range(-2.6, 2.6)
			const rz = z + this.rng.range(-2.6, 2.6)
			const s = this.rng.range(0.25, 0.9)
			this.add("box", rx, this.world.groundAt(rx, rz) + s * 0.2, rz, s, s * 0.35, s * this.rng.range(0.6, 1.6),
				this.rng.angle(), this.rng.chance(0.5) ? MAT.concreteDark : MAT.rust, 0, 0, 0.75)
		}
		void g
	}

	roadStrip(x, z, length, yaw, width = 8) {
		const steps = Math.max(1, Math.round(length / 10))
		const cy = Math.cos(yaw), sy = Math.sin(yaw)
		for (let i = 0; i < steps; i++) {
			const t = (i + 0.5) / steps - 0.5
			const px = x + cy * 0 + sy * (t * length)
			const pz = z + cy * (t * length)
			this.add("plane", px, this.world.groundAt(px, pz) + 0.06, pz, width, 1, length / steps + 0.5, yaw, MAT.asphalt, 0, 0, 0.9)
			if (i % 2 === 0) {
				this.add("plane", px, this.world.groundAt(px, pz) + 0.08, pz, 0.3, 1, 2.6, yaw, MAT.paint, 0, 0, 1)
			}
		}
	}

	sign(x, z, yaw) {
		const g = this.world.groundAt(x, z)
		this.solid("cyl", x, g + 1.6, z, 0.16, 3.2, 0.16, 0, MAT.metalDark, "metal", { noCover: true })
		this.add("box", x, g + 3.1, z, 2.2, 1.1, 0.12, yaw, this.rng.chance(0.5) ? MAT.paint : MAT.rust)
	}

	// -------------------------------------------------------------- military

	container(x, z, yaw, mat) {
		const g = this.world.groundAt(x, z)
		const m = mat || (this.rng.chance(0.5) ? MAT.rust : MAT.olive)
		this.solid("box", x, g + 1.3, z, 2.6, 2.6, 6.2, yaw, m, "metal")
		for (let i = -2; i <= 2; i++) {
			this.add("box", x + Math.cos(yaw) * 1.31, g + 1.3, z - Math.sin(yaw) * 1.31 + i * 1.1, 0.06, 2.4, 0.16, yaw, MAT.metalDark)
		}
		if (this.rng.chance(0.5)) this.lootSpawn(x + Math.cos(yaw) * 2.4, z, "industrial", g)
		return g + 2.6
	}

	crate(x, z, baseY) {
		const g = baseY !== undefined ? baseY : this.world.groundAt(x, z)
		const s = this.rng.range(0.8, 1.15)
		this.solid("box", x, g + s / 2, z, s, s, s, this.rng.angle(), MAT.wood, "wood",
			{ breakable: true, health: 55 })
		if (this.rng.chance(0.55)) this.lootSpawn(x, z, "industrial", g)
	}

	barrel(x, z, explosive = true, baseY) {
		const g = baseY !== undefined ? baseY : this.world.groundAt(x, z)
		const box = this.solid("cyl", x, g + 0.6, z, 0.8, 1.2, 0.8, 0, explosive ? MAT.rust : MAT.metal,
			"metal", { breakable: true, explosive, health: 35 })
		box.worldX = x
		box.worldY = g + 0.6
		box.worldZ = z
		this.world.explosives.push(box)
	}

	watchTower(x, z, yaw = 0) {
		const g = this.world.groundAt(x, z)
		const h = 9
		for (const [ox, oz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) {
			this.solid("box", x + ox, g + h / 2, z + oz, 0.35, h, 0.35, 0, MAT.metalDark, "metal", { noCover: true })
		}
		this.solid("box", x, g + h, z, 4.6, 0.3, 4.6, 0, MAT.metal, "metal", { noCover: true })
		for (const [ox, oz, sx, sz] of [[0, -2.2, 4.6, 0.2], [0, 2.2, 4.6, 0.2], [-2.2, 0, 0.2, 4.6], [2.2, 0, 0.2, 4.6]]) {
			this.solid("box", x + ox, g + h + 0.6, z + oz, sx, 1.2, sz, 0, MAT.metal, "metal")
		}
		this.add("box", x, g + h + 2.6, z, 5, 0.2, 5, 0, MAT.rust)
		this.stairs(x + 3.6, z, g, g + h, yaw)
		this.lootSpawn(x, z, "military", g + h + 0.2)
		this.light(x, g + h + 2.2, z, 30, 1, 0.9, 0.7, 0.8)
		this.world.pois.push({ x, z, label: "WATCHTOWER", height: h })
	}

	fenceLine(x0, z0, x1, z1) {
		const len = Math.hypot(x1 - x0, z1 - z0)
		const count = Math.max(1, Math.round(len / 4))
		const yaw = Math.atan2(x1 - x0, z1 - z0)
		for (let i = 0; i < count; i++) {
			const t = (i + 0.5) / count
			const px = x0 + (x1 - x0) * t
			const pz = z0 + (z1 - z0) * t
			const g = this.world.groundAt(px, pz)
			this.solid("box", px, g + 1.3, pz, 0.12, 2.6, len / count, yaw, MAT.metalDark, "metal", { noCover: true, ao: 0.95 })
			this.add("cyl", px, g + 1.35, pz, 0.14, 2.7, 0.14, 0, MAT.metal)
		}
	}

	militaryTruck(x, z, yaw) {
		const g = this.world.groundAt(x, z)
		this.solid("box", x, g + 1.2, z, 2.5, 1.5, 3.0, yaw, MAT.olive, "metal")
		const cy = Math.cos(yaw), sy = Math.sin(yaw)
		this.solid("box", x + sy * 3.2, g + 1.7, z + cy * 3.2, 2.6, 2.4, 4.4, yaw, MAT.canvas, "metal")
		for (const [ox, oz] of [[-1.2, -1.1], [1.2, -1.1], [-1.2, 2.6], [1.2, 2.6], [-1.2, 4.2], [1.2, 4.2]]) {
			this.add("cyl", x + ox * cy + oz * sy, g + 0.55, z - ox * sy + oz * cy, 1.1, 0.45, 1.1, yaw + Math.PI / 2, MAT.tire, 0, 0, 0.7, Math.PI / 2)
		}
		this.lootSpawn(x + cy * 2.6, z + sy * 2.6, "military", g)
	}

	radarDish(x, z) {
		const g = this.world.groundAt(x, z)
		this.solid("cyl", x, g + 3, z, 1.1, 6, 1.1, 0, MAT.metalDark, "metal", { noCover: true })
		this.add("box", x, g + 6.4, z, 2.4, 0.8, 2.4, 0.5, MAT.metal)
		this.add("sphere", x, g + 8.4, z, 6.5, 3.2, 1.6, 0.6, MAT.metal)
		this.add("box", x, g + 8.4, z, 0.3, 0.3, 3.4, 0.6, MAT.metalDark)
		this.world.pois.push({ x, z, label: "RADAR", height: 9 })
	}

	helipad(x, z) {
		const g = this.world.groundAt(x, z)
		this.add("plane", x, g + 0.1, z, 18, 1, 18, 0, MAT.concreteDark, 0, 0, 0.95)
		this.add("plane", x, g + 0.12, z, 9, 1, 1.2, 0, MAT.paint)
		this.add("plane", x, g + 0.12, z, 1.2, 1, 9, 0, MAT.paint)
		for (let i = 0; i < 8; i++) {
			const a = (i / 8) * Math.PI * 2
			this.light(x + Math.cos(a) * 8.5, g + 0.3, z + Math.sin(a) * 8.5, 9, 1, 0.4, 0.3, 0.5)
		}
		this.lootSpawn(x + 6, z + 6, "military", g)
		this.world.vehicleSpawns.push({ x: x + 12, z: z + 12 })
		this.world.pois.push({ x, z, label: "HELIPAD", height: 0 })
	}

	// ------------------------------------------------------------ industrial

	storageTank(x, z, radius = 6, height = 10) {
		const g = this.world.groundAt(x, z)
		this.solid("cyl", x, g + height / 2, z, radius * 2, height, radius * 2, 0, MAT.metal, "metal", { noCover: true })
		this.add("cyl", x, g + height + 0.3, z, radius * 2.1, 0.5, radius * 2.1, 0, MAT.rust)
		for (let i = 0; i < 3; i++) {
			this.add("cyl", x, g + height * (0.3 + i * 0.25), z, radius * 2.05, 0.3, radius * 2.05, 0, MAT.rust)
		}
		this.add("cyl", x + radius * 1.05, g + height / 2, z, 0.4, height, 0.4, 0, MAT.rust)
		this.world.pois.push({ x, z, label: "TANKS", height })
	}

	pipeline(x0, z0, x1, z1, y = 1.6) {
		const len = Math.hypot(x1 - x0, z1 - z0)
		const yaw = Math.atan2(x1 - x0, z1 - z0)
		const steps = Math.max(1, Math.round(len / 12))
		for (let i = 0; i < steps; i++) {
			const t = (i + 0.5) / steps
			const px = x0 + (x1 - x0) * t
			const pz = z0 + (z1 - z0) * t
			const g = this.world.groundAt(px, pz)
			this.solid("box", px, g + y, pz, 0.7, 0.7, len / steps, yaw, MAT.rust, "metal", { noCover: true })
			this.solid("box", px, g + y / 2, pz, 0.35, y, 0.35, yaw, MAT.metalDark, "metal", { noCover: true })
		}
	}

	crane(x, z, yaw = 0) {
		const g = this.world.groundAt(x, z)
		for (const [ox, oz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) {
			this.solid("box", x + ox, g + 9, z + oz, 0.5, 18, 0.5, 0, MAT.paint, "metal", { noCover: true })
		}
		this.add("box", x, g + 18.4, z, 26, 0.9, 1.4, yaw, MAT.paint)
		this.add("box", x, g + 17.4, z, 3.2, 2, 2.4, yaw, MAT.metalDark)
		this.add("box", x + Math.sin(yaw) * 9, g + 12, z + Math.cos(yaw) * 9, 0.2, 12, 0.2, 0, MAT.metalDark)
		this.world.pois.push({ x, z, label: "CRANE", height: 18 })
	}

	dock(x, z, length = 40, yaw = 0) {
		const steps = Math.round(length / 5)
		const cy = Math.cos(yaw), sy = Math.sin(yaw)
		for (let i = 0; i < steps; i++) {
			const t = i / steps
			const px = x + sy * t * length
			const pz = z + cy * t * length
			this.solid("box", px, 1.2, pz, 6, 0.4, 5.2, yaw, MAT.wood, "wood", { noCover: true })
			for (const ox of [-2.6, 2.6]) {
				this.add("cyl", px + ox * cy, 0.2, pz - ox * sy, 0.4, 2.6, 0.4, 0, MAT.wood)
			}
			if (i % 3 === 0) this.crate(px + 1.4, pz, 1.4)
		}
		this.world.pois.push({ x, z, label: "DOCK", height: 2 })
	}

	boat(x, z, yaw) {
		this.solid("box", x, 0.6, z, 2.6, 1, 6.5, yaw, MAT.plaster, "metal")
		this.add("box", x, 1.4, z - 1, 1.8, 1.2, 2.2, yaw, MAT.glassBroken)
		this.lootSpawn(x, z, "wild", 1.2)
	}

	// ---------------------------------------------------------------- nature

	tree(x, z, scale = 1) {
		const g = this.world.groundAt(x, z)
		const h = this.rng.range(9, 15) * scale
		const r = this.rng.range(0.35, 0.55) * scale
		this.solid("taper", x, g + h * 0.5, z, r * 2, h, r * 2, 0, MAT.bark, "wood", { noCover: true, ao: 0.9 })
		const canopy = this.rng.chance(0.45) ? MAT.foliageDry : MAT.foliage
		for (let i = 0; i < 3; i++) {
			const cy2 = g + h * (0.62 + i * 0.16)
			const cr = (4.2 - i * 1.1) * scale
			this.add("sphereLow", x + this.rng.range(-0.5, 0.5), cy2, z + this.rng.range(-0.5, 0.5),
				cr, cr * 0.8, cr, this.rng.angle(), canopy, 0, 0.55, 0.85)
		}
	}

	bush(x, z) {
		const g = this.world.groundAt(x, z)
		const s = this.rng.range(1.1, 2.2)
		this.add("sphereLow", x, g + s * 0.4, z, s, s * 0.7, s, this.rng.angle(), MAT.foliage, 0, 0.8, 0.8)
	}

	grassPatch(x, z, count = 6) {
		for (let i = 0; i < count; i++) {
			const px = x + this.rng.range(-3.5, 3.5)
			const pz = z + this.rng.range(-3.5, 3.5)
			const s = this.rng.range(0.7, 1.4)
			this.add("card", px, this.world.groundAt(px, pz), pz, s, s * this.rng.range(0.8, 1.5), s,
				this.rng.angle(), this.rng.chance(0.5) ? MAT.foliage : MAT.foliageDry, 0, 1, 0.9)
		}
	}

	rock(x, z, scale = 1) {
		const g = this.world.groundAt(x, z)
		const s = this.rng.range(1.4, 4) * scale
		this.solid("prism", x, g + s * 0.32, z, s, s * 0.8, s * this.rng.range(0.7, 1.3), this.rng.angle(), MAT.rock, "dirt")
	}

	log(x, z) {
		const g = this.world.groundAt(x, z)
		const len = this.rng.range(3.5, 7)
		this.solid("cylLow", x, g + 0.45, z, 0.9, len, 0.9, this.rng.angle(), MAT.bark, "wood", { noCover: true }, )
	}
}
