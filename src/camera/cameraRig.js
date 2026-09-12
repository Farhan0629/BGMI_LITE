/**
 * Camera rig: over-the-shoulder third person by default, optional first
 * person, with spring-arm collision, ADS zoom, recoil kick, stance offsets
 * and configurable shake.
 */
import { PLAYER } from "../config/player.js"
import { RENDER } from "../config/graphics.js"
import { clamp, damp, lerp } from "../core/math.js"

export class CameraRig {
	constructor(collision) {
		this.collision = collision
		const c = PLAYER.camera
		this.yaw = 0
		this.pitch = -0.06
		this.mode = "third" // "third" | "first"
		this.distance = c.distance
		this.currentDistance = c.distance
		this.shoulder = c.shoulder
		this.currentShoulder = c.shoulder
		this.height = c.height
		this.currentHeight = c.height
		this.fov = RENDER.baseFov
		this.currentFov = RENDER.baseFov
		this.shake = 0
		this.shakeScale = 1
		this.recoilPitch = 0
		this.recoilYaw = 0
		this.x = 0
		this.y = 2
		this.z = 0
		this.focusX = 0
		this.focusY = 0
		this.focusZ = 0
		this.sensitivity = PLAYER.sensitivity
		this.invertY = false
		this.shakeTime = 0
	}

	setMode(mode) {
		this.mode = mode === "first" ? "first" : "third"
	}

	toggleMode() {
		this.setMode(this.mode === "third" ? "first" : "third")
	}

	/** Raw mouse delta in pixels. */
	addLook(dx, dy, aiming) {
		const scale = this.sensitivity * (aiming ? PLAYER.adsSensitivityScale : 1)
		this.yaw += dx * scale
		this.pitch += (this.invertY ? dy : -dy) * scale
		const limit = PLAYER.camera.pitchLimit
		this.pitch = clamp(this.pitch, -limit, limit)
		if (this.yaw > Math.PI) this.yaw -= Math.PI * 2
		if (this.yaw < -Math.PI) this.yaw += Math.PI * 2
	}

	/** Weapon recoil pushes the view; it is recovered smoothly in update(). */
	addRecoil(pitch, yaw) {
		this.recoilPitch += pitch
		this.recoilYaw += yaw
	}

	addShake(amount) {
		this.shake = Math.min(1.4, this.shake + amount * this.shakeScale)
	}

	/**
	 * @param {number} dt
	 * @param {object} target {x, y, z} character feet position
	 * @param {object} state {aiming, sprinting, crouching, grounded, dead, zoomFov}
	 */
	update(dt, target, state) {
		const c = PLAYER.camera

		// Recoil recovery: fast decay then settle.
		this.pitch = clamp(this.pitch + this.recoilPitch, -c.pitchLimit, c.pitchLimit)
		this.yaw += this.recoilYaw
		this.recoilPitch *= Math.max(0, 1 - dt * 9)
		this.recoilYaw *= Math.max(0, 1 - dt * 9)
		if (Math.abs(this.recoilPitch) < 1e-5) this.recoilPitch = 0
		if (Math.abs(this.recoilYaw) < 1e-5) this.recoilYaw = 0

		// Target rig geometry per stance.
		const aiming = !!state.aiming
		const wantDistance = state.dead ? c.deathDistance
			: aiming ? c.adsDistance
				: state.sprinting ? c.sprintDistance : c.distance
		const wantShoulder = aiming ? c.adsShoulder : c.shoulder
		const wantHeight = (state.crouching ? c.crouchHeight : c.height) + (state.dead ? c.deathHeight : 0)
		const wantFov = state.zoomFov || (aiming ? RENDER.adsFov : state.sprinting ? RENDER.sprintFov : RENDER.baseFov)

		const responsiveness = state.dead ? 3 : 11
		this.currentDistance = damp(this.currentDistance, wantDistance, responsiveness, dt)
		this.currentShoulder = damp(this.currentShoulder, wantShoulder, responsiveness, dt)
		this.currentHeight = damp(this.currentHeight, wantHeight, 9, dt)
		this.currentFov = damp(this.currentFov, wantFov, 12, dt)

		// Focus point: shoulder-offset pivot above the character.
		const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw)
		const rightX = cy
		const rightZ = -sy
		const focusX = target.x + rightX * this.currentShoulder
		const focusY = target.y + this.currentHeight
		const focusZ = target.z + rightZ * this.currentShoulder
		this.focusX = focusX
		this.focusY = focusY
		this.focusZ = focusZ

		const cp = Math.cos(this.pitch)
		const dirX = sy * cp
		const dirY = Math.sin(this.pitch)
		const dirZ = -cy * cp

		let distance = this.mode === "first" ? 0 : this.currentDistance

		// Spring-arm collision: pull the camera in if geometry is behind it.
		if (distance > 0.05 && this.collision) {
			const hit = this.collision.raycast(focusX, focusY, focusZ, -dirX, -dirY, -dirZ, distance + c.collisionPad)
			if (hit) distance = Math.max(c.minDistance, hit.distance - c.collisionPad)
		}

		// Shake: decaying pseudo-random offset (deterministic, allocation free).
		this.shake = Math.max(0, this.shake - dt * c.shakeDecay)
		this.shakeTime += dt
		const s = this.shake * this.shake * c.shakeAmount * this.shakeScale
		const sx = Math.sin(this.shakeTime * 47.3) * s
		const sy2 = Math.sin(this.shakeTime * 61.7 + 1.3) * s
		const sz = Math.sin(this.shakeTime * 39.1 + 2.7) * s * 0.6

		if (this.mode === "first") {
			this.x = focusX + dirX * 0.08 + sx
			this.y = focusY + 0.12 + sy2
			this.z = focusZ + dirZ * 0.08 + sz
		} else {
			this.currentDistance = distance
			this.x = focusX - dirX * distance + sx
			this.y = focusY - dirY * distance + sy2
			this.z = focusZ - dirZ * distance + sz
		}
		this.fov = this.currentFov
	}

	/** Camera description consumed by the renderer. */
	get view() {
		return { x: this.x, y: this.y, z: this.z, yaw: this.yaw, pitch: this.pitch, fov: this.fov }
	}

	/** Forward unit vector of the aim direction. */
	forward(out = { x: 0, y: 0, z: 0 }) {
		const cp = Math.cos(this.pitch)
		out.x = Math.sin(this.yaw) * cp
		out.y = Math.sin(this.pitch)
		out.z = -Math.cos(this.yaw) * cp
		return out
	}

	reset(yaw = 0) {
		this.yaw = yaw
		this.pitch = -0.06
		this.shake = 0
		this.recoilPitch = 0
		this.recoilYaw = 0
		this.currentDistance = PLAYER.camera.distance
		this.currentFov = RENDER.baseFov
	}
}

export { lerp }
