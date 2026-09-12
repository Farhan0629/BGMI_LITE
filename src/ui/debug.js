/**
 * Debug overlay (F3 or GAME.debug). Shows frame timing, renderer counters,
 * player state, AI state distribution and zone timing. Text is rebuilt at a
 * fixed low rate so the overlay itself never distorts the measurements.
 */
import { GAME } from "../config/game.js"
import { formatTime } from "./hud.js"

export class DebugOverlay {
	constructor(root) {
		this.node = document.createElement("pre")
		this.node.className = "debug-overlay hidden"
		root.appendChild(this.node)
		this.visible = !!GAME.debug
		this.node.classList.toggle("hidden", !this.visible)
		this.accum = 0
		this.frames = 0
		this.fps = 0
		this.frameMs = 0
		this.refresh = 0
		this.stateCounts = {}
	}

	toggle() {
		this.visible = !this.visible
		this.node.classList.toggle("hidden", !this.visible)
		return this.visible
	}

	sample(dt) {
		this.accum += dt
		this.frames++
		if (this.accum >= 0.5) {
			this.fps = this.frames / this.accum
			this.frameMs = (this.accum / this.frames) * 1000
			this.accum = 0
			this.frames = 0
		}
	}

	/** @param {object} ctx {player, bots, zone, renderer, particles, loot, net} */
	update(dt, ctx) {
		this.sample(dt)
		if (!this.visible) return
		this.refresh -= dt
		if (this.refresh > 0) return
		this.refresh = 0.25

		const p = ctx.player
		const r = ctx.renderer ? ctx.renderer.stats : null
		const bots = ctx.bots ? ctx.bots.bots : []
		const counts = this.stateCounts
		for (const k in counts) counts[k] = 0
		for (let i = 0; i < bots.length; i++) {
			const s = bots[i].state
			counts[s] = (counts[s] || 0) + 1
		}
		let aiLine = ""
		for (const k in counts) if (counts[k]) aiLine += k + ":" + counts[k] + "  "

		const lines = [
			GAME.name + " v" + GAME.version + "  [debug]",
			"fps            " + this.fps.toFixed(1) + "   frame " + this.frameMs.toFixed(2) + " ms",
			"quality        " + (ctx.quality || "-") + "   dpr " + (window.devicePixelRatio || 1).toFixed(2),
			"draw calls     " + (r ? r.drawCalls : "-") +
				"   static " + (r ? r.staticInstances : "-") +
				"   dynamic " + (r ? r.dynamicInstances : "-"),
			"culled chunks  " + (r ? r.culledChunks : "-") + "   particles " + (ctx.particles ? ctx.particles.activeCount() : "-"),
			"player         x " + p.pos.x.toFixed(1) + "  y " + p.pos.y.toFixed(1) + "  z " + p.pos.z.toFixed(1),
			"speed          " + p.speed.toFixed(2) + " m/s   grounded " + p.grounded +
				"   surface " + p.surface,
			"health/armor   " + p.health.toFixed(0) + " / " + p.armorPoints.toFixed(0),
			"weapon         " + (p.weapons.weaponId || "none") + "  " + p.weapons.magazine + "/" + p.weapons.reserve +
				(p.weapons.reloading ? "  [reloading]" : ""),
			"bots           " + (ctx.bots ? ctx.bots.aliveCount : 0) + " alive / " + bots.length + " total",
			"ai states      " + (aiLine || "-"),
			"loot items     " + (ctx.loot ? ctx.loot.items.length : "-"),
			"zone           " + (ctx.zone ? ctx.zone.phase + "  r " + ctx.zone.radius.toFixed(0) +
				"  next " + formatTime(ctx.zone.timeRemaining) : "-"),
			"net            " + (ctx.net && ctx.net.connected
				? "connected  rtt " + ctx.net.latency.toFixed(0) + " ms"
				: "offline (single player)"),
		]
		this.node.textContent = lines.join("\n")
	}
}
