/**
 * Tactical HUD.
 *
 * Built with plain DOM so text stays crisp at any resolution and costs no GPU
 * time. The HUD is updated from a single `update(state)` call per frame and
 * only touches the DOM when a value actually changes, which keeps layout
 * thrashing out of the frame budget.
 */
import { WEAPONS, AMMO_LABELS } from "../config/weapons.js"
import { PLAYER } from "../config/player.js"
import { clamp } from "../core/math.js"
import { bus } from "../core/events.js"

const KILLFEED_LIFETIME = 6
const TOAST_LIFETIME = 2.4

function el(tag, className, parent, text) {
	const node = document.createElement(tag)
	if (className) node.className = className
	if (text !== undefined) node.textContent = text
	if (parent) parent.appendChild(node)
	return node
}

export class Hud {
	constructor(root, settings) {
		this.root = root
		this.settings = settings
		this.cache = {}
		this.killfeed = []
		this.toasts = []
		this.damageMarkers = []
		this.hitMarkerTimer = 0
		this.headshotTimer = 0
		this.damageFlash = 0
		this.subtitleTimer = 0
		this.build()
		this.subscribe()
	}

	build() {
		const root = el("div", "hud", this.root)
		this.node = root

		// Crosshair + hit marker.
		const center = el("div", "hud-center", root)
		this.crosshair = el("div", "crosshair", center)
		for (let i = 0; i < 4; i++) el("span", "crosshair-arm arm-" + i, this.crosshair)
		el("span", "crosshair-dot", this.crosshair)
		this.hitMarker = el("div", "hit-marker", center)
		for (let i = 0; i < 4; i++) el("span", "hm-" + i, this.hitMarker)
		this.headshotLabel = el("div", "headshot-label", center, "HEADSHOT")
		this.scopeOverlay = el("div", "scope-overlay", root)

		// Top bar: alive count + zone status.
		const top = el("div", "hud-top", root)
		this.aliveNode = el("div", "hud-alive", top, "ALIVE: 0")
		this.zoneNode = el("div", "hud-zone", top, "ZONE STABLE")

		// Bottom-left: vitals.
		const vitals = el("div", "hud-vitals", root)
		const hpRow = el("div", "stat-row", vitals)
		el("span", "stat-label", hpRow, "HP")
		const hpTrack = el("div", "stat-track", hpRow)
		this.hpFill = el("div", "stat-fill hp", hpTrack)
		this.hpValue = el("span", "stat-value", hpRow, "100")

		const armorRow = el("div", "stat-row", vitals)
		el("span", "stat-label", armorRow, "ARMOR")
		const armorTrack = el("div", "stat-track", armorRow)
		this.armorFill = el("div", "stat-fill armor", armorTrack)
		this.armorValue = el("span", "stat-value", armorRow, "0")

		this.gearNode = el("div", "hud-gear", vitals, "HELMET -  VEST -")
		this.healBar = el("div", "heal-bar", vitals)
		this.healFill = el("div", "heal-fill", this.healBar)

		// Bottom-right: weapon.
		const weapon = el("div", "hud-weapon", root)
		this.weaponName = el("div", "weapon-name", weapon, "UNARMED")
		const ammoRow = el("div", "weapon-ammo", weapon)
		this.magNode = el("span", "mag", ammoRow, "0")
		el("span", "ammo-sep", ammoRow, "/")
		this.reserveNode = el("span", "reserve", ammoRow, "0")
		this.weaponSlots = el("div", "weapon-slots", weapon)
		this.slotNodes = []
		for (let i = 0; i < 3; i++) {
			const slot = el("div", "weapon-slot", this.weaponSlots)
			el("span", "slot-key", slot, String(i + 1))
			const label = el("span", "slot-name", slot, "-")
			this.slotNodes.push({ slot, label })
		}
		this.reloadHint = el("div", "reload-hint", weapon, "")

		// Right: kill feed.
		this.killfeedNode = el("div", "hud-killfeed", root)

		// Interaction prompt + toasts.
		this.promptNode = el("div", "hud-prompt", root)
		this.toastNode = el("div", "hud-toasts", root)

		// Full screen feedback layers.
		this.damageVignette = el("div", "damage-vignette", root)
		this.zoneVignette = el("div", "zone-vignette", root)
		this.directionLayer = el("div", "damage-directions", root)

		// Match banner (countdown, deploy, zone warnings) and subtitles.
		this.bannerNode = el("div", "hud-banner", root)
		this.subtitleNode = el("div", "hud-subtitle", root)
	}

