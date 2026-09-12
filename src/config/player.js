/** Player movement, camera and survival tuning. All units are metres/seconds. */
export const PLAYER = {
	maxHealth: 100,

	walkSpeed: 4.4,
	sprintSpeed: 7.6,
	crouchSpeed: 2.2,
	aimSpeedScale: 0.55,
	backpedalScale: 0.78,
	strafeScale: 0.9,
	accel: 42,
	airAccel: 9,
	friction: 14,
	gravity: 24,
	jumpSpeed: 8.1,
	maxFallSpeed: 60,

	radius: 0.42,
	height: 1.8,
	crouchHeight: 1.15,
	stepHeight: 0.55,
	eyeHeight: 1.62,
	crouchEyeHeight: 1.05,

	safeFallSpeed: 14,
	fallDamagePerSpeed: 3.4,

	camera: {
		/** Spring-arm length per stance. */
		distance: 3.5,
		adsDistance: 1.9,
		sprintDistance: 4.1,
		deathDistance: 5.4,
		minDistance: 0.55,
		/** Over-the-shoulder lateral offset. */
		shoulder: 0.72,
		adsShoulder: 0.5,
		/** Pivot height above the character's feet. */
		height: 1.55,
		crouchHeight: 1.08,
		deathHeight: -0.6,
		pitchLimit: 1.2,
		collisionPad: 0.3,
		/** Camera shake tuning (configurable from the settings menu). */
		shakeAmount: 0.16,
		shakeDecay: 2.8,
		followRate: 18,
		zoomRate: 9,
	},

	healItems: {
		bandage: { id: "bandage", name: "Bandage", heal: 18, useTime: 2.2, healthCap: 80 },
		medkit: { id: "medkit", name: "Med Pack", heal: 45, useTime: 4, healthCap: 100 },
		firstaid: { id: "firstaid", name: "First Aid Kit", heal: 100, useTime: 6, healthCap: 100 },
	},

	armor: {
		/** Fraction of body damage absorbed per vest level (index = level). */
		vestAbsorb: [0, 0.3, 0.42, 0.55],
		/** Fraction of head damage absorbed per helmet level. */
		helmetAbsorb: [0, 0.4, 0.55, 0.7],
		vestDurability: [0, 60, 110, 170],
		helmetDurability: [0, 40, 80, 130],
	},

	interactRange: 2.6,
	sensitivity: 0.0022,
	adsSensitivityScale: 0.6,
}
