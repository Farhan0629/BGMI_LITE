/**
 * RAVENFALL ISLAND region layout.
 *
 * Each region drives terrain shaping, prop generation, loot tables and
 * spawn/POI placement. Adding a region here is enough for the world builder
 * to pick it up.
 */
export const WATER_LEVEL = 0

export const REGIONS = [
	{
		id: "city", label: "RAVENFALL CITY", kind: "urban", lootTable: "city",
		x: -150, z: -160, radius: 175, height: 11, flatten: 165, weight: 1.35,
	},
	{
		id: "militaryBase", label: "OUTPOST GRAVEL", kind: "military", lootTable: "military",
		x: 190, z: -180, radius: 150, height: 14, flatten: 140, weight: 1.5,
	},
	{
		id: "industrial", label: "DRYDOCK WORKS", kind: "industrial", lootTable: "industrial",
		x: 200, z: 150, radius: 155, height: 8, flatten: 145, weight: 1.2,
	},
	{
		id: "forest", label: "HOLLOW PINES", kind: "forest", lootTable: "wild",
		x: -190, z: 165, radius: 190, height: 13, flatten: 0, weight: 0.7,
	},
	{
		id: "mountain", label: "RAVEN RIDGE", kind: "mountain", lootTable: "wild",
		x: 20, z: -20, radius: 150, height: 46, flatten: 0, weight: 0.85,
	},
	{
		id: "coast", label: "SALT PIER", kind: "coast", lootTable: "wild",
		x: -30, z: 360, radius: 150, height: 2.2, flatten: 90, weight: 0.9,
	},
]

export function regionById(id) {
	return REGIONS.find((r) => r.id === id)
}

/** Nearest region label for the HUD location readout. */
export function regionAt(x, z) {
	let best = null
	let bestScore = Infinity
	for (const r of REGIONS) {
		const d = Math.hypot(x - r.x, z - r.z) / r.radius
		if (d < bestScore) {
			bestScore = d
			best = r
		}
	}
	return bestScore < 1.25 ? best : null
}