	subscribe() {
		bus.on("combat:kill", (e) => {
			this.addKill(e.killer, e.victim, e.killerIsPlayer, e.victimIsPlayer, e.location === "head")
		})
		bus.on("combat:hit", (e) => {
			if (!e.byPlayer) return
			this.hitMarkerTimer = 0.22
			if (e.headshot) this.headshotTimer = 0.9
		})
		bus.on("combat:playerDamaged", (e) => {
			this.damageFlash = 1
			if (e && e.from) this.addDamageDirection(e.from.x, e.from.z, e.playerX, e.playerZ, e.playerYaw)
		})
		bus.on("ui:toast", (e) => this.addToast(e.text, e.tone))
		bus.on("zone:warning", (e) => {
			this.showBanner(e.label + " INCOMING - MOVE TO THE SAFE ZONE", 3)
			this.showSubtitle("[warning] the combat zone is collapsing")
		})
		bus.on("player:pickup", (e) => this.addToast("PICKED UP " + (e.label || "ITEM")))
	}

	// ------------------------------------------------------------- feed/toast

	addKill(killer, victim, killerIsPlayer, victimIsPlayer, headshot) {
		const node = el("div", "kill-entry" + (killerIsPlayer ? " mine" : "") + (victimIsPlayer ? " against-me" : ""), this.killfeedNode)
		el("span", "killer", node, killer)
		el("span", "verb", node, headshot ? "headshot" : "eliminated")
		el("span", "victim", node, victim)
		this.killfeed.push({ node, life: KILLFEED_LIFETIME })
		while (this.killfeed.length > 6) {
			const old = this.killfeed.shift()
			if (old.node.parentNode) old.node.parentNode.removeChild(old.node)
		}
	}

	addToast(text, tone) {
		if (!text) return
		const node = el("div", "toast" + (tone ? " " + tone : ""), this.toastNode, text)
		this.toasts.push({ node, life: TOAST_LIFETIME })
		while (this.toasts.length > 4) {
			const old = this.toasts.shift()
			if (old.node.parentNode) old.node.parentNode.removeChild(old.node)
		}
	}

	/** Directional damage indicator, rotated into player-relative space. */
	addDamageDirection(fromX, fromZ, playerX, playerZ, playerYaw) {
		if (playerX === undefined) return
		const dx = fromX - playerX
		const dz = fromZ - playerZ
		const worldAngle = Math.atan2(dx, -dz)
		const relative = worldAngle - (playerYaw || 0)
		const node = el("div", "damage-dir", this.directionLayer)
		node.style.transform = "rotate(" + (relative * 180 / Math.PI) + "deg)"
		this.damageMarkers.push({ node, life: 1.1 })
	}

	showBanner(text, duration = 2) {
		this.bannerNode.textContent = text
		this.bannerNode.classList.add("visible")
		this.bannerTimer = duration
	}

	showSubtitle(text, duration = 2.4) {
		if (!this.settings.get("gameplay").subtitles) return
		this.subtitleNode.textContent = text
		this.subtitleNode.classList.add("visible")
		this.subtitleTimer = duration
	}

	setVisible(visible) {
		this.node.classList.toggle("hidden", !visible)
	}

	// ----------------------------------------------------------------- update

