/**
 * Ranger ATV - a lightweight original vehicle.
 *
 * Intentionally simple arcade physics: engine force along the facing vector,
 * speed-scaled steering, lateral grip that kills side slip, gravity plus the
 * shared collision sweep used by characters. Occupant transforms are handled
 * by the player (the player is parented to the seat while driving).
 */
import { clamp, damp, wrapAngle } from "../core/math.js"
import { resolveMovement } from "../physics/collision.js"
import { bus } from "../core/events.js"

export const ATV = {
	name: "Ranger ATV",
	maxSpeed: 19,
	reverseSpeed: 6.5,
	accel: 14,
	brake: 26,
	drag: 1.6,
	steerRate: 2.2,
	grip: 9,
	radius: 1.1,
	height: 1.5,
	seatHeight: 1.05,
	maxHealth: 260,
	enterRange: 3.2,
}

export class Vehicle {
	constructor(world, x, z, yaw = 0) {
		this.world = world
		this.pos = { x, y: world.groundAt(x, z) + 0.5, z }
		this.vel = { x: 0, y: 0, z: 0 }
		this.yaw = yaw
		this.speed = 0
		this.steer = 0
		this.wheelSpin = 0
		this.health = ATV.maxHealth
		this.driver = null
		this.grounded = true
		this.destroyed = false
	}

	get occupied() {
		return !!this.driver
	}

	seatPosition(out) {
		out.x = this.pos.x - Math.sin(this.yaw) * 0.1
		out.y = this.pos.y + ATV.seatHeight
		out.z = this.pos.z + Math.cos(this.yaw) * 0.1
		return out
	}

	enter(entity) {
		if (this.driver || this.destroyed) return false
		this.driver = entity
		bus.emit("ui:toast", { text: "ENTERED " + ATV.name.toUpperCase() })
		return true
	}

	exit() {
		if (!this.driver) return null
		const entity = this.driver
		this.driver = null
		// Place the occupant beside the vehicle, clear of the chassis.
		const side = this.yaw + Math.PI / 2
		const x = this.pos.x + Math.sin(side) * 1.6
		const z = this.pos.z - Math.cos(side) * 1.6
		entity.pos.x = x
		entity.pos.z = z
		entity.pos.y = this.world.groundAt(x, z) + 0.1
		entity.vel.x = this.vel.x * 0.4
		entity.vel.z = this.vel.z * 0.4
		entity.vel.y = 0
		return entity
	}

	damage(amount) {
		if (this.destroyed) return
		this.health -= amount
		if (this.health <= 0) {
			this.destroyed = true
			if (this.driver) this.exit()
			bus.emit("explosion", { x: this.pos.x, y: this.pos.y + 0.5, z: this.pos.z, scale: 1.2 })
		}
	}

