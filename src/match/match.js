/**
 * Match orchestration.
 *
 * Owns the match state machine (deploying -> countdown -> live -> over),
 * tracks statistics from combat events, decides victory/defeat and builds the
 * per-frame HUD state object. The Game class drives simulation; this class is
 * the referee, which keeps match rules independent of rendering and makes the
 * V2 server able to reuse the same rules object.
 */
import { bus } from "../core/events.js"
import { GAME } from "../config/game.js"
import { WEAPONS } from "../config/weapons.js"
import { AMMO_LABELS } from "../config/weapons.js"

export const MATCH_STATE = {
	IDLE: "idle",
	LOADING: "loading",
	COUNTDOWN: "countdown",
	LIVE: "live",
	OVER: "over",
}

export class MatchSystem {
	/**
	 * @param {object} deps {player, bots, loot, zone, hud, audio}
	 */
	constructor(deps) {
		this.player = deps.player
		this.bots = deps.bots
		this.loot = deps.loot
		this.zone = deps.zone
		this.hud = deps.hud
		this.audio = deps.audio
		this.state = MATCH_STATE.IDLE
		this.mode = "battle"
		this.countdown = 0
		this.lastCountdownTick = -1
		this.elapsed = 0
		this.overTimer = 0
		this.victory = false
		this.totalCombatants = 1
		this.stats = this.emptyStats()
		this.onFinish = null
		this.subscribe()
	}

	emptyStats() {
		return {
			kills: 0,
			headshots: 0,
			damage: 0,
			damageTaken: 0,
			shots: 0,
			hits: 0,
			loot: 0,
			survival: 0,
			accuracy: 0,
			placement: 0,
			total: 1,
		}
	}

	subscribe() {
		bus.on("combat:shot", (e) => {
			if (!e.isPlayer || e.melee) return
			this.stats.shots += e.pellets || 1
		})
		bus.on("combat:hit", (e) => {
			if (!e.byPlayer) return
			this.stats.hits++
			this.stats.damage += e.damage || 0
			if (e.headshot) this.stats.headshots++
		})
		bus.on("combat:kill", (e) => {
			if (e.killerIsPlayer) this.stats.kills++
		})
		bus.on("combat:playerDamaged", (e) => {
			this.stats.damageTaken += (e && e.damage) || 0
		})
		bus.on("player:pickup", () => {
			this.stats.loot++
		})
	}

	// ------------------------------------------------------------ lifecycle

	/** Begin the deploy countdown. */
	begin(mode, botCount) {
		this.mode = mode || "battle"
		this.stats = this.emptyStats()
		this.elapsed = 0
		this.victory = false
		this.overTimer = 0
		this.totalCombatants = 1 + (botCount || 0)
		this.stats.total = this.totalCombatants
		this.countdown = this.mode === "training" ? 0.8 : GAME.deployCountdown + 1
		this.lastCountdownTick = -1
		this.state = MATCH_STATE.COUNTDOWN
		bus.emit("match:state", { state: this.state, mode: this.mode })
	}

	finish(victory) {
		if (this.state === MATCH_STATE.OVER) return
		this.state = MATCH_STATE.OVER
		this.victory = victory
		this.stats.survival = this.elapsed
		this.stats.accuracy = this.stats.shots > 0 ? this.stats.hits / this.stats.shots : 0
		this.stats.placement = victory ? 1 : Math.max(1, (this.bots ? this.bots.aliveCount : 0) + 1)
		this.stats.total = this.totalCombatants
		this.overTimer = victory ? 2.2 : 2.8
		if (this.audio) victory ? this.audio.victory() : this.audio.defeat()
		bus.emit("match:state", { state: this.state, victory, stats: this.stats })
	}

	reset() {
		this.state = MATCH_STATE.IDLE
		this.stats = this.emptyStats()
		this.elapsed = 0
		this.countdown = 0
	}

	get isLive() {
		return this.state === MATCH_STATE.LIVE
	}

