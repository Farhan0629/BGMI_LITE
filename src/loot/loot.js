/**
 * Loot system.
 *
 * Ground loot is generated once per match from the anchors the world builder
 * produced (building interiors, military crates, wilderness caches). Each item
 * renders as a small crate plus an emissive rarity beacon so it reads at a
 * distance without needing UI markers.
 */
import { LOOT, LOOT_TABLES, RARITY_COLORS, RARITY_LABELS } from "../config/loot.js"
import { WEAPONS, AMMO_LABELS, AMMO_PICKUP } from "../config/weapons.js"
import { PLAYER } from "../config/player.js"
import { mat4, mat4Compose } from "../core/math.js"
import { bus } from "../core/events.js"

let nextId = 1

/** Human readable label for any loot entry. */
export function lootLabel(item) {
	switch (item.kind) {
		case "weapon": return WEAPONS[item.weaponId] ? WEAPONS[item.weaponId].name : "WEAPON"
		case "ammo": return (AMMO_LABELS[item.ammoType] || "AMMO") + " AMMO x" + (AMMO_PICKUP[item.ammoType] || 0)
		case "heal": {
			const h = PLAYER.healItems[item.healId]
			return h ? h.name.toUpperCase() : "MEDICAL"
		}
		case "helmet": return "HELMET LV." + item.level
		case "vest": return "BODY ARMOR LV." + item.level
		case "backpack": return "BACKPACK LV." + item.level
		default: return "ITEM"
	}
}

export class LootSystem {
	constructor(world, rng) {
		this.world = world
		this.rng = rng
		/** @type {any[]} */
		this.items = []
		this.m = mat4()
		this.time = 0
		this.scratch = []
	}

	/** Weighted pick from a region loot table. */
	roll(tableName) {
		const table = LOOT_TABLES[tableName] || LOOT_TABLES.wild
		let total = 0
		for (let i = 0; i < table.length; i++) total += table[i].weight
		let r = this.rng.range(0, total)
		for (let i = 0; i < table.length; i++) {
			r -= table[i].weight
			if (r <= 0) return table[i]
		}
		return table[table.length - 1]
	}

	spawnItem(x, y, z, entry) {
		const item = Object.assign({}, entry)
		item.id = nextId++
		item.x = x
		item.y = y
		item.z = z
		item.taken = false
		item.label = lootLabel(item)
		this.items.push(item)
		return item
	}

	/** Generate the match's ground loot from world anchors. */
	generate() {
		this.items.length = 0
		nextId = 1
		const anchors = this.world.lootSpawns
		for (let i = 0; i < anchors.length; i++) {
			const a = anchors[i]
			const entry = this.roll(a.table)
			const y = a.y !== undefined ? a.y : this.world.groundAt(a.x, a.z)
			this.spawnItem(a.x, y, a.z, entry)
		}
		// Guarantee a starter weapon near the player's deployment point.
		const spawn = this.world.spawns[0]
		if (spawn) {
			this.spawnItem(spawn.x + 2, this.world.groundAt(spawn.x + 2, spawn.z), spawn.z,
				{ kind: "weapon", weaponId: "ar_vanguard", rarity: "uncommon" })
			this.spawnItem(spawn.x - 2, this.world.groundAt(spawn.x - 2, spawn.z), spawn.z,
				{ kind: "ammo", ammoType: "rifle", rarity: "common" })
			this.spawnItem(spawn.x, this.world.groundAt(spawn.x, spawn.z + 2), spawn.z + 2,
				{ kind: "heal", healId: "bandage", rarity: "common" })
		}
		for (const item of this.items) item.label = lootLabel(item)
		return this.items.length
	}

	/** Drop a weapon that was displaced by a pickup. */
	dropWeapon(weaponId, x, y, z) {
		if (!weaponId || !WEAPONS[weaponId] || WEAPONS[weaponId].slot === "melee") return null
		return this.spawnItem(x, y, z, { kind: "weapon", weaponId, rarity: "common" })
	}

	/** Closest pickup-able item within range of a position. */
	nearest(x, y, z, range = LOOT.pickupRange) {
		let best = null
		let bestDist = range * range
		for (let i = 0; i < this.items.length; i++) {
			const it = this.items[i]
			if (it.taken) continue
			const dx = it.x - x
			const dy = it.y - y
			const dz = it.z - z
			if (Math.abs(dy) > 2.6) continue
			const d = dx * dx + dz * dz
			if (d < bestDist) {
				bestDist = d
				best = it
			}
		}
		return best
	}

	remove(item) {
		item.taken = true
		const i = this.items.indexOf(item)
		if (i >= 0) this.items.splice(i, 1)
	}

	update(dt) {
		this.time += dt
	}

	/** Draw crates + rarity beacons near the camera. */
	draw(scene, camera, viewDistance = 150) {
		const limit = Math.min(viewDistance, 140)
		const limit2 = limit * limit
		const pulse = 0.55 + Math.sin(this.time * 3) * 0.25
		for (let i = 0; i < this.items.length; i++) {
			const it = this.items[i]
			if (it.taken) continue
			const dx = it.x - camera.x
			const dz = it.z - camera.z
			if (dx * dx + dz * dz > limit2) continue
			const c = RARITY_COLORS[it.rarity] || RARITY_COLORS.common
			// Small container.
			mat4Compose(this.m, it.x, it.y + 0.14, it.z, 0.4, 0, 0, 0.42, 0.26, 0.34)
			scene.addDynamic("box", this.m, 0.16, 0.16, 0.15, 0.7, 0, 0, 0.9)
			// Emissive lid in the rarity colour.
			mat4Compose(this.m, it.x, it.y + 0.3, it.z, 0.4, 0, 0, 0.44, 0.06, 0.36)
			scene.addDynamic("box", this.m, c[0], c[1], c[2], 0.4, 0.7, 0, 1)
			// Vertical beacon so loot is visible through props.
			mat4Compose(this.m, it.x, it.y + LOOT.beaconHeight * 0.5, it.z, 0, 0, 0, 0.1, LOOT.beaconHeight, 0.1)
			scene.addDynamic("box", this.m, c[0], c[1], c[2], 0.2, pulse, 0, 1)
		}
	}

	reset() {
		this.items.length = 0
	}
}

export { RARITY_LABELS, RARITY_COLORS }