	/**
	 * @param {number} dt
	 * @param {object|null} input {forward, right, brake} in -1..1, null when idle
	 */
	update(dt, input) {
		if (this.destroyed) return
		const throttle = input ? input.forward : 0
		const steerInput = input ? input.right : 0
		const braking = input ? input.brake : false

		// Longitudinal speed.
		if (throttle > 0) this.speed += ATV.accel * throttle * dt
		else if (throttle < 0) this.speed += ATV.accel * 0.7 * throttle * dt
		if (braking) this.speed = damp(this.speed, 0, ATV.brake * 0.4, dt)
		this.speed = damp(this.speed, 0, ATV.drag * (throttle === 0 ? 2.2 : 0.4), dt)
		this.speed = clamp(this.speed, -ATV.reverseSpeed, ATV.maxSpeed)

		// Steering scales down at low speed so it does not pivot in place.
		const speedFactor = clamp(Math.abs(this.speed) / 6, 0, 1)
		this.steer = damp(this.steer, steerInput, 8, dt)
		this.yaw = wrapAngle(this.yaw + this.steer * ATV.steerRate * speedFactor * dt * Math.sign(this.speed || 1))

		// Convert speed into world velocity with lateral grip.
		const fx = Math.sin(this.yaw)
		const fz = -Math.cos(this.yaw)
		const targetX = fx * this.speed
		const targetZ = fz * this.speed
		this.vel.x = damp(this.vel.x, targetX, ATV.grip, dt)
		this.vel.z = damp(this.vel.z, targetZ, ATV.grip, dt)
		this.vel.y -= 24 * dt

		const terrainY = this.world.groundAt(this.pos.x, this.pos.z)
		const res = resolveMovement(this.world, this.pos, this.vel, ATV.radius, ATV.height, dt, 0.7, terrainY)
		this.grounded = res.grounded
		if (res.hitWall && Math.abs(this.speed) > 6) {
			// Crunch into the obstacle: lose most momentum and take chassis damage.
			this.damage(Math.abs(this.speed) * 1.2)
			this.speed *= 0.25
		}
		if (this.grounded) this.vel.y = 0
		this.wheelSpin += this.speed * dt * 2.4

		// Keep the occupant glued to the seat.
		if (this.driver) {
			this.seatPosition(this.driver.pos)
			this.driver.vel.x = 0
			this.driver.vel.y = 0
			this.driver.vel.z = 0
		}
	}

	get speed01() {
		return clamp(Math.abs(this.speed) / ATV.maxSpeed, 0, 1)
	}

	/** Chassis drawn from primitives: frame, seat, rack, wheels, bars. */
	draw(scene) {
		const x = this.pos.x
		const y = this.pos.y
		const z = this.pos.z
		const yaw = this.yaw
		const burnt = this.destroyed
		const r = burnt ? 0.16 : 0.34
		const g = burnt ? 0.15 : 0.36
		const b = burnt ? 0.14 : 0.3

		scene.addDynamic("box", x, y + 0.55, z, 1.5, 0.35, 2.3, yaw, r, g, b, 0.6, 0)
		scene.addDynamic("box", x, y + 0.95, z - 0.25, 0.85, 0.35, 0.95, yaw, 0.1, 0.1, 0.11, 0.85, 0)
		scene.addDynamic("box", x, y + 0.85, z + 0.85, 1.1, 0.12, 0.8, yaw, 0.22, 0.23, 0.21, 0.75, 0)
		scene.addDynamic("cylLow", x, y + 1.2, z - 0.95, 0.08, 0.8, 0.08, yaw, 0.12, 0.12, 0.13, 0.5, 0)

		const wheelPositions = [[-0.72, -0.85], [0.72, -0.85], [-0.72, 0.9], [0.72, 0.9]]
		const sy = Math.sin(yaw)
		const cy = Math.cos(yaw)
		for (let i = 0; i < 4; i++) {
			const ox = wheelPositions[i][0]
			const oz = wheelPositions[i][1]
			const wx = x + ox * cy + oz * sy
			const wz = z - ox * sy + oz * cy
			scene.addDynamic("cylLow", wx, y + 0.34, wz, 0.34, 0.22, 0.34,
				yaw + Math.PI / 2, 0.07, 0.07, 0.08, 0.95, 0, this.wheelSpin)
		}
		if (!burnt) {
			// Headlight block, emissive at night.
			scene.addDynamic("box", x + sy * 0 - sy * 0, y + 0.95, z - cy * 1.15, 0.5, 0.16, 0.1, yaw, 0.9, 0.86, 0.7, 0.3, 0.6)
		}
	}
}

/** Spawn vehicles at the world's designated vehicle spawn points. */
export function spawnVehicles(world, max = 6) {
	const list = []
	const spawns = world.vehicleSpawns || []
	for (let i = 0; i < spawns.length && list.length < max; i++) {
		const s = spawns[i]
		list.push(new Vehicle(world, s.x, s.z, s.yaw || 0))
	}
	return list
}
