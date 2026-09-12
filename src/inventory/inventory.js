/**
 * Inventory: weapon slots (delegated to the weapon controller), reserve ammo,
 * healing consumables, armour and backpack capacity.
 *
 * Capacity is expressed in abstract slots so ammo stacks, meds and gear all
 * compete for space, which makes backpack upgrades meaningful.
 */
import { LOOT } from "../config/loot.js"
import { PLAYER } from "../config/player.js"
import { WEAPONS, AMMO_PICKUP, AMMO_LABELS } from "../config/weapons.js"
import { bus } from "../core/events.js"
import { lootLabel } from "../loot/loot.js"

/** Slot cost per stored unit. */
const UNIT_COST = { ammo: 0.1, heal: 1.5 }

export class Inventory {
	constructor(owner, weapons, loot) {
		this.owner = owner
		this.weapons = weapons
		this.loot = loot
		this.backpackLevel = 0
		/** Healing consumables by id. */
		this.heals = { bandage: 0, medkit: 0, firstaid: 0 }
		this.grenades = 0
	}

	get capacity() {
		return LOOT.backpackCapacity[this.backpackLevel] || LOOT.backpackCapacity[0]
	}

	/** Used slots: ammo weight + meds + grenades. */
	get used() {
		let total = 0
		for (const type in this.weapons.ammo) total += this.weapons.ammo[type] * UNIT_COST.ammo
		for (const id in this.heals) total += this.heals[id] * UNIT_COST.heal
		total += this.grenades * 1.5
		return Math.round(total * 10) / 10
	}

	get isFull() {
		return this.used >= this.capacity
	}

	/**
	 * Try to pick up a ground item.
	 * @returns {{ok: boolean, reason?: string, label: string}}
	 */
	pickup(item) {
		const label = item.label || lootLabel(item)
		switch (item.kind) {
			case "weapon": {
				const w = WEAPONS[item.weaponId]
				if (!w) return { ok: false, reason: "UNKNOWN ITEM", label }
				const displaced = this.weapons.equip(item.weaponId, true)
				// A fresh weapon always comes with a little ammo so it is usable.
				this.weapons.addAmmo(w.ammo, Math.round((AMMO_PICKUP[w.ammo] || 0) * 0.8))
				if (displaced && displaced !== item.weaponId && this.loot) {
					this.loot.dropWeapon(displaced, this.owner.pos.x, this.owner.pos.y + 0.1, this.owner.pos.z)
				}
				return { ok: true, label }
			}
			case "ammo": {
				if (this.isFull) return { ok: false, reason: "INVENTORY FULL", label }
				const added = this.weapons.addAmmoPickup(item.ammoType)
				if (added <= 0) return { ok: false, reason: "AMMO FULL", label }
				return { ok: true, label }
			}
			case "heal": {
				if (this.isFull) return { ok: false, reason: "INVENTORY FULL", label }
				this.heals[item.healId] = (this.heals[item.healId] || 0) + 1
				return { ok: true, label }
			}
			case "helmet": {
				if (!this.owner.equipHelmet(item.level)) return { ok: false, reason: "BETTER HELMET EQUIPPED", label }
				return { ok: true, label }
			}
			case "vest": {
				if (!this.owner.equipVest(item.level)) return { ok: false, reason: "BETTER ARMOR EQUIPPED", label }
				return { ok: true, label }
			}
			case "backpack": {
				if (item.level <= this.backpackLevel) return { ok: false, reason: "BETTER BACKPACK EQUIPPED", label }
				this.backpackLevel = item.level
				return { ok: true, label }
			}
			case "grenade": {
				if (this.isFull) return { ok: false, reason: "INVENTORY FULL", label }
				this.grenades++
				return { ok: true, label }
			}
			default:
				return { ok: false, reason: "UNKNOWN ITEM", label }
		}
	}

	/** Best healing item that would actually help right now. */
	bestHeal() {
		const health = this.owner.health
		const order = health < 40 ? ["firstaid", "medkit", "bandage"] : ["bandage", "medkit", "firstaid"]
		for (const id of order) {
			if ((this.heals[id] || 0) <= 0) continue
			const def = PLAYER.healItems[id]
			if (health < def.healthCap) return id
		}
		return null
	}

	useHeal(id) {
		const pick = id || this.bestHeal()
		if (!pick || (this.heals[pick] || 0) <= 0) return false
		if (!this.owner.beginHeal(pick)) return false
		this.heals[pick]--
		bus.emit("ui:toast", { text: "USING " + PLAYER.healItems[pick].name.toUpperCase() })
		return true
	}

	/** Snapshot rendered by the inventory panel. */
	snapshot() {
		const w = this.weapons
		const ammo = []
		for (const type in w.ammo) {
			if (type === "none") continue
			ammo.push({ type, label: AMMO_LABELS[type], count: w.ammo[type] })
		}
		return {
			primary: w.slots.primary ? WEAPONS[w.slots.primary].name : null,
			secondary: w.slots.secondary ? WEAPONS[w.slots.secondary].name : null,
			melee: w.slots.melee ? WEAPONS[w.slots.melee].name : null,
			ammo,
			heals: Object.assign({}, this.heals),
			grenades: this.grenades,
			helmetLevel: this.owner.helmetLevel,
			vestLevel: this.owner.vestLevel,
			backpackLevel: this.backpackLevel,
			used: this.used,
			capacity: this.capacity,
		}
	}

	reset() {
		this.backpackLevel = 0
		this.heals = { bandage: 0, medkit: 0, firstaid: 0 }
		this.grenades = 0
	}
}
