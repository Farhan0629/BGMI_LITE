/** Shrinking combat zone schedule. Fully data driven. */
export const ZONE = {
	startRadius: 470,
	startHold: 45,
	/** How far the next centre may drift, as a fraction of the current radius. */
	centerDrift: 0.42,
	warningSeconds: 10,
	stages: [
		{ label: "COLLAPSE 1", radius: 320, hold: 55, shrink: 50, damage: 1.2 },
		{ label: "COLLAPSE 2", radius: 200, hold: 45, shrink: 45, damage: 2.4 },
		{ label: "COLLAPSE 3", radius: 110, hold: 40, shrink: 40, damage: 4.5 },
		{ label: "FINAL ZONE", radius: 45, hold: 30, shrink: 35, damage: 7 },
		{ label: "LAST STAND", radius: 14, hold: 20, shrink: 30, damage: 11 },
	],
}
