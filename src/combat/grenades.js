/**
 * Frag grenades: pooled ballistic projectiles with bounce, fuse and an
 * area-of-effect blast routed through CombatSystem.explode so damage, shake
 * and particles match barrel explosions.
 */
import { GAME } from "../config/game.js"
import { bus } from "../core/events.js"

const POOL_SIZE = 24
const GRAVITY = 22
const RESTITUTION = 0.32
const FRICTION = 0.72
const RADIUS = 0.14

export class GrenadeSystem {
	constructor(world, combat, particles) {
		this.world = world
		this.combat = combat
		this.particles = particles
		this.pool = []
		for (let i = 0; i < POOL_SIZE; i++) {
			this.pool.push({
				active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
				fuse: 0, owner: null, spin: 0,
			})
		}
	}

	/** Throw a grenade from an origin along a direction. */
	throw_(owner, x, y, z, dx, dy, dz, power = 18) {
		for (let i = 0; i < this.pool.length; i++) {
			const g = this.pool[i]
			if (g.active) continue
			g.active = true
			g.x = x
			g.y = y
			g.z = z
			g.vx = dx * power
			g.vy = dy * power + 4
			g.vz = dz * power
			g.fuse = GAME.grenadeFuse
			g.owner = owner
			g.spin = Math.random() * Math.PI * 2
			return g
		}
		return null
	}

	update(dt) {
		for (let i = 0; i < this.pool.length; i++) {
			const g = this.pool[i]
			if (!g.active) continue
			g.fuse -= dt
			g.vy -= GRAVITY * dt
			g.spin += dt * 8

			// Sweep against static geometry; bounce off the first hit.
			const len = Math.hypot(g.vx, g.vy, g.vz) * dt
			if (len > 0.0001) {
				const inv = 1 / (len / dt)
				const hit = this.world.collision.raycast(
					g.x, g.y, g.z, g.vx * inv, g.vy * inv, g.vz * inv, len + RADIUS)
				if (hit.hit) {
					g.x = hit.x + hit.nx * RADIUS
					g.y = hit.y + hit.ny * RADIUS
					g.z = hit.z + hit.nz * RADIUS
					const dot = g.vx * hit.nx + g.vy * hit.ny + g.vz * hit.nz
					g.vx = (g.vx - 2 * dot * hit.nx) * RESTITUTION
					g.vy = (g.vy - 2 * dot * hit.ny) * RESTITUTION
					g.vz = (g.vz - 2 * dot * hit.nz) * RESTITUTION
				} else {
					g.x += g.vx * dt
					g.y += g.vy * dt
					g.z += g.vz * dt
				}
			}

			// Ground contact.
			const groundY = this.world.groundAt(g.x, g.z)
			if (g.y - RADIUS <= groundY) {
				g.y = groundY + RADIUS
				if (g.vy < 0) g.vy = -g.vy * RESTITUTION
				g.vx *= FRICTION
				g.vz *= FRICTION
				if (Math.abs(g.vy) < 0.6) g.vy = 0
			}

			if (g.fuse <= 0) {
				this.detonate(g)
				continue
			}
			// Light smoke trail so thrown grenades are readable.
			if (this.particles && Math.random() < 0.35) {
				this.particles.spawn("smoke", g.x, g.y, g.z, 0, 0.4, 0, 0.35)
			}
		}
	}

	detonate(g) {
		g.active = false
		this.combat.explode(g.x, g.y, g.z, GAME.grenadeBlastRadius, GAME.grenadeBlastDamage, g.owner, 1)
		bus.emit("explosion", { x: g.x, y: g.y, z: g.z, scale: 1 })
	}

	/** Draw active grenades as small dark spheres. */
	draw(scene) {
		for (let i = 0; i < this.pool.length; i++) {
			const g = this.pool[i]
			if (!g.active) continue
			scene.addDynamic("sphereLow", g.x, g.y, g.z, 0.15, 0.15, 0.15, g.spin, 0.18, 0.2, 0.17, 0.55, 0)
		}
	}

	activeCount() {
		let n = 0
		for (let i = 0; i < this.pool.length; i++) if (this.pool[i].active) n++
		return n
	}

	reset() {
		for (let i = 0; i < this.pool.length; i++) this.pool[i].active = false
	}
}
