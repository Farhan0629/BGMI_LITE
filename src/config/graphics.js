/** Rendering constants and quality presets. */

export const QUALITY = {
	low: {
		label: "LOW", shadowMapSize: 0, shadowDistance: 70, viewDistance: 330,
		terrainSegments: 96, detailScale: 0.4, maxParticles: 600,
		post: false, bloom: false, pixelRatioCap: 1, msaa: false,
	},
	medium: {
		label: "MEDIUM", shadowMapSize: 1024, shadowDistance: 95, viewDistance: 480,
		terrainSegments: 128, detailScale: 0.65, maxParticles: 1000,
		post: true, bloom: false, pixelRatioCap: 1.25, msaa: false,
	},
	high: {
		label: "HIGH", shadowMapSize: 2048, shadowDistance: 130, viewDistance: 700,
		terrainSegments: 176, detailScale: 1, maxParticles: 1600,
		post: true, bloom: true, pixelRatioCap: 1.5, msaa: true,
	},
	ultra: {
		label: "ULTRA", shadowMapSize: 3072, shadowDistance: 170, viewDistance: 950,
		terrainSegments: 224, detailScale: 1.35, maxParticles: 2200,
		post: true, bloom: true, pixelRatioCap: 2, msaa: true,
	},
}

export const QUALITY_NAMES = Object.keys(QUALITY)

export const RENDER = {
	near: 0.12,
	far: 1400,
	/** Field of view in degrees for each camera state. */
	baseFov: 74,
	adsFov: 54,
	sprintFov: 80,
	/** Maximum dynamic point lights uploaded per frame. */
	maxLights: 8,
	exposure: 1.05,
	particleCapacity: 2200,
}

/** Time of day presets: t is 0..1 through the day. */
export const TIME_PRESETS = { day: 0.35, sunset: 0.75, dusk: 0.82, night: 0.95 }

export const WEATHER_TYPES = ["clear", "cloudy", "rain", "fog"]
