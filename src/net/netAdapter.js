/**
 * Networking seam.
 *
 * Version 1 runs entirely offline, but every gameplay system already talks to
 * the match through explicit state objects, so multiplayer only needs a
 * transport that (a) sends local input and (b) applies authoritative
 * snapshots. This adapter defines that contract now and ships a local
 * implementation, so V2 can drop in a WebSocket implementation without
 * touching gameplay code.
 *
 * Contract:
 *   connect(roomCode)        -> Promise<{roomCode, playerIndex}>
 *   sendInput(inputFrame)    -> void   (client is input-only; never damage)
 *   onSnapshot(cb)           -> subscribe to authoritative world state
 *   interpolate(dt)          -> advance remote entity interpolation buffers
 */
import { bus } from "../core/events.js"

export const NET_MODE = { OFFLINE: "offline", CLIENT: "client" }

/** Input frame sent to the server. Only intent - never results. */
export function makeInputFrame(seq, player, input) {
	return {
		seq,
		t: performance.now(),
		move: { x: input.moveX, y: input.moveY },
		yaw: player.yaw,
		pitch: player.pitch,
		buttons:
			(input.fire ? 1 : 0) |
			(input.aim ? 2 : 0) |
			(input.sprint ? 4 : 0) |
			(input.crouch ? 8 : 0) |
			(input.jump ? 16 : 0) |
			(input.reload ? 32 : 0) |
			(input.interact ? 64 : 0),
		slot: player.weapons.slotIndex,
	}
}

/**
 * Interpolation buffer for a remote entity. Remote players are rendered ~100ms
 * in the past and blended between snapshots so they never teleport.
 */
export class RemoteEntityBuffer {
	constructor(delay = 0.1) {
		this.delay = delay
		this.samples = []
		this.state = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, anim: "idle" }
	}

	push(sample) {
		this.samples.push(sample)
		while (this.samples.length > 32) this.samples.shift()
	}

	sample(now) {
		const target = now - this.delay
		const s = this.samples
		if (s.length === 0) return this.state
		if (s.length === 1 || target <= s[0].t) {
			Object.assign(this.state, s[0])
			return this.state
		}
		for (let i = 1; i < s.length; i++) {
			if (s[i].t >= target) {
				const a = s[i - 1]
				const b = s[i]
				const span = b.t - a.t || 1
				const k = (target - a.t) / span
				this.state.x = a.x + (b.x - a.x) * k
				this.state.y = a.y + (b.y - a.y) * k
				this.state.z = a.z + (b.z - a.z) * k
				// Shortest-arc yaw blend.
				let dy = b.yaw - a.yaw
				while (dy > Math.PI) dy -= Math.PI * 2
				while (dy < -Math.PI) dy += Math.PI * 2
				this.state.yaw = a.yaw + dy * k
				this.state.pitch = a.pitch + (b.pitch - a.pitch) * k
				this.state.anim = b.anim
				return this.state
			}
		}
		Object.assign(this.state, s[s.length - 1])
		return this.state
	}
}

export class NetAdapter {
	constructor() {
		this.mode = NET_MODE.OFFLINE
		this.connected = false
		this.latency = 0
		this.seq = 0
		this.remotes = new Map()
		this.snapshotHandlers = []
		this.socket = null
	}

	/**
	 * V1: resolves immediately in offline mode. V2 replaces the body with a
	 * WebSocket handshake against server/GameServer.js.
	 */
	async connect(roomCode) {
		this.mode = NET_MODE.OFFLINE
		this.connected = false
		return { roomCode: roomCode || null, playerIndex: 0, offline: true }
	}

	disconnect() {
		if (this.socket) {
			try { this.socket.close() } catch (e) { /* ignore */ }
			this.socket = null
		}
		this.connected = false
		this.remotes.clear()
	}

	sendInput(player, input) {
		if (!this.connected) return null
		const frame = makeInputFrame(++this.seq, player, input)
		if (this.socket && this.socket.readyState === 1) {
			this.socket.send(JSON.stringify({ type: "input", frame }))
		}
		return frame
	}

	onSnapshot(cb) {
		this.snapshotHandlers.push(cb)
		return () => {
			const i = this.snapshotHandlers.indexOf(cb)
			if (i >= 0) this.snapshotHandlers.splice(i, 1)
		}
	}

	/** Feed an authoritative snapshot into the interpolation buffers. */
	applySnapshot(snapshot) {
		if (snapshot.players) {
			for (const p of snapshot.players) {
				let buf = this.remotes.get(p.id)
				if (!buf) {
					buf = new RemoteEntityBuffer()
					this.remotes.set(p.id, buf)
				}
				buf.push({ t: snapshot.t, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, anim: p.anim })
			}
		}
		for (const cb of this.snapshotHandlers) cb(snapshot)
	}

	/** Called each frame by the game loop when networked. */
	interpolate(now) {
		this.remotes.forEach((buf) => buf.sample(now))
	}

	handleConnectionLost(reason) {
		this.connected = false
		bus.emit("ui:toast", { text: "CONNECTION LOST - " + (reason || "attempting to reconnect..."), tone: "warn" })
	}
}
