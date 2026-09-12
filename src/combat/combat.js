/**
 * Combat system: the single authority for shots, damage and destruction.
 *
 * - Hitscan weapons resolve immediately against character hitboxes and world
 *   geometry (nearest hit wins).
 * - High velocity weapons (sniper) use pooled projectiles that step forward
 *   each tick and raycast the segment they travelled, so bullet travel time
 *   is simulated without per-bullet allocation.
 * - Hit location multipliers, range falloff and armour are all applied here;
 *   the multiplayer server reuses this module unchanged.
 */
import { WEAPONS, HIT_LOCATIONS } from "../config/weapons.js"
import { GAME } from "../config/game.js"
import { clamp } from "../core/math.js"
import { bus } from "../core/events.js"
import { rayBox } from "../physics/collision.js"

const PROJECTILE_POOL = 160

export class CombatSystem {
	constructor(world, particles) {
		this.world = world
		this.particles = particles
		/** @type {any[]} live combatants, assigned by the match each frame. */
		this.targets = []
		this.projectiles = []
		for (let i = 0; i < PROJECTILE_POOL; i++) {
			this.projectiles.push({
				active: false, x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0,
				speed: 0, travelled: 0, maxRange: 0, damage: 0, owner: null, weapon: null,
			})
		}
		this.projectileCursor = 0
		this.hitboxScratch = []
		this.boxScratch = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0 }
	}

	setTargets(list) {
		this.targets = list
	}

	// ---------------------------------------------------------------- firing

	/**
	 * Fire one shot (or one pellet spread) from a combatant.
	 * @param {object} owner shooter entity
	 * @param {object} w weapon config
	 * @param {{x:number,y:number,z:number}} origin muzzle position
	 * @param {{x:number,y:number,z:number}} dir normalised aim direction
	 * @param {number} spread cone half-angle in radians
	 */
	fireWeapon(owner, w, origin, dir, spread) {
		if (owner.stats) owner.stats.shotsFired++
		this.particles.muzzleFlash(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, w.muzzleFlash)
		this.particles.shellEject(origin.x, origin.y - 0.05, origin.z, dir.z, -dir.x)
		bus.emit("combat:shot", {
			owner, weapon: w.id, isPlayer: !!owner.isPlayer,
			x: origin.x, y: origin.y, z: origin.z,
			loudness: w.loudness,
		})

		const pellets = w.pellets || 1
		for (let i = 0; i < pellets; i++) {
			const d = this.jitter(dir, spread, i, pellets)
			if (w.projectileSpeed > 0) this.spawnProjectile(owner, w, origin, d)
			else this.hitscan(owner, w, origin, d, w.damage)
		}
	}

	/** Deterministic-ish cone jitter without allocating vectors. */
	jitter(dir, spread, index, total) {
		if (spread <= 0 && total === 1) return dir
		// Build an orthonormal basis around the aim direction.
		let ux = -dir.z, uy = 0, uz = dir.x
		const ul = Math.hypot(ux, uy, uz) || 1
		ux /= ul; uz /= ul
		const vx = uy * dir.z - uz * dir.y
		const vy = uz * dir.x - ux * dir.z
		const vz = ux * dir.y - uy * dir.x
		const angle = Math.random() * Math.PI * 2
		const radius = spread * (total > 1 ? (0.35 + Math.random() * 0.9) : Math.sqrt(Math.random()))
		const ox = Math.cos(angle) * radius
		const oy = Math.sin(angle) * radius
		const out = this._dir || (this._dir = { x: 0, y: 0, z: 0 })
		out.x = dir.x + ux * ox + vx * oy
		out.y = dir.y + uy * ox + vy * oy
		out.z = dir.z + uz * ox + vz * oy
		const l = Math.hypot(out.x, out.y, out.z) || 1
		out.x /= l; out.y /= l; out.z /= l
		return out
	}

	spawnProjectile(owner, w, origin, dir) {
		const p = this.projectiles[this.projectileCursor]
		this.projectileCursor = (this.projectileCursor + 1) % this.projectiles.length
		p.active = true
		p.x = origin.x; p.y = origin.y; p.z = origin.z
		p.dx = dir.x; p.dy = dir.y; p.dz = dir.z
		p.speed = w.projectileSpeed
		p.travelled = 0
		p.maxRange = w.range
		p.damage = w.damage
		p.owner = owner
		p.weapon = w
	}

	updateProjectiles(dt) {
		for (let i = 0; i < this.projectiles.length; i++) {
			const p = this.projectiles[i]
			if (!p.active) continue
			const step = Math.min(p.speed * dt, p.maxRange - p.travelled)
			const hit = this.traceSegment(p.owner, p.x, p.y, p.z, p.dx, p.dy, p.dz, step)
			this.particles.tracer(p.x, p.y, p.z, p.dx, p.dy, p.dz, step)
			if (hit) {
				this.resolveHit(p.owner, p.weapon, hit, p.damage, p.travelled + hit.distance)
				p.active = false
				continue
			}
			p.x += p.dx * step
			p.y += p.dy * step
			p.z += p.dz * step
			p.travelled += step
			if (p.travelled >= p.maxRange || p.y < this.world.groundAt(p.x, p.z) - 1) p.active = false
		}
	}

	hitscan(owner, w, origin, dir, damage) {
		const hit = this.traceSegment(owner, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, w.range)
		const length = hit ? hit.distance : Math.min(w.range, 120)
		this.particles.tracer(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, length)
		if (hit) this.resolveHit(owner, w, hit, damage, hit.distance)
	}

	/**
	 * Trace a segment against combatant hitboxes and world geometry.
	 * @returns {null|{distance:number,x:number,y:number,z:number,nx:number,ny:number,nz:number,entity:any,location:string,box:any,surface:string}}
	 */
	traceSegment(owner, ox, oy, oz, dx, dy, dz, maxDist) {
		let best = null
		let bestDist = maxDist

		// Characters first (cheap: a handful of AABBs each).
		for (let i = 0; i < this.targets.length; i++) {
			const t = this.targets[i]
			if (!t || t === owner || t.dead) continue
			const dxp = t.pos.x - ox
			const dzp = t.pos.z - oz
			// Quick reject: beyond the trace or clearly off-axis.
			const along = dxp * dx + dzp * dz
			if (along < -2 || along > bestDist + 2) continue
			const boxes = t.hitboxes ? t.hitboxes() : null
			if (!boxes) continue
			for (let b = 0; b < boxes.length; b++) {
				const h = boxes[b]
				const box = this.boxScratch
				box.minX = h.x - h.rx; box.maxX = h.x + h.rx
				box.minY = h.y - h.ry; box.maxY = h.y + h.ry
				box.minZ = h.z - h.rz; box.maxZ = h.z + h.rz
				const d = rayBox(ox, oy, oz, dx, dy, dz, box)
				if (d >= 0 && d < bestDist) {
					bestDist = d
					best = this._hit || (this._hit = {})
					best.distance = d
					best.entity = t
					best.location = h.type
					best.box = null
					best.surface = "flesh"
					best.x = ox + dx * d
					best.y = oy + dy * d
					best.z = oz + dz * d
					best.nx = -dx; best.ny = -dy; best.nz = -dz
				}
			}
		}

		// World geometry.
		const wall = this.world.collision.raycast(ox, oy, oz, dx, dy, dz, bestDist)
		if (wall.hit && wall.distance < bestDist) {
			best = this._hit || (this._hit = {})
			best.distance = wall.distance
			best.entity = null
			best.location = "world"
			best.box = wall.box
			best.surface = wall.box ? wall.box.surface : "concrete"
			best.x = wall.x; best.y = wall.y; best.z = wall.z
			best.nx = wall.nx; best.ny = wall.ny; best.nz = wall.nz
			bestDist = wall.distance
		}

		// Terrain: approximate by sampling the segment end point.
		if (!best || bestDist > 4) {
			const steps = 6
			for (let i = 1; i <= steps; i++) {
				const t = (bestDist / steps) * i
				const px = ox + dx * t
				const py = oy + dy * t
				const pz = oz + dz * t
				if (py <= this.world.groundAt(px, pz)) {
					best = this._hit || (this._hit = {})
					best.distance = t
					best.entity = null
					best.location = "world"
					best.box = null
					best.surface = this.world.surfaceAt(px, pz)
					best.x = px; best.y = py; best.z = pz
					best.nx = 0; best.ny = 1; best.nz = 0
					break
				}
			}
		}
		return best
	}

	// ------------------------------------------------------------ resolution

	/** Damage falloff over distance, per weapon. */
	falloff(w, distance) {
		if (distance <= w.falloffStart) return 1
		if (distance >= w.falloffEnd) return w.falloffFactor
		const t = (distance - w.falloffStart) / (w.falloffEnd - w.falloffStart)
		return 1 + (w.falloffFactor - 1) * t
	}

	resolveHit(owner, w, hit, baseDamage, distance) {
		this.particles.impact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, hit.surface)

		if (hit.entity) {
			const mult = HIT_LOCATIONS[hit.location] || 1
			const damage = baseDamage * mult * this.falloff(w, distance)
			const applied = hit.entity.applyDamage(damage, {
				location: hit.location,
				from: { x: owner.pos.x, z: owner.pos.z },
				attacker: owner,
				weapon: w.id,
			})
			if (owner.stats) {
				owner.stats.shotsHit++
				owner.stats.damageDealt += applied
				if (hit.location === "head") owner.stats.headshots++
			}
			bus.emit("combat:hit", {
				attacker: owner, victim: hit.entity, amount: applied,
				location: hit.location, headshot: hit.location === "head",
				byPlayer: !!owner.isPlayer, killed: hit.entity.dead,
				x: hit.x, y: hit.y, z: hit.z,
			})
			if (hit.entity.dead) {
				if (owner.stats) owner.stats.kills++
			}
			return applied
		}

		// Destructible world geometry (windows, crates, explosive barrels).
		if (hit.box) {
			if (hit.box.explosive) {
				this.detonate(hit.box, owner)
			} else if (hit.box.breakable) {
				const destroyed = this.world.collision.damageBox(hit.box, baseDamage)
				if (destroyed) {
					this.particles.dust(hit.x, hit.y, hit.z, 10)
					bus.emit("world:broken", { x: hit.x, y: hit.y, z: hit.z, surface: hit.box.surface })
				}
			}
		}
		return 0
	}

	/** Melee swing: short cone in front of the attacker. */
	melee(owner, origin, dir, w) {
		bus.emit("combat:shot", {
			owner, weapon: w.id, isPlayer: !!owner.isPlayer, melee: true,
			x: origin.x, y: origin.y, z: origin.z, loudness: w.loudness,
		})
		const hit = this.traceSegment(owner, origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, w.range)
		if (hit && hit.entity) this.resolveHit(owner, w, hit, w.damage, hit.distance)
		else if (hit) this.particles.impact(hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, hit.surface)
	}

	/**
	 * Area of effect damage used by explosive barrels and grenades.
	 * Line of sight is required so walls provide real protection.
	 */
	explode(x, y, z, radius, damage, owner, scale = 1) {
		this.particles.explosion(x, y, z, scale)
		bus.emit("explosion", { x, y, z, radius, scale })
		for (let i = 0; i < this.targets.length; i++) {
			const t = this.targets[i]
			if (!t || t.dead) continue
			const dx = t.pos.x - x
			const dy = (t.pos.y + 1) - y
			const dz = t.pos.z - z
			const dist = Math.hypot(dx, dy, dz)
			if (dist > radius) continue
			if (!this.world.collision.lineOfSight(x, y + 0.3, z, t.pos.x, t.pos.y + 1, t.pos.z)) continue
			const falloff = 1 - clamp(dist / radius, 0, 1)
			const applied = t.applyDamage(damage * falloff * falloff, {
				location: "chest", from: { x, z }, attacker: owner || null, cause: "explosion",
			})
			if (owner && owner.stats && applied > 0) {
				owner.stats.damageDealt += applied
				if (t.dead) owner.stats.kills++
			}
		}
		// Chain reaction: nearby barrels cook off shortly after.
		for (const box of this.world.explosives) {
			if (box.destroyed || box.pendingBlast) continue
			const bx = (box.minX + box.maxX) / 2
			const by = (box.minY + box.maxY) / 2
			const bz = (box.minZ + box.maxZ) / 2
			if (Math.hypot(bx - x, by - y, bz - z) < radius * 1.1) {
				box.pendingBlast = 0.12 + Math.random() * 0.25
				box.blastOwner = owner || null
			}
		}
	}

	detonate(box, owner) {
		if (box.destroyed) return
		box.destroyed = true
		const x = (box.minX + box.maxX) / 2
		const y = (box.minY + box.maxY) / 2
		const z = (box.minZ + box.maxZ) / 2
		this.explode(x, y, z, GAME.barrelBlastRadius, GAME.barrelBlastDamage, owner, 1.2)
	}

	/** Advance projectiles and queued barrel chain reactions. */
	update(dt) {
		this.updateProjectiles(dt)
		const list = this.world.explosives
		for (let i = 0; i < list.length; i++) {
			const box = list[i]
			if (!box.pendingBlast) continue
			box.pendingBlast -= dt
			if (box.pendingBlast <= 0) {
				box.pendingBlast = 0
				this.detonate(box, box.blastOwner || null)
			}
		}
	}

	reset() {
		for (const p of this.projectiles) p.active = false
	}
}

export { WEAPONS }
