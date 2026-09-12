/**
 * Weapon controller.
 *
 * One instance per combatant (player or bot). Owns the equipped slots, the
 * magazine state, reserve ammo, fire timing, recoil/bloom and reload and
 * switch timers. Firing is delegated to the CombatSystem so damage resolution
 * lives in a single place - which is also where the authoritative server will
 * plug in for Version 2.
 */
import { WEAPONS, AMMO_MAX, AMMO_PICKUP } from "../config/weapons.js"
import { clamp } from "../core/math.js"
import { bus } from "../core/events.js"

const SLOT_ORDER = ["primary", "secondary", "melee"]

export class WeaponController {
	constructor(owner, combat) {
		this.owner = owner
		this.combat = combat
		/** @type {{primary: string|null, secondary: string|null, melee: string|null}} */
		this.slots = { primary: null, secondary: null, melee: "melee_talon" }
		/** Rounds currently loaded, keyed by weapon id. */
		this.mags = {}
		/** Reserve ammo per ammo type. */
		this.ammo = { rifle: 0, smg: 0, shell: 0, sniper: 0, pistol: 0, none: 0 }
		this.slotIndex = 2
		this.cooldown = 0
		this.reloadTimer = 0
		this.switchTimer = 0
		this.bloom = 0
		this.recoilLevel = 0
		this.triggerHeld = false
		this.pumpPending = false
	}

	get weaponId() {
		return this.slots[SLOT_ORDER[this.slotIndex]] || null
	}

	get weapon() {
		const id = this.weaponId
		return id ? WEAPONS[id] : null
	}

	get reloading() {
		return this.reloadTimer > 0
	}

	get switching() {
		return this.switchTimer > 0
	}

	magOf(id) {
		return this.mags[id] || 0
	}

	get magazine() {
		const id = this.weaponId
		return id ? this.magOf(id) : 0
	}

	get reserve() {
		const w = this.weapon
		return w ? this.ammo[w.ammo] || 0 : 0
	}

	/** Equip a weapon into its configured slot; returns the displaced weapon. */
	equip(weaponId, autoSelect = true) {
		const w = WEAPONS[weaponId]
		if (!w) return null
		const slot = w.slot
		const previous = this.slots[slot]
		this.slots[slot] = weaponId
		if (this.mags[weaponId] === undefined) {
			// A freshly found weapon comes with a partial magazine.
			this.mags[weaponId] = Math.max(1, Math.round(w.magazine * 0.6))
		}
		if (previous && previous !== weaponId) delete this.mags[previous]
		if (autoSelect) this.selectSlot(SLOT_ORDER.indexOf(slot))
		return previous
	}

	has(weaponId) {
		return this.slots.primary === weaponId || this.slots.secondary === weaponId || this.slots.melee === weaponId
	}

	addAmmo(type, amount) {
		if (!(type in this.ammo)) return 0
		const max = AMMO_MAX[type] || 0
		const before = this.ammo[type]
		this.ammo[type] = clamp(before + amount, 0, max)
		return this.ammo[type] - before
	}

	addAmmoPickup(type) {
		return this.addAmmo(type, AMMO_PICKUP[type] || 0)
	}

	selectSlot(index) {
		if (index < 0 || index > 2) return false
		const id = this.slots[SLOT_ORDER[index]]
		if (!id || index === this.slotIndex) return false
		this.slotIndex = index
		this.reloadTimer = 0
		this.pumpPending = false
		const w = WEAPONS[id]
		this.switchTimer = w ? w.switchTime : 0.4
		if (this.owner && this.owner.isPlayer) bus.emit("player:switch", { weapon: id })
		return true
	}

	cycleSlot(direction) {
		for (let i = 1; i <= 3; i++) {
			const next = (this.slotIndex + direction * i + 9) % 3
			if (this.slots[SLOT_ORDER[next]]) return this.selectSlot(next)
		}
		return false
	}

	needsReload() {
		const w = this.weapon
		if (!w || w.fireMode === "melee") return false
		return this.magazine <= 0 && this.reserve > 0
	}