	/**
	 * @param {number} dt
	 * @param {object} s HUD state built by the match each frame
	 */
	update(dt, s) {
		const c = this.cache

		// Vitals.
		const hp = Math.max(0, Math.round(s.health))
		if (c.hp !== hp) {
			c.hp = hp
			this.hpValue.textContent = String(hp)
			this.hpFill.style.width = (hp / PLAYER.maxHealth * 100) + "%"
			this.hpFill.classList.toggle("critical", hp < 30)
		}
		const armor = Math.max(0, Math.round(s.armor))
		if (c.armor !== armor) {
			c.armor = armor
			this.armorValue.textContent = String(armor)
			this.armorFill.style.width = (s.armorMax > 0 ? (armor / s.armorMax * 100) : 0) + "%"
		}
		const gear = "HELMET " + (s.helmetLevel ? "LV." + s.helmetLevel : "-") +
			"   VEST " + (s.vestLevel ? "LV." + s.vestLevel : "-") +
			"   BAG " + (s.backpackLevel ? "LV." + s.backpackLevel : "-")
		if (c.gear !== gear) {
			c.gear = gear
			this.gearNode.textContent = gear
		}

		// Healing progress.
		const healing = s.healFraction > 0
		this.healBar.classList.toggle("visible", healing)
		if (healing) this.healFill.style.width = (s.healFraction * 100) + "%"

		// Weapon block.
		const weaponName = s.weaponId && WEAPONS[s.weaponId] ? WEAPONS[s.weaponId].name.toUpperCase() : "UNARMED"
		if (c.weaponName !== weaponName) {
			c.weaponName = weaponName
			this.weaponName.textContent = weaponName
		}
		const mag = s.magazine | 0
		if (c.mag !== mag) {
			c.mag = mag
			this.magNode.textContent = String(mag)
			this.magNode.classList.toggle("low", s.magazineMax > 0 && mag / s.magazineMax < 0.25)
		}
		const reserve = s.reserve | 0
		if (c.reserve !== reserve) {
			c.reserve = reserve
			this.reserveNode.textContent = String(reserve)
		}
		for (let i = 0; i < 3; i++) {
			const id = s.slots ? s.slots[i] : null
			const label = id && WEAPONS[id] ? WEAPONS[id].name.toUpperCase() : "-"
			const node = this.slotNodes[i]
			if (node.label.textContent !== label) node.label.textContent = label
			node.slot.classList.toggle("active", i === s.slotIndex)
		}
		const hint = s.reloading ? "RELOADING..." : (mag <= 0 && reserve > 0 ? "PRESS R TO RELOAD" : (mag <= 0 && reserve <= 0 ? "NO AMMO" : ""))
		if (c.hint !== hint) {
			c.hint = hint
			this.reloadHint.textContent = hint
		}

		// Top bar.
		const alive = "ALIVE: " + s.alive
		if (c.alive !== alive) {
			c.alive = alive
			this.aliveNode.textContent = alive
		}
		const zoneText = s.zoneLabel + "   " + formatTime(s.zoneTimer)
		if (c.zone !== zoneText) {
			c.zone = zoneText
			this.zoneNode.textContent = zoneText
		}
		this.zoneNode.classList.toggle("alert", !!s.outsideZone)
		this.zoneVignette.classList.toggle("visible", !!s.outsideZone)

		// Crosshair state: hidden while scoped, spread grows with bloom.
		const scoped = !!s.scoped
		this.scopeOverlay.classList.toggle("visible", scoped)
		this.crosshair.classList.toggle("hidden", scoped)
		const spread = clamp(6 + (s.spread || 0) * 900, 4, 42)
		this.crosshair.style.setProperty("--spread", spread + "px")
		if (c.crosshairStyle !== s.crosshairStyle) {
			c.crosshairStyle = s.crosshairStyle
			this.crosshair.dataset.style = s.crosshairStyle || "cross"
		}
		if (c.crosshairColor !== s.crosshairColor) {
			c.crosshairColor = s.crosshairColor
			this.crosshair.style.setProperty("--crosshair-color", s.crosshairColor || "#e8f1ff")
		}

		// Interaction prompt.
		const prompt = s.prompt || ""
		if (c.prompt !== prompt) {
			c.prompt = prompt
			this.promptNode.textContent = prompt
			this.promptNode.classList.toggle("visible", !!prompt)
		}

		// Timers and transient layers.
		this.hitMarkerTimer = Math.max(0, this.hitMarkerTimer - dt)
		this.hitMarker.classList.toggle("visible", this.hitMarkerTimer > 0)
		this.headshotTimer = Math.max(0, this.headshotTimer - dt)
		this.headshotLabel.classList.toggle("visible", this.headshotTimer > 0)
		this.damageFlash = Math.max(0, this.damageFlash - dt * 1.6)
		const lowHealth = clamp(1 - s.health / 45, 0, 1)
		this.damageVignette.style.opacity = String(clamp(this.damageFlash * 0.55 + lowHealth * 0.45, 0, 0.9))

		for (let i = this.killfeed.length - 1; i >= 0; i--) {
			const k = this.killfeed[i]
			k.life -= dt
			if (k.life < 1) k.node.style.opacity = String(clamp(k.life, 0, 1))
			if (k.life <= 0) {
				if (k.node.parentNode) k.node.parentNode.removeChild(k.node)
				this.killfeed.splice(i, 1)
			}
		}
		for (let i = this.toasts.length - 1; i >= 0; i--) {
			const t = this.toasts[i]
			t.life -= dt
			if (t.life < 0.6) t.node.style.opacity = String(clamp(t.life / 0.6, 0, 1))
			if (t.life <= 0) {
				if (t.node.parentNode) t.node.parentNode.removeChild(t.node)
				this.toasts.splice(i, 1)
			}
		}
		for (let i = this.damageMarkers.length - 1; i >= 0; i--) {
			const m = this.damageMarkers[i]
			m.life -= dt
			m.node.style.opacity = String(clamp(m.life, 0, 1))
			if (m.life <= 0) {
				if (m.node.parentNode) m.node.parentNode.removeChild(m.node)
				this.damageMarkers.splice(i, 1)
			}
		}
		if (this.bannerTimer > 0) {
			this.bannerTimer -= dt
			if (this.bannerTimer <= 0) this.bannerNode.classList.remove("visible")
		}
		if (this.subtitleTimer > 0) {
			this.subtitleTimer -= dt
			if (this.subtitleTimer <= 0) this.subtitleNode.classList.remove("visible")
		}
	}

	clear() {
		for (const k of this.killfeed) if (k.node.parentNode) k.node.parentNode.removeChild(k.node)
		for (const t of this.toasts) if (t.node.parentNode) t.node.parentNode.removeChild(t.node)
		for (const m of this.damageMarkers) if (m.node.parentNode) m.node.parentNode.removeChild(m.node)
		this.killfeed.length = 0
		this.toasts.length = 0
		this.damageMarkers.length = 0
		this.cache = {}
	}
}

export function formatTime(seconds) {
	if (!isFinite(seconds)) return "--:--"
	const s = Math.max(0, Math.floor(seconds))
	const m = Math.floor(s / 60)
	return String(m).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0")
}

export { AMMO_LABELS }
