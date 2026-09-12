/** Global match + engine settings. */
export const GAME = {
	name: "FRONTIER STRIKE",
	version: "1.0.0",
	mapName: "RAVENFALL ISLAND",
	playerCallsign: "RAVEN-07",
	worldSize: 1000,
	worldSeed: 20260912,
	fixedStep: 1 / 60,
	maxStepsPerFrame: 5,
	deployCountdown: 3,
	botCounts: { low: 8, medium: 16, high: 30 },
	defaultBotCount: "medium",
	defaultDifficulty: "normal",
	/** Explosive barrels and grenades. */
	barrelBlastRadius: 9,
	barrelBlastDamage: 130,
	grenadeBlastRadius: 8.5,
	grenadeBlastDamage: 110,
	grenadeFuse: 2.6,
	debug: false,
	storageKey: "frontier-strike/settings/v1",
}
