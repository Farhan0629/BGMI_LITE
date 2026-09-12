/**
 * A private 1v1 room: lobby, ready-up, countdown, authoritative simulation
 * and the win condition.
 *
 * The simulation reuses the shared configs in src/config so client prediction
 * and server truth agree on speeds, weapon rates and damage.
 */
import { PLAYER } from "../src/config/player.js"
import { WEAPONS } from "../src/config/weapons.js"
import { ARENA } from "./blacksiteArena.js"
import { SERVER_MSG, TICK_RATE } from "./networking/protocol.js"
import { canFire, computeDamage, validateMovement } from "./networking/validation.js"

const STATE = { LOBBY: "lobby", COUNTDOWN: "countdown", LIVE: "live", OVER: "over" }
const COUNTDOWN_SECONDS = 3
const DT = 1 / TICK_RATE

export class Room {
	constructor(code) {
		this.code = code
		this.players = []
		this.state = STATE.LOBBY
		this.countdown = 0
		this.elapsed = 0
		this.tick = 0
		this.winner = null
		this.createdAt = Date.now()
	}

	get full() {
		return this.players.length >= 2
	}

	get empty() {
		return this.players.length === 0
	}

	add(session) {
		if (this.full) return false
		this.players.push(session)
		session.room = this
		session.ready = false
		session.spawn(ARENA.spawns[this.players.length - 1] || ARENA.spawns[0])
		this.broadcastRoomState()
		return true
	}

	remove(session) {
		const i = this.players.indexOf(session)
		if (i < 0) return
		this.players.splice(i, 1)
		session.room = null
		// A mid-match disconnect awards the win to the remaining player rather
		// than leaving the match hanging.
		if (this.state === STATE.LIVE && this.players.length === 1) {
			this.finish(this.players[0], "opponent disconnected")
		} else {
			this.broadcastRoomState()
		}
	}

	broadcast(type, payload) {
		for (const p of this.players) p.send(type, payload)
	}

	broadcastRoomState() {
		this.broadcast(SERVER_MSG.ROOM_STATE, {
			code: this.code,
			state: this.state,
			map: ARENA.name,
			players: this.players.map((p, i) => ({
				id: p.id, slot: i + 1, name: p.name, ready: p.ready,
			})),
		})
	}

	setReady(session, ready) {
		session.ready = !!ready
		this.broadcastRoomState()
		if (this.state === STATE.LOBBY && this.full && this.players.every((p) => p.ready)) {
			this.state = STATE.COUNTDOWN
			this.countdown = COUNTDOWN_SECONDS
			this.broadcast(SERVER_MSG.MATCH_START, {
				countdown: COUNTDOWN_SECONDS,
				map: ARENA.name,
				spawns: ARENA.spawns,
				blocks: ARENA.blocks,
				loot: ARENA.loot,
			})
		}
	}

	rematch() {
		if (this.state !== STATE.OVER) return
		this.state = STATE.LOBBY
		this.winner = null
		this.elapsed = 0
		for (let i = 0; i < this.players.length; i++) {
			this.players[i].ready = false
			this.players[i].spawn(ARENA.spawns[i] || ARENA.spawns[0])
		}
		this.broadcastRoomState()
	}

	// --------------------------------------------------------------- simulation

	update(dt) {
		if (this.state === STATE.COUNTDOWN) {
			this.countdown -= dt
			if (this.countdown <= 0) {
				this.state = STATE.LIVE
				this.broadcastRoomState()
			}
			return
		}
		if (this.state !== STATE.LIVE) return

		this.elapsed += dt
		for (const session of this.players) this.simulate(session, dt)
		this.tick++
		this.sendSnapshot()
	}

