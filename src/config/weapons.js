/**
 * Weapon balance table. Adding a weapon here makes it available to the player,
 * to bots and to the loot system - no other code changes required.
 *
 * `model` drives the procedural weapon mesh built by the character rig
 * (length in metres, optional wooden furniture, scope and muzzle device).
 */
export const WEAPONS = {
	ar_vanguard: {
		id: "ar_vanguard", name: "VANGUARD AR-12", shortName: "ASSAULT RIFLE",
		slot: "primary", ammo: "rifle", fireMode: "auto",
		rpm: 640, magazine: 30, damage: 26, pellets: 1,
		falloffStart: 45, falloffEnd: 140, falloffFactor: 0.62, range: 320,
		spreadHip: 0.028, spreadAds: 0.006,
		recoilPitch: 0.016, recoilYaw: 0.006, recoilRecovery: 7,
		reloadTime: 2.1, switchTime: 0.5, projectileSpeed: 0,
		adsFovScale: 0.72, scoped: false, loudness: 120,
		muzzleFlash: 1, shakeAmount: 0.5, moveSpeedScale: 0.96,
		model: { length: 0.98, color: [0.16, 0.17, 0.17], muzzle: true },
	},
	smg_hornet: {
		id: "smg_hornet", name: "HORNET SMG-9", shortName: "SMG",
		slot: "primary", ammo: "smg", fireMode: "auto",
		rpm: 900, magazine: 35, damage: 18, pellets: 1,
		falloffStart: 22, falloffEnd: 80, falloffFactor: 0.45, range: 180,
		spreadHip: 0.036, spreadAds: 0.012,
		recoilPitch: 0.011, recoilYaw: 0.007, recoilRecovery: 9,
		reloadTime: 1.8, switchTime: 0.4, projectileSpeed: 0,
		adsFovScale: 0.8, scoped: false, loudness: 95,
		muzzleFlash: 0.8, shakeAmount: 0.35, moveSpeedScale: 1,
		model: { length: 0.72, color: [0.14, 0.14, 0.15] },
	},
	shotgun_breaker: {
		id: "shotgun_breaker", name: "BREAKER 12G", shortName: "SHOTGUN",
		slot: "primary", ammo: "shell", fireMode: "pump",
		rpm: 75, magazine: 6, damage: 13, pellets: 9,
		falloffStart: 8, falloffEnd: 34, falloffFactor: 0.18, range: 60,
		spreadHip: 0.085, spreadAds: 0.055,
		recoilPitch: 0.05, recoilYaw: 0.012, recoilRecovery: 5,
		reloadTime: 2.9, switchTime: 0.55, projectileSpeed: 0,
		adsFovScale: 0.88, scoped: false, loudness: 130,
		muzzleFlash: 1.6, shakeAmount: 1, moveSpeedScale: 0.94,
		model: { length: 1.04, color: [0.19, 0.18, 0.18], wood: true },
	},
	sniper_longbow: {
		id: "sniper_longbow", name: "LONGBOW .308", shortName: "SNIPER RIFLE",
		slot: "primary", ammo: "sniper", fireMode: "single",
		rpm: 45, magazine: 5, damage: 82, pellets: 1,
		falloffStart: 200, falloffEnd: 500, falloffFactor: 0.85, range: 700,
		spreadHip: 0.05, spreadAds: 0.0008,
		recoilPitch: 0.07, recoilYaw: 0.008, recoilRecovery: 4,
		reloadTime: 3.2, switchTime: 0.7, projectileSpeed: 480,
		adsFovScale: 0.32, scoped: true, loudness: 170,
		muzzleFlash: 1.4, shakeAmount: 1.2, moveSpeedScale: 0.9,
		model: { length: 1.26, color: [0.15, 0.15, 0.16], wood: true, scope: true, muzzle: true },
	},
	pistol_sidewinder: {
		id: "pistol_sidewinder", name: "SIDEWINDER P9", shortName: "PISTOL",
		slot: "secondary", ammo: "pistol", fireMode: "single",
		rpm: 320, magazine: 15, damage: 22, pellets: 1,
		falloffStart: 18, falloffEnd: 70, falloffFactor: 0.4, range: 140,
		spreadHip: 0.03, spreadAds: 0.01,
		recoilPitch: 0.02, recoilYaw: 0.006, recoilRecovery: 10,
		reloadTime: 1.5, switchTime: 0.3, projectileSpeed: 0,
		adsFovScale: 0.85, scoped: false, loudness: 85,
		muzzleFlash: 0.7, shakeAmount: 0.3, moveSpeedScale: 1.02,
		model: { length: 0.4, color: [0.13, 0.13, 0.14] },
	},
	melee_talon: {
		id: "melee_talon", name: "TALON BLADE", shortName: "MELEE",
		slot: "melee", ammo: "none", fireMode: "melee",
		rpm: 90, magazine: 0, damage: 55, pellets: 1,
		falloffStart: 2, falloffEnd: 3, falloffFactor: 1, range: 2.6,
		spreadHip: 0, spreadAds: 0,
		recoilPitch: 0.01, recoilYaw: 0.01, recoilRecovery: 12,
		reloadTime: 0, switchTime: 0.25, projectileSpeed: 0,
		adsFovScale: 1, scoped: false, loudness: 6,
		muzzleFlash: 0, shakeAmount: 0.25, moveSpeedScale: 1.06,
		model: { length: 0.34, color: [0.55, 0.57, 0.6] },
	},
}

export const WEAPON_IDS = Object.keys(WEAPONS)

/** Damage multipliers per hit location. */
export const HIT_LOCATIONS = { head: 2.5, chest: 1, stomach: 0.9, arms: 0.75, legs: 0.7 }

export const AMMO_LABELS = { rifle: "RIFLE", smg: "SMG", shell: "SHELLS", sniper: "SNIPER", pistol: "PISTOL", none: "-" }

/** Rounds granted by a single ammo pickup. */
export const AMMO_PICKUP = { rifle: 30, smg: 35, shell: 8, sniper: 10, pistol: 20, none: 0 }

/** Starting reserve ammo when a weapon is first picked up. */
export const AMMO_MAX = { rifle: 240, smg: 280, shell: 60, sniper: 60, pistol: 180, none: 0 }
