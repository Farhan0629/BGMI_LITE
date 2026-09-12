/** Loot definitions, rarity tiers and per-region spawn tables. */

export const RARITY_COLORS = {
	common: [0.72, 0.74, 0.76],
	uncommon: [0.36, 0.78, 0.42],
	rare: [0.3, 0.6, 0.95],
	epic: [0.72, 0.42, 0.92],
}

export const RARITY_LABELS = { common: "COMMON", uncommon: "UNCOMMON", rare: "RARE", epic: "EPIC" }

const weapon = (weaponId, rarity, weight) => ({ kind: "weapon", weaponId, rarity, weight })
const ammo = (ammoType, rarity, weight) => ({ kind: "ammo", ammoType, rarity, weight })
const heal = (healId, rarity, weight) => ({ kind: "heal", healId, rarity, weight })
const gear = (kind, level, rarity, weight) => ({ kind, level, rarity, weight })

export const LOOT_TABLES = {
	city: [
		weapon("smg_hornet", "common", 14),
		weapon("shotgun_breaker", "common", 12),
		weapon("pistol_sidewinder", "common", 14),
		weapon("ar_vanguard", "uncommon", 8),
		weapon("sniper_longbow", "rare", 2),
		ammo("smg", "common", 16), ammo("shell", "common", 12),
		ammo("pistol", "common", 14), ammo("rifle", "common", 12),
		heal("bandage", "common", 16), heal("medkit", "uncommon", 7), heal("firstaid", "rare", 2),
		gear("helmet", 1, "common", 8), gear("vest", 1, "common", 8),
		gear("helmet", 2, "uncommon", 4), gear("vest", 2, "uncommon", 4),
		gear("backpack", 1, "common", 6), gear("backpack", 2, "uncommon", 3),
	],
	military: [
		weapon("ar_vanguard", "uncommon", 16),
		weapon("sniper_longbow", "rare", 8),
		weapon("smg_hornet", "common", 8),
		weapon("shotgun_breaker", "common", 6),
		weapon("pistol_sidewinder", "common", 5),
		ammo("rifle", "common", 18), ammo("sniper", "uncommon", 10),
		ammo("smg", "common", 8), ammo("shell", "common", 6),
		heal("medkit", "uncommon", 10), heal("firstaid", "rare", 5), heal("bandage", "common", 8),
		gear("helmet", 2, "uncommon", 8), gear("vest", 2, "uncommon", 8),
		gear("helmet", 3, "epic", 3), gear("vest", 3, "epic", 3), gear("backpack", 3, "rare", 4),
	],
	industrial: [
		weapon("ar_vanguard", "uncommon", 10),
		weapon("smg_hornet", "common", 12),
		weapon("shotgun_breaker", "common", 10),
		weapon("sniper_longbow", "rare", 4),
		ammo("rifle", "common", 14), ammo("smg", "common", 14),
		ammo("shell", "common", 10), ammo("sniper", "uncommon", 5),
		heal("bandage", "common", 12), heal("medkit", "uncommon", 8),
		gear("helmet", 1, "common", 7), gear("vest", 2, "uncommon", 6), gear("backpack", 2, "uncommon", 5),
	],
	wild: [
		weapon("sniper_longbow", "rare", 6),
		weapon("ar_vanguard", "uncommon", 7),
		weapon("pistol_sidewinder", "common", 10),
		weapon("shotgun_breaker", "common", 8),
		ammo("rifle", "common", 12), ammo("sniper", "uncommon", 8),
		ammo("pistol", "common", 10), ammo("shell", "common", 8),
		heal("bandage", "common", 14), heal("medkit", "uncommon", 6),
		gear("helmet", 1, "common", 6), gear("vest", 1, "common", 6), gear("backpack", 1, "common", 5),
	],
}

export const LOOT = {
	pickupRange: 2.6,
	beaconHeight: 2.4,
	/** Inventory slots per backpack level (index 0 = no backpack). */
	backpackCapacity: [24, 32, 42, 54],
	/** Ground loot items generated per region. */
	density: { city: 95, military: 80, industrial: 70, wild: 45 },
}
