/**
 * Bot manager: spawning, noise propagation, simulation LOD and alive counts.
 *
 * Bots are pooled so restarting a match never reallocates. Only bots within
 * the render/simulation radius are drawn, and noise events are broadcast
 * through the event bus so perception stays decoupled from weapons.
 */
import { BOTS, BOT_PROFILES } from "../config/bots.js"
import { GAME } from "../config/game.js"
import { Rng } from "../core/random.js"
import { bus } from "../core/events.js"
import { Bot } from "./bot.js"

export class BotManager {
	constructor(world, combat, seed = GAME.worldSeed + 7) {
		this.world = world
		this.combat = combat
		this.rng = new Rng(seed)
		/** @type {Bot[]} */
		this.bots = []
		this.difficulty = GAME.defaultDifficulty
		this.unsubscribe = []
		this.listen()
	}

	listen() {
		// Gunshots and footsteps are the main perception inputs.
		const offShot = bus.on("combat:shot", (e) => {
			this.propagateNoise(e.x, e.z, e.loudness || 100, e.owner)
		})
		const offStep = bus.on("player:footstep", (e) => {
			if (!e.isPlayer) return
			this.propagateNoise(e.x, e.z, e.loud ? 26 : 14, null)
		})
		const offBoom = bus.on("explosion", (e) => {
			this.propagateNoise(e.x, e.z, 200, null)
		})
		if (typeof offShot === "function") this.unsubscribe.push(offShot, offStep, offBoom)
	}

	propagateNoise(x, z, loudness, source) {
		for (let i = 0; i < this.bots.length; i++) {
			const b = this.bots[i]
			if (b.dead || b === source) continue
			b.hearNoise(x, z, loudness)
		}
	}

	/** Spawn `count` bots spread over the island's spawn ring. */
	spawn(count, difficulty = GAME.defaultDifficulty) {
		this.difficulty = BOT_PROFILES[difficulty] ? difficulty : "normal"
		const spawns = this.world.spawns
		for (let i = 0; i < count; i++) {
			let bot = this.bots[i]
			if (!bot) {
				bot = new Bot(i, this.world, this.combat, this.rng, this.difficulty)
				this.bots.push(bot)
			} else {
				bot.difficulty = this.difficulty
				bot.profile = BOT_PROFILES[this.difficulty]
			}
			// Skip index 0: reserved for the human player's spawn.
			const spot = spawns.length ? spawns[(i + 1) % spawns.length] : { x: 0, z: 0 }
			bot.spawn(
				spot.x + this.rng.range(-8, 8),
				spot.z + this.rng.range(-8, 8))
		}
		this.bots.length = count
	}

	get aliveCount() {
		let n = 0
		for (let i = 0; i < this.bots.length; i++) if (!this.bots[i].dead) n++
		return n
	}

	/**
	 * @param {number} dt
	 * @param {object} player human player entity
	 * @param {object[]} candidates all combatants (player + bots)
	 */
	update(dt, player, candidates) {
		for (let i = 0; i < this.bots.length; i++) {
			const b = this.bots[i]
			if (b.dead && b.deadTime > BOTS.corpseLifetime) continue
			const d = Math.hypot(b.pos.x - player.pos.x, b.pos.z - player.pos.z)
			b.update(dt, candidates, d)
		}
	}

	/** Draw bots inside the view radius; corpses linger briefly. */
	draw(scene, camera, viewDistance) {
		const limit = viewDistance * viewDistance
		for (let i = 0; i < this.bots.length; i++) {
			const b = this.bots[i]
			if (b.dead && b.deadTime > BOTS.corpseLifetime) continue
			const dx = b.pos.x - camera.x
			const dz = b.pos.z - camera.z
			if (dx * dx + dz * dz > limit) continue
			b.draw(scene)
		}
	}

	/** Bots near a position, used by the minimap's proximity radar. */
	nearby(x, z, radius, out = []) {
		out.length = 0
		const r2 = radius * radius
		for (let i = 0; i < this.bots.length; i++) {
			const b = this.bots[i]
			if (b.dead) continue
			const dx = b.pos.x - x
			const dz = b.pos.z - z
			if (dx * dx + dz * dz <= r2) out.push(b)
		}
		return out
	}

	reset() {
		this.bots.length = 0
	}
}
