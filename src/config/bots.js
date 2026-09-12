/**
 * Bot perception + decision tuning. Difficulty comes mostly from behaviour
 * (reaction, cover usage, flanking, retreating) rather than perfect aim.
 */
export const BOT_PROFILES = {
	easy: {
		reactionTime: 0.85, aimError: 0.055, aimSpeed: 2.2,
		viewDistance: 95, fov: 1.15, hearingRange: 70,
		coverBias: 0.25, flankBias: 0.05, retreatHealth: 0.25,
		burstMin: 2, burstMax: 4, burstPause: [0.7, 1.4],
		damageScale: 0.6, moveSpeedScale: 0.85, looting: false,
	},
	normal: {
		reactionTime: 0.45, aimError: 0.028, aimSpeed: 4,
		viewDistance: 140, fov: 1.3, hearingRange: 110,
		coverBias: 0.55, flankBias: 0.2, retreatHealth: 0.3,
		burstMin: 3, burstMax: 6, burstPause: [0.45, 0.95],
		damageScale: 0.85, moveSpeedScale: 1, looting: true,
	},
	hard: {
		reactionTime: 0.26, aimError: 0.016, aimSpeed: 6,
		viewDistance: 185, fov: 1.45, hearingRange: 150,
		coverBias: 0.8, flankBias: 0.5, retreatHealth: 0.38,
		burstMin: 4, burstMax: 8, burstPause: [0.3, 0.65],
		damageScale: 1, moveSpeedScale: 1.08, looting: true,
	},
}

export const BOTS = {
	maxHealth: 100,
	/** Simulation LOD: distant bots think less frequently. */
	nearThinkDistance: 120,
	thinkIntervalNear: 0.12,
	thinkIntervalFar: 0.5,
	patrolRadius: 55,
	searchDuration: 12,
	coverSearchRadius: 26,
	preferredRange: 28,
	minEngageRange: 6,
	corpseLifetime: 45,
	armorChance: 0.55,
	moveSpeed: 4.2,
	sprintSpeed: 6.6,
	turnSpeed: 4.5,
	eyeHeight: 1.6,
	radius: 0.45,
	height: 1.8,
}

/** Bot finite state machine states. */
export const BOT_STATE = {
	IDLE: "IDLE",
	PATROL: "PATROL",
	SEARCH: "SEARCH",
	INVESTIGATE: "INVESTIGATE",
	COMBAT: "COMBAT",
	TAKE_COVER: "TAKE_COVER",
	RETREAT: "RETREAT",
	LOOT: "LOOT",
	HEAL: "HEAL",
	RELOAD: "RELOAD",
	FLANK: "FLANK",
	DEAD: "DEAD",
}