	/** Consume queued inputs and advance the authoritative player state. */
	simulate(session, dt) {
		const s = session.state
		if (s.dead) return
		const frames = session.inputs
		if (frames.length === 0) return
		for (let i = 0; i < frames.length; i++) {
			const f = frames[i]
			session.lastAckSeq = f.seq
			s.yaw = f.yaw
			s.pitch = f.pitch
			s.crouching = (f.buttons & 8) !== 0

			// Movement is derived from intent on the server: the client never
			// tells us where it is.
			const sprinting = (f.buttons & 4) !== 0 && f.move.y > 0 && !s.crouching
			const speed = s.crouching ? PLAYER.crouchSpeed
				: sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed
			const cy = Math.cos(s.yaw)
			const sy = Math.sin(s.yaw)
			let wx = sy * f.move.y + cy * f.move.x
			let wz = -cy * f.move.y - sy * f.move.x
			const len = Math.hypot(wx, wz)
			if (len > 0.0001) {
				wx /= len
				wz /= len
			}
			const proposed = {
				x: s.pos.x + wx * speed * dt,
				y: 0,
				z: s.pos.z + wz * speed * dt,
			}
			const accepted = validateMovement(session, proposed, dt)
			// Keep players inside the arena walls.
			const limit = ARENA.halfSize - 2
			accepted.x = Math.max(-limit, Math.min(limit, accepted.x))
			accepted.z = Math.max(-limit, Math.min(limit, accepted.z))
			s.pos = accepted
			s.anim = len > 0.01 ? (sprinting ? "sprint" : "walk") : "idle"

			if ((f.buttons & 1) !== 0) this.tryFire(session)
			if ((f.buttons & 32) !== 0) this.reload(session)
		}
		frames.length = 0
	}

	reload(session) {
		const s = session.state
		const weapon = WEAPONS[s.weaponId]
		if (!weapon || s.reserve <= 0 || s.magazine >= weapon.magazine) return
		const need = weapon.magazine - s.magazine
		const take = Math.min(need, s.reserve)
		s.magazine += take
		s.reserve -= take
	}

	/** Server-side hitscan against the opponent capsule. */
	tryFire(session) {
		const now = Date.now()
		if (!canFire(session, now)) return
		session.lastShotAt = now
		const s = session.state
		const weapon = WEAPONS[s.weaponId]
		if (weapon.type !== "melee") s.magazine--
		session.stats.shots++

		const target = this.players.find((p) => p !== session && !p.state.dead)
		if (!target) return
		const t = target.state
		const dx = t.pos.x - s.pos.x
		const dz = t.pos.z - s.pos.z
		const distance = Math.hypot(dx, dz)
		if (weapon.type === "melee" && distance > weapon.range) return

		// Angular test: is the opponent inside the shot cone?
		const aimX = Math.sin(s.yaw)
		const aimZ = -Math.cos(s.yaw)
		const dot = (dx * aimX + dz * aimZ) / (distance || 1)
		const tolerance = Math.max(0.985, 1 - (PLAYER.radius * 1.6) / Math.max(distance, 1))
		if (dot < tolerance) return

		// Pitch decides the hit location; the client never sends this.
		const location = s.pitch > 0.09 ? "head" : s.pitch < -0.12 ? "legs" : "chest"
		const damage = computeDamage(weapon, distance, location,
			{ helmetLevel: t.helmetLevel, vestLevel: t.vestLevel })
		t.health -= damage
		session.stats.hits++
		session.stats.damage += damage
		this.broadcast(SERVER_MSG.EVENT, {
			event: "hit", by: session.id, on: target.id,
			location, damage: Math.round(damage),
		})
		if (t.health <= 0) {
			t.health = 0
			t.dead = true
			t.anim = "death"
			session.stats.kills++
			this.finish(session, "elimination")
		}
	}

	finish(winner, reason) {
		this.state = STATE.OVER
		this.winner = winner ? winner.id : null
		for (const p of this.players) {
			const won = p === winner
			p.send(SERVER_MSG.MATCH_END, {
				victory: won,
				reason,
				stats: {
					kills: p.stats.kills,
					damage: Math.round(p.stats.damage),
					accuracy: p.stats.shots ? p.stats.hits / p.stats.shots : 0,
					survival: this.elapsed,
				},
			})
		}
	}

	sendSnapshot() {
		const snapshot = {
			t: Date.now(),
			tick: this.tick,
			players: this.players.map((p) => p.snapshot()),
		}
		for (const p of this.players) {
			p.send(SERVER_MSG.SNAPSHOT, { snapshot, ack: p.lastAckSeq })
		}
	}
}

export { STATE as ROOM_STATE, DT }
