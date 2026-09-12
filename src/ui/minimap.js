/**
 * Minimap: a 2D canvas radar drawn on top of the 3D view.
 *
 * Shows the player, the safe zone circle, the next zone target, points of
 * interest and *only* enemies that are close enough to be plausibly detected
 * (recent gunfire or short range), so the map never reveals every bot.
 */
import { GAME } from "../config/game.js"

const SIZE = 190
const POI_COLOR = "rgba(215, 224, 235, 0.55)"

export class Minimap {
	constructor(root) {
		this.wrapper = document.createElement("div")
		this.wrapper.className = "minimap"
		this.canvas = document.createElement("canvas")
		this.canvas.width = SIZE
		this.canvas.height = SIZE
		this.wrapper.appendChild(this.canvas)
		this.label = document.createElement("div")
		this.label.className = "minimap-label"
		this.label.textContent = GAME.mapName
		this.wrapper.appendChild(this.label)
		root.appendChild(this.wrapper)
		this.ctx = this.canvas.getContext("2d")
		this.range = 160
		this.fullMap = false
		/** Recent gunfire blips: {x, z, life}. */
		this.blips = []
		this.nearbyScratch = []
	}

	toggleFullMap() {
		this.fullMap = !this.fullMap
		this.wrapper.classList.toggle("full", this.fullMap)
		const size = this.fullMap ? 520 : SIZE
		this.canvas.width = size
		this.canvas.height = size
		return this.fullMap
	}

	addBlip(x, z) {
		this.blips.push({ x, z, life: 3 })
		if (this.blips.length > 40) this.blips.shift()
	}

	setVisible(visible) {
		this.wrapper.classList.toggle("hidden", !visible)
	}

	/**
	 * @param {number} dt
	 * @param {object} player
	 * @param {object} zone
	 * @param {object} bots BotManager
	 * @param {object[]} pois world points of interest
	 */
	update(dt, player, zone, bots, pois) {
		for (let i = this.blips.length - 1; i >= 0; i--) {
			this.blips[i].life -= dt
			if (this.blips[i].life <= 0) this.blips.splice(i, 1)
		}
		this.draw(player, zone, bots, pois)
	}

	draw(player, zone, bots, pois) {
		const ctx = this.ctx
		const size = this.canvas.width
		const half = size / 2
		const range = this.fullMap ? GAME.worldSize * 0.55 : this.range
		const scale = half / range
		const px = player.pos.x
		const pz = player.pos.z

		ctx.clearRect(0, 0, size, size)
		ctx.save()
		// Circular clip for the compact radar, square for the full map.
		if (!this.fullMap) {
			ctx.beginPath()
			ctx.arc(half, half, half - 1, 0, Math.PI * 2)
			ctx.clip()
		}
		ctx.fillStyle = "rgba(9, 13, 18, 0.82)"
		ctx.fillRect(0, 0, size, size)

		const toX = (wx) => half + (wx - px) * scale
		const toY = (wz) => half + (wz - pz) * scale

		// Island outline.
		ctx.strokeStyle = "rgba(120, 140, 160, 0.35)"
		ctx.lineWidth = 1
		ctx.beginPath()
		ctx.arc(toX(0), toY(0), (GAME.worldSize / 2 * 0.82) * scale, 0, Math.PI * 2)
		ctx.stroke()

		// Grid.
		ctx.strokeStyle = "rgba(120, 140, 160, 0.12)"
		const step = 50 * scale
		if (step > 8) {
			const offX = ((-px % 50) + 50) % 50 * scale
			const offZ = ((-pz % 50) + 50) % 50 * scale
			for (let x = offX; x < size; x += step) {
				ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke()
			}
			for (let y = offZ; y < size; y += step) {
				ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke()
			}
		}

		// Points of interest.
		if (pois && (this.fullMap || range > 120)) {
			ctx.fillStyle = POI_COLOR
			ctx.font = "9px \"Rajdhani\", sans-serif"
			ctx.textAlign = "center"
			for (let i = 0; i < pois.length; i++) {
				const p = pois[i]
				const x = toX(p.x)
				const y = toY(p.z)
				if (x < -40 || y < -40 || x > size + 40 || y > size + 40) continue
				ctx.fillText(p.name || "", x, y)
			}
		}

		// Safe zone.
		if (zone) {
			ctx.strokeStyle = "rgba(255, 255, 255, 0.85)"
			ctx.lineWidth = 2
			ctx.beginPath()
			ctx.arc(toX(zone.centerX), toY(zone.centerZ), Math.max(2, zone.radius * scale), 0, Math.PI * 2)
			ctx.stroke()
			// Next zone target.
			if (zone.targetRadius < zone.radius) {
				ctx.strokeStyle = "rgba(110, 200, 255, 0.9)"
				ctx.setLineDash([4, 4])
				ctx.beginPath()
				ctx.arc(toX(zone.targetX), toY(zone.targetZ), Math.max(2, zone.targetRadius * scale), 0, Math.PI * 2)
				ctx.stroke()
				ctx.setLineDash([])
			}
		}

		// Gunfire blips.
		for (let i = 0; i < this.blips.length; i++) {
			const b = this.blips[i]
			ctx.fillStyle = "rgba(255, 196, 92, " + Math.max(0, b.life / 3) + ")"
			ctx.beginPath()
			ctx.arc(toX(b.x), toY(b.z), 3, 0, Math.PI * 2)
			ctx.fill()
		}

		// Nearby enemies only.
		if (bots) {
			const list = bots.nearby(px, pz, this.fullMap ? 90 : 70, this.nearbyScratch)
			ctx.fillStyle = "rgba(232, 84, 72, 0.95)"
			for (let i = 0; i < list.length; i++) {
				const b = list[i]
				ctx.beginPath()
				ctx.arc(toX(b.pos.x), toY(b.pos.z), 2.6, 0, Math.PI * 2)
				ctx.fill()
			}
		}

		// Player arrow.
		ctx.save()
		ctx.translate(half, half)
		ctx.rotate(player.yaw)
		ctx.fillStyle = "#7fe08a"
		ctx.beginPath()
		ctx.moveTo(0, -6)
		ctx.lineTo(4.2, 5)
		ctx.lineTo(0, 2.6)
		ctx.lineTo(-4.2, 5)
		ctx.closePath()
		ctx.fill()
		ctx.restore()
		ctx.restore()
	}
}
