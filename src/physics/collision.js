/**
 * Collision world: AABB boxes in a uniform spatial hash, swept character
 * movement with step-up, and a ray caster used for hitscan weapons, AI line
 * of sight and camera collision. Hot paths avoid allocations by reusing
 * scratch objects and caller supplied output arrays.
 */

const scratchHit = {
	hit: false, distance: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, box: null,
}

export class CollisionWorld {
	constructor(cell = 14) {
		this.cell = cell
		/** @type {any[]} */
		this.boxes = []
		/** @type {Map<number, number[]>} */
		this.grid = new Map()
		this.nextId = 1
		this.queryStamp = 1
	}

	key(cx, cz) {
		return (cx + 4096) * 8192 + (cz + 4096)
	}

	addBox(box) {
		const b = Object.assign({
			surface: "concrete", breakable: false, explosive: false,
			destroyed: false, health: 0, stamp: 0,
		}, box)
		b.id = this.nextId++
		const index = this.boxes.length
		this.boxes.push(b)
		const c0x = Math.floor(b.minX / this.cell)
		const c1x = Math.floor(b.maxX / this.cell)
		const c0z = Math.floor(b.minZ / this.cell)
		const c1z = Math.floor(b.maxZ / this.cell)
		for (let cx = c0x; cx <= c1x; cx++) {
			for (let cz = c0z; cz <= c1z; cz++) {
				const k = this.key(cx, cz)
				let list = this.grid.get(k)
				if (!list) {
					list = []
					this.grid.set(k, list)
				}
				list.push(index)
			}
		}
		return b
	}

	/** Add a box from a centre position plus full size. */
	addAabb(cx, cy, cz, sx, sy, sz, surface = "concrete", opts) {
		return this.addBox({
			minX: cx - sx / 2, minY: cy - sy / 2, minZ: cz - sz / 2,
			maxX: cx + sx / 2, maxY: cy + sy / 2, maxZ: cz + sz / 2,
			surface,
			breakable: opts ? !!opts.breakable : false,
			explosive: opts ? !!opts.explosive : false,
			health: opts && opts.health ? opts.health : 0,
		})
	}

	/** Collect live boxes overlapping an XZ region into `out`. */
	queryRegion(minX, minZ, maxX, maxZ, out) {
		out.length = 0
		const stamp = ++this.queryStamp
		const c0x = Math.floor(minX / this.cell)
		const c1x = Math.floor(maxX / this.cell)
		const c0z = Math.floor(minZ / this.cell)
		const c1z = Math.floor(maxZ / this.cell)
		for (let cx = c0x; cx <= c1x; cx++) {
			for (let cz = c0z; cz <= c1z; cz++) {
				const list = this.grid.get(this.key(cx, cz))
				if (!list) continue
				for (let i = 0; i < list.length; i++) {
					const b = this.boxes[list[i]]
					if (b.destroyed || b.stamp === stamp) continue
					b.stamp = stamp
					out.push(b)
				}
			}
		}
		return out
	}

	/**
	 * Ray versus world. Walks the spatial hash along the ray so long shots do
	 * not test the whole island. Returns a shared scratch hit object.
	 */
	raycast(ox, oy, oz, dx, dy, dz, maxDist) {
		scratchHit.hit = false
		scratchHit.distance = maxDist
		scratchHit.box = null
		const stamp = ++this.queryStamp
		const step = this.cell * 0.75
		for (let t = 0; t <= maxDist + step; t += step) {
			const px = ox + dx * t
			const pz = oz + dz * t
			const ccx = Math.floor(px / this.cell)
			const ccz = Math.floor(pz / this.cell)
			for (let ax = ccx - 1; ax <= ccx + 1; ax++) {
				for (let az = ccz - 1; az <= ccz + 1; az++) {
					const list = this.grid.get(this.key(ax, az))
					if (!list) continue
					for (let i = 0; i < list.length; i++) {
						const b = this.boxes[list[i]]
						if (b.destroyed || b.stamp === stamp) continue
						b.stamp = stamp
						const d = rayBox(ox, oy, oz, dx, dy, dz, b)
						if (d >= 0 && d < scratchHit.distance) {
							scratchHit.hit = true
							scratchHit.distance = d
							scratchHit.box = b
						}
					}
				}
			}
			if (scratchHit.hit && scratchHit.distance < t) break
		}
		if (scratchHit.hit && scratchHit.box) {
			const b = scratchHit.box
			const px = ox + dx * scratchHit.distance
			const py = oy + dy * scratchHit.distance
			const pz = oz + dz * scratchHit.distance
			scratchHit.x = px
			scratchHit.y = py
			scratchHit.z = pz
			const eps = 0.03
			scratchHit.nx = px <= b.minX + eps ? -1 : px >= b.maxX - eps ? 1 : 0
			scratchHit.ny = py <= b.minY + eps ? -1 : py >= b.maxY - eps ? 1 : 0
			scratchHit.nz = pz <= b.minZ + eps ? -1 : pz >= b.maxZ - eps ? 1 : 0
			if (!scratchHit.nx && !scratchHit.ny && !scratchHit.nz) scratchHit.ny = 1
		}
		return scratchHit
	}