	startReload() {
		const w = this.weapon
		if (!w || w.fireMode === "melee" || this.reloading || this.switching) return false
		if (this.magazine >= w.magazine || this.reserve <= 0) return false
		this.reloadTimer = w.reloadTime
		if (this.owner && this.owner.isPlayer) bus.emit("player:reload", { weapon: w.id })
		return true
	}

	finishReload() {
		const w = this.weapon
		if (!w) return
		const want = w.magazine - this.magazine
		const take = Math.min(want, this.ammo[w.ammo] || 0)
		this.mags[w.id] = this.magazine + take
		this.ammo[w.ammo] -= take
	}

	/** Current effective spread in radians (aim, stance, movement, bloom). */
	spread(aiming, moveSpeed, crouching) {
		const w = this.weapon
		if (!w) return 0
		let s = aiming ? w.spreadAds : w.spreadHip
		s += this.bloom * (aiming ? 0.35 : 1) * 0.02
		s += Math.min(0.03, moveSpeed * 0.004)
		if (crouching) s *= 0.7
		return s
	}

	/**
	 * @param {number} dt
	 * @param {object} state {fire, firePressed, aiming, moveSpeed, crouching,
	 *   origin:{x,y,z}, dir:{x,y,z}}
	 * @returns {number} number of shots fired this step
	 */
	update(dt, state) {
		const w = this.weapon
		this.cooldown = Math.max(0, this.cooldown - dt)
		if (this.switchTimer > 0) this.switchTimer = Math.max(0, this.switchTimer - dt)
		if (this.reloadTimer > 0) {
			this.reloadTimer -= dt
			if (this.reloadTimer <= 0) {
				this.reloadTimer = 0
				this.finishReload()
			}
		}
		// Recoil/bloom recovery.
		if (w) {
			this.bloom = Math.max(0, this.bloom - dt * w.recoilRecovery)
			this.recoilLevel = Math.max(0, this.recoilLevel - dt * w.recoilRecovery * 0.8)
		}
		if (!w || !state) return 0
		if (this.switching || this.reloading) {
			this.triggerHeld = state.fire
			return 0
		}

		const interval = 60 / Math.max(1, w.rpm)
		let shots = 0
		const wantShot = w.fireMode === "auto" ? state.fire : (state.firePressed || (state.fire && !this.triggerHeld))
		if (wantShot && this.cooldown <= 0) {
			if (w.fireMode === "melee") {
				this.combat.melee(this.owner, state.origin, state.dir, w)
				this.cooldown = interval
				shots = 1
			} else if (this.magazine > 0) {
				this.fireOnce(state, w)
				this.cooldown = interval
				shots = 1
			} else if (this.reserve > 0) {
				this.startReload()
			} else {
				// Dry fire click, throttled by the fire interval.
				this.cooldown = interval
				bus.emit("combat:dryFire", { owner: this.owner, weapon: w.id })
			}
		}
		this.triggerHeld = state.fire
		return shots
	}

	fireOnce(state, w) {
		this.mags[w.id] = this.magazine - 1
		this.bloom = Math.min(6, this.bloom + 1)
		this.recoilLevel = Math.min(8, this.recoilLevel + 1)
		const spread = this.spread(state.aiming, state.moveSpeed || 0, state.crouching)
		this.combat.fireWeapon(this.owner, w, state.origin, state.dir, spread)
	}

	/** Ammo/weapon summary used by the inventory UI. */
	snapshot() {
		return {
			slots: Object.assign({}, this.slots),
			ammo: Object.assign({}, this.ammo),
			magazine: this.magazine,
			weaponId: this.weaponId,
			slotIndex: this.slotIndex,
		}
	}

	reset() {
		this.slots = { primary: null, secondary: null, melee: "melee_talon" }
		this.mags = {}
		for (const k in this.ammo) this.ammo[k] = 0
		this.slotIndex = 2
		this.cooldown = 0
		this.reloadTimer = 0
		this.switchTimer = 0
		this.bloom = 0
		this.recoilLevel = 0
	}
}

export { SLOT_ORDER }
