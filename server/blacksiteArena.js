/**
 * BLACKSITE ARENA - the compact symmetric map used for 1v1 matches.
 *
 * Defined as plain data so both the server (collision, spawns) and the client
 * (geometry instancing through PropBuilder) build the identical layout from a
 * single source of truth.
 */

export const ARENA = {
	name: "BLACKSITE ARENA",
	halfSize: 46,
	spawns: [
		{ x: 0, z: -36, yaw: 0 },
		{ x: 0, z: 36, yaw: Math.PI },
	],
	/** Boxes are [x, y, z, sx, sy, sz, yaw, surface]. */
	blocks: [
		// Central structure with an elevated platform.
		[0, 2.4, 0, 16, 4.8, 16, 0, "concrete"],
		[0, 5.1, 0, 18, 0.6, 18, 0, "concrete"],
		[0, 6.4, -8.6, 18, 2, 0.8, 0, "metal"],
		[0, 6.4, 8.6, 18, 2, 0.8, 0, "metal"],
		// Ramps to the platform (approximated with stepped blocks).
		[-12, 1.2, 0, 6, 2.4, 5, 0, "metal"],
		[12, 1.2, 0, 6, 2.4, 5, 0, "metal"],
		[-12, 3.6, 0, 4, 2.4, 5, 0, "metal"],
		[12, 3.6, 0, 4, 2.4, 5, 0, "metal"],
		// Perimeter walls.
		[0, 3, -46, 92, 6, 1.5, 0, "concrete"],
		[0, 3, 46, 92, 6, 1.5, 0, "concrete"],
		[-46, 3, 0, 1.5, 6, 92, 0, "concrete"],
		[46, 3, 0, 1.5, 6, 92, 0, "concrete"],
		// Narrow flanking routes.
		[-26, 2, -14, 3, 4, 22, 0, "concrete"],
		[26, 2, 14, 3, 4, 22, 0, "concrete"],
		// Cover crates across the open lane.
		[-18, 0.8, 24, 3.2, 1.6, 3.2, 0.3, "wood"],
		[18, 0.8, -24, 3.2, 1.6, 3.2, -0.3, "wood"],
		[-8, 0.8, -22, 3.2, 1.6, 3.2, 0, "wood"],
		[8, 0.8, 22, 3.2, 1.6, 3.2, 0, "wood"],
		[-30, 1, 30, 4, 2, 4, 0.6, "metal"],
		[30, 1, -30, 4, 2, 4, -0.6, "metal"],
	],
	/** Weapon and consumable pickups, mirrored for fairness. */
	loot: [
		{ x: 0, z: 0, item: "ar_vanguard" },
		{ x: -30, z: 0, item: "smg_hornet" },
		{ x: 30, z: 0, item: "shotgun_breaker" },
		{ x: 0, z: -24, item: "medkit" },
		{ x: 0, z: 24, item: "medkit" },
		{ x: -22, z: 22, item: "vest2" },
		{ x: 22, z: -22, item: "vest2" },
	],
}

export function arenaGroundAt() {
	return 0 // the arena is flat, which keeps server-side physics trivial
}
