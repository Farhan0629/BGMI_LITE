/**
 * Server-side validation. Nothing the client reports is trusted: movement is
 * re-simulated from input, fire rate is checked against the weapon config and
 * damage is computed on the server only.
 */
import { PLAYER } from "../../src/config/player.js"
import { WEAPONS, HIT_LOCATIONS } from "../../src/config/weapons.js"

/** Generous tolerance for network jitter before a move is considered a hack. */
const SPEED_TOLERANCE = 1.35
const TELEPORT_LIMIT = 6 // metres in a single input frame

export function sanitizeInputFrame(frame) {
	if (!frame || typeof frame !== "object") return null
	const move = frame.move || {}
	const clamp1 = (v) => (typeof v === "number" && isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0)
	const num = (v, fallback = 0) => (typeof v === "number" && isFinite(v) ? v : fallback)
	return {
		seq: Math.max(0, Math.floor(num(frame.seq))),
		move: { x: clamp1(move.x), y: clamp1(move.y) },
		yaw: num(frame.yaw),
		pitch: Math.max(-1.2, Math.min(1.2, num(frame.pitch))),
		buttons: Math.floor(num(frame.buttons)) & 0xff,
		slot: Math.max(0, Math.min(2, Math.floor(num(frame.slot)))),
	}
}

/**
 * Reject impossible movement. Returns the accepted position, which the server
 * then treats as truth and echoes back in the next snapshot.
 */
export function validateMovement(session, next, dt) {
	const prev = session.state.pos
	const dx = next.x - prev.x
	const dz = next.z - prev.z
	const distance = Math.hypot(dx, dz)
	const maxDistance = PLAYER.sprintSpeed * SPEED_TOLERANCE * Math.max(dt, 1 / 60)
	if (distance > TELEPORT_LIMIT) {
		session.flag("teleport")
		return prev
	}
	if (distance > maxDistance) {
		session.flag("speed")
		const scale = maxDistance / distance
		return { x: prev.x + dx * scale, y: next.y, z: prev.z + dz * scale }
	}
	return next
}

/** Enforce the weapon's cyclic rate and magazine contents. */
export function canFire(session, now) {
	const weapon = WEAPONS[session.state.weaponId]
	if (!weapon || weapon.type === "melee") return !!weapon
	const interval = 60000 / weapon.rpm
	if (now - session.lastShotAt < interval * 0.9) {
		session.flag("fireRate")
		return false
	}
	if (session.state.magazine <= 0) return false
	return true
}

/** Authoritative damage: server picks the hit location and applies armour. */
export function computeDamage(weapon, distance, location, armor) {
	const base = weapon.damage * (HIT_LOCATIONS[location] || 1)
	const falloff = weapon.falloffStart && distance > weapon.falloffStart
		? Math.max(weapon.minDamageScale || 0.45,
			1 - (distance - weapon.falloffStart) / (weapon.falloffEnd || 200))
		: 1
	let damage = base * falloff
	if (armor) {
		const absorb = location === "head"
			? (PLAYER.armor.helmetAbsorb[armor.helmetLevel] || 0)
			: (PLAYER.armor.vestAbsorb[armor.vestLevel] || 0)
		damage *= 1 - absorb
	}
	return damage
}

/** Simple token bucket so a client cannot flood the server with inputs. */
export class RateLimiter {
	constructor(perSecond) {
		this.capacity = perSecond
		this.tokens = perSecond
		this.last = Date.now()
	}

	allow(cost = 1) {
		const now = Date.now()
		this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.capacity)
		this.last = now
		if (this.tokens < cost) return false
		this.tokens -= cost
		return true
	}
}
