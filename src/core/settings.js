/**
 * Settings store: graphics, audio, controls and gameplay options persisted to
 * localStorage so no account is required. Unknown/legacy keys are merged over
 * defaults, so adding an option never breaks an existing save.
 */
import { GAME } from "../config/game.js"
import { PLAYER } from "../config/player.js"

export const DEFAULT_SETTINGS = {
	graphics: {
		quality: "high",
		shadows: true,
		postProcessing: true,
		particleDensity: 1,
		viewDistance: 420,
		antialias: true,
		resolutionScale: 1,
		fpsCounter: true,
	},
	audio: { master: 0.8, sfx: 0.9, ambience: 0.6, music: 0.4 },
	controls: {
		sensitivity: PLAYER.sensitivity,
		invertY: false,
		adsSensitivityScale: PLAYER.adsSensitivityScale,
	},
	gameplay: {
		cameraMode: "third",
		crosshair: "cross",
		crosshairColor: "#e8f1ff",
		cameraShake: 1,
		subtitles: true,
		uiScale: 1,
		botCount: GAME.defaultBotCount,
		difficulty: GAME.defaultDifficulty,
		timeOfDay: "day",
		weather: "clear",
	},
}

function deepMerge(base, patch) {
	const out = Array.isArray(base) ? base.slice() : Object.assign({}, base)
	if (!patch || typeof patch !== "object") return out
	for (const key in patch) {
		const value = patch[key]
		if (value && typeof value === "object" && !Array.isArray(value) && typeof out[key] === "object") {
			out[key] = deepMerge(out[key], value)
		} else if (value !== undefined) {
			out[key] = value
		}
	}
	return out
}

export class SettingsStore {
	constructor(key = GAME.storageKey) {
		this.key = key
		this.data = deepMerge(DEFAULT_SETTINGS, this.read())
		this.listeners = []
	}

	read() {
		try {
			const raw = window.localStorage.getItem(this.key)
			return raw ? JSON.parse(raw) : null
		} catch (err) {
			console.warn("[settings] could not read saved settings:", err)
			return null
		}
	}

	save() {
		try {
			window.localStorage.setItem(this.key, JSON.stringify(this.data))
		} catch (err) {
			console.warn("[settings] could not save settings:", err)
		}
	}

	get(section) {
		return this.data[section]
	}

	/** Patch a section, persist and notify listeners. */
	set(section, patch) {
		this.data[section] = deepMerge(this.data[section], patch)
		this.save()
		for (const fn of this.listeners) fn(section, this.data[section], this.data)
		return this.data[section]
	}

	onChange(fn) {
		this.listeners.push(fn)
		return () => {
			const i = this.listeners.indexOf(fn)
			if (i >= 0) this.listeners.splice(i, 1)
		}
	}

	reset() {
		this.data = deepMerge(DEFAULT_SETTINGS, {})
		this.save()
		for (const fn of this.listeners) fn("all", null, this.data)
	}
}