	/** True when nothing blocks the segment from a to b. */
	lineOfSight(ax, ay, az, bx, by, bz) {
		let dx = bx - ax
		let dy = by - ay
		let dz = bz - az
		const len = Math.hypot(dx, dy, dz)
		if (len < 0.001) return true
		dx /= len; dy /= len; dz /= len
		return !this.raycast(ax, ay, az, dx, dy, dz, len - 0.2).hit
	}

	/** Apply damage to a breakable box. Returns true when destroyed. */
	damageBox(box, amount) {
		if (!box || !box.breakable || box.destroyed) return false
		box.health -= amount
		if (box.health <= 0) {
			box.destroyed = true
			return true
		}
		return false
	}
}

/** Slab test. Returns distance along the ray, or -1 for a miss. */
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
	const ix = Math.abs(dx) < 1e-8 ? 1e8 : 1 / dx
	const iy = Math.abs(dy) < 1e-8 ? 1e8 : 1 / dy
	const iz = Math.abs(dz) < 1e-8 ? 1e8 : 1 / dz
	let t1 = (b.minX - ox) * ix
	let t2 = (b.maxX - ox) * ix
	let tmin = Math.min(t1, t2)
	let tmax = Math.max(t1, t2)
	t1 = (b.minY - oy) * iy
	t2 = (b.maxY - oy) * iy
	tmin = Math.max(tmin, Math.min(t1, t2))
	tmax = Math.min(tmax, Math.max(t1, t2))
	t1 = (b.minZ - oz) * iz
	t2 = (b.maxZ - oz) * iz
	tmin = Math.max(tmin, Math.min(t1, t2))
	tmax = Math.min(tmax, Math.max(t1, t2))
	if (tmax < 0 || tmin > tmax) return -1
	return tmin >= 0 ? tmin : tmax
}

/** Ray versus sphere, used for character hitboxes. Returns distance or -1. */
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, radius) {
	const ex = cx - ox
	const ey = cy - oy
	const ez = cz - oz
	const b = ex * dx + ey * dy + ez * dz
	const c = ex * ex + ey * ey + ez * ez - radius * radius
	const disc = b * b - c
	if (disc < 0) return -1
	const s = Math.sqrt(disc)
	const t0 = b - s
	if (t0 >= 0) return t0
	const t1 = b + s
	return t1 >= 0 ? t1 : -1
}

const queryScratch = []

/**
 * Swept AABB character movement with step-up support.
 * `pos` is the feet position and is mutated in place; `vel` is zeroed on any
 * blocked axis. `terrainY` is the analytic heightfield sample below the feet.
 */
export function resolveMovement(world, pos, vel, radius, height, dt, stepHeight, terrainY) {
	let grounded = false
	let hitWall = false
	let groundY = terrainY

	const moveAxis = (axis) => {
		const delta = vel[axis] * dt
		if (delta === 0) return
		pos[axis] += delta
		const boxes = world.queryRegion(
			pos.x - radius - 1, pos.z - radius - 1,
			pos.x + radius + 1, pos.z + radius + 1, queryScratch)
		for (let i = 0; i < boxes.length; i++) {
			const b = boxes[i]
			if (pos.x + radius <= b.minX || pos.x - radius >= b.maxX) continue
			if (pos.y + height <= b.minY || pos.y >= b.maxY) continue
			if (pos.z + radius <= b.minZ || pos.z - radius >= b.maxZ) continue

			if (axis === "y") {
				if (delta < 0) {
					pos.y = b.maxY
					grounded = true
					if (b.maxY > groundY) groundY = b.maxY
				} else {
					pos.y = b.minY - height
				}
				vel.y = 0
			} else {
				// Step up onto low obstacles (kerbs, debris, stairs) instead of stopping.
				const stepUp = b.maxY - pos.y
				if (stepUp > 0 && stepUp <= stepHeight) {
					pos.y = b.maxY
					grounded = true
					if (b.maxY > groundY) groundY = b.maxY
					continue
				}
				pos[axis] -= delta
				vel[axis] = 0
				hitWall = true
				break
			}
		}
	}

	moveAxis("x")
	moveAxis("z")
	moveAxis("y")

	if (pos.y <= terrainY) {
		pos.y = terrainY
		if (vel.y < 0) vel.y = 0
		grounded = true
		groundY = terrainY
	}

	return { grounded, hitWall, groundY }
}