	/** Countdown/deploy sequencing; returns true while inputs stay locked. */
	updateCountdown(dt, menu) {
		this.countdown -= dt
		const tick = Math.ceil(this.countdown)
		if (tick !== this.lastCountdownTick) {
			this.lastCountdownTick = tick
			if (menu) {
				if (tick > 0) menu.setCountdown(String(Math.min(tick, GAME.deployCountdown)))
				else menu.setCountdown(this.mode === "training" ? "BEGIN" : "DEPLOY")
			}
			if (this.audio && tick >= 0) this.audio.countdownBeep(tick <= 0)
		}
		if (this.countdown <= -0.6) {
			this.state = MATCH_STATE.LIVE
			if (this.zone && this.mode === "battle") this.zone.start()
			bus.emit("match:state", { state: this.state, mode: this.mode })
			if (this.hud) {
				this.hud.showBanner(this.mode === "training" ? "TRAINING RANGE ONLINE" : "DEPLOYED - SURVIVE", 2.2)
			}
			return false
		}
		return true
	}

	/** Advance timers and evaluate win/lose conditions. */
	update(dt) {
		if (this.state !== MATCH_STATE.LIVE) return
		this.elapsed += dt
		if (this.mode === "training") return
		if (this.player.dead) {
			this.finish(false)
			return
		}
		if (this.bots && this.bots.aliveCount <= 0) this.finish(true)
	}

	/** Called while the end screen is pending so the death cam can play out. */
	updateOver(dt) {
		if (this.state !== MATCH_STATE.OVER) return false
		if (this.overTimer > 0) {
			this.overTimer -= dt
			if (this.overTimer <= 0) return true
		}
		return false
	}

	// ----------------------------------------------------------- HUD payload

	/**
	 * Build the HUD state. Allocated once and mutated to avoid per-frame
	 * garbage.
	 */
	hudState(extra) {
		const s = this._hud || (this._hud = {})
		const p = this.player
		const w = p.weapons
		s.health = p.health
		s.armor = p.armorPoints
		s.armorMax = p.armorMax
		s.helmetLevel = p.helmetLevel
		s.vestLevel = p.vestLevel
		s.backpackLevel = p.inventory.backpackLevel
		s.healFraction = p.healProgress || 0
		s.weaponId = w.weaponId
		s.magazine = w.magazine
		s.magazineMax = w.weapon ? w.weapon.magazine : 0
		s.reserve = w.reserve
		s.reloading = w.reloading
		s.slots = this._slots || (this._slots = [null, null, null])
		s.slots[0] = w.slots.primary
		s.slots[1] = w.slots.secondary
		s.slots[2] = w.slots.melee
		s.slotIndex = w.slotIndex
		s.alive = this.mode === "training" ? 1 : 1 + (this.bots ? this.bots.aliveCount : 0)
		s.zoneLabel = this.mode === "training" ? "TRAINING RANGE" : (this.zone ? this.zone.stageLabel : "")
		s.zoneTimer = this.zone ? this.zone.timeRemaining : 0
		s.outsideZone = this.mode === "battle" && this.zone ? this.zone.isOutside(p.pos.x, p.pos.z) : false
		s.spread = w.weapon ? w.spread(p.aiming, p.speed, p.crouching) : 0
		s.scoped = !!(p.aiming && w.weapon && w.weapon.scoped)
		s.prompt = extra && extra.prompt ? extra.prompt : ""
		s.crosshairStyle = extra ? extra.crosshairStyle : "cross"
		s.crosshairColor = extra ? extra.crosshairColor : "#e8f1ff"
		return s
	}

	/** Ammo rows for the inventory panel. */
	ammoRows() {
		const rows = []
		const ammo = this.player.weapons.ammo
		for (const key in ammo) {
			if (key === "none") continue
			rows.push({ label: AMMO_LABELS[key] || key, count: ammo[key] })
		}
		return rows
	}
}

export { WEAPONS }
