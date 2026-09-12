/**
 * One connected player. Holds the authoritative state, the pending input
 * queue and the anti-cheat flags.
 */
import { PLAYER } from "../src/config/player.js"
import { WEAPONS } from "../src/config/weapons.js"
import { RateLimiter, sanitizeInputFrame } from "./networking/validation.js"
import { MAX_INPUTS_PER_SECOND, SERVER_MSG } from "./networking/protocol.js"

let nextId = 1

export class PlayerSession {
	constructor(connection) {
		this.id = "P" + (nextId++)
		this.connection = connection
		this.name = "OPERATOR-" + this.id
		this.room = null
		this.ready = false
		this.inputs = []
		this.limiter = new RateLimiter(MAX_INPUTS_PER_SECOND)
		this.lastShotAt = 0
		this.lastAckSeq = 0
		this.latency = 0
		this.flags = {}
		this.state = {
			pos: { x: 0, y: 0, z: 0 },
			vel: { x: 0, y: 0, z: 0 },
			yaw: 0,
			pitch: 0,
			grounded: true,
			crouching: false,
			health: PLAYER.maxHealth,
			helmetLevel: 0,
			vestLevel: 0,
			weaponId: "pistol_sidewinder",
			magazine: WEAPONS.pistol_sidewinder.magazine,
			reserve: 45,
			dead: false,
			anim: "idle",
		}
		this.stats = { kills: 0, damage: 0, shots: 0, hits: 0 }
	}

	queueInput(rawFrame) {
		if (!this.limiter.allow()) {
			this.flag("inputFlood")
			return false
		}
		const frame = sanitizeInputFrame(rawFrame)
		if (!frame || frame.seq <= this.lastAckSeq) return false
		// Bound the queue so a lagging client cannot make the server do
		// unbounded work when its backlog arrives.
		if (this.inputs.length > 12) this.inputs.shift()
		this.inputs.push(frame)
		return true
	}

	flag(kind) {
		this.flags[kind] = (this.flags[kind] || 0) + 1
		if (this.flags[kind] === 20) {
			console.warn("[anticheat] repeated " + kind + " violations from " + this.id)
		}
	}

	spawn(point) {
		this.state.pos = { x: point.x, y: 0, z: point.z }
		this.state.vel = { x: 0, y: 0, z: 0 }
		this.state.yaw = point.yaw || 0
		this.state.pitch = 0
		this.state.health = PLAYER.maxHealth
		this.state.dead = false
		this.state.weaponId = "pistol_sidewinder"
		this.state.magazine = WEAPONS.pistol_sidewinder.magazine
		this.state.reserve = 45
		this.stats = { kills: 0, damage: 0, shots: 0, hits: 0 }
		this.inputs.length = 0
	}

	send(type, payload) {
		return this.connection.send(Object.assign({ type }, payload))
	}

	error(code, message) {
		this.send(SERVER_MSG.ERROR, { code, message })
	}

	/** Compact state for snapshots. */
	snapshot() {
		const s = this.state
		return {
			id: this.id,
			x: +s.pos.x.toFixed(3), y: +s.pos.y.toFixed(3), z: +s.pos.z.toFixed(3),
			yaw: +s.yaw.toFixed(3), pitch: +s.pitch.toFixed(3),
			health: Math.round(s.health),
			weapon: s.weaponId,
			mag: s.magazine,
			dead: s.dead,
			anim: s.anim,
		}
	}
}
