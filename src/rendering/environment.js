/**
 * Day/night + weather environment.
 *
 * Produces the `env` uniform block the renderer consumes (sun direction and
 * colour, ambient hemisphere, fog, sky gradient, wind, night factor) and the
 * post-processing `fx` block. Time of day can be fixed to a preset or run as a
 * slow dynamic cycle.
 */
import { TIME_PRESETS } from "../config/graphics.js"
import { clamp, lerp } from "../core/math.js"

const DAY_LENGTH = 600 // seconds for a full dynamic cycle

function mix3(out, a, b, k) {
	out[0] = lerp(a[0], b[0], k)
	out[1] = lerp(a[1], b[1], k)
	out[2] = lerp(a[2], b[2], k)
	return out
}

/** Key colour stops through the day, indexed by normalised time. */
const STOPS = [
	{ t: 0.0, sun: [0.05, 0.07, 0.13], sky: [0.03, 0.05, 0.1], hor: [0.07, 0.09, 0.14], amb: [0.07, 0.09, 0.15], gnd: [0.03, 0.035, 0.04], night: 1 },
	{ t: 0.22, sun: [1.05, 0.62, 0.38], sky: [0.28, 0.35, 0.55], hor: [0.75, 0.55, 0.42], amb: [0.3, 0.33, 0.42], gnd: [0.1, 0.09, 0.08], night: 0.35 },
	{ t: 0.35, sun: [1.25, 1.15, 1.0], sky: [0.32, 0.5, 0.82], hor: [0.66, 0.74, 0.85], amb: [0.42, 0.48, 0.58], gnd: [0.16, 0.15, 0.13], night: 0 },
	{ t: 0.6, sun: [1.3, 1.22, 1.05], sky: [0.3, 0.48, 0.8], hor: [0.62, 0.71, 0.83], amb: [0.4, 0.46, 0.56], gnd: [0.16, 0.15, 0.13], night: 0 },
	{ t: 0.78, sun: [1.15, 0.54, 0.28], sky: [0.2, 0.24, 0.42], hor: [0.85, 0.48, 0.3], amb: [0.28, 0.26, 0.3], gnd: [0.1, 0.09, 0.08], night: 0.3 },
	{ t: 0.88, sun: [0.3, 0.28, 0.4], sky: [0.07, 0.09, 0.18], hor: [0.22, 0.2, 0.26], amb: [0.12, 0.14, 0.2], gnd: [0.05, 0.05, 0.06], night: 0.8 },
	{ t: 1.0, sun: [0.05, 0.07, 0.13], sky: [0.03, 0.05, 0.1], hor: [0.07, 0.09, 0.14], amb: [0.07, 0.09, 0.15], gnd: [0.03, 0.035, 0.04], night: 1 },
]

export class Environment {
	constructor() {
		this.time = 0
		this.timeOfDay = TIME_PRESETS.day
		this.dynamic = false
		this.weather = "clear"
		this.rain = 0
		this.env = {
			sunDir: new Float32Array([0.4, 0.8, 0.44]),
			sunColor: new Float32Array([1.25, 1.15, 1.0]),
			ambientSky: new Float32Array([0.42, 0.48, 0.58]),
			ambientGround: new Float32Array([0.16, 0.15, 0.13]),
			fogColor: new Float32Array([0.66, 0.74, 0.85]),
			fogDensity: 0.0016,
			fogHeight: 30,
			skyTop: new Float32Array([0.32, 0.5, 0.82]),
			skyHorizon: new Float32Array([0.66, 0.74, 0.85]),
			night: 0,
			windStrength: 0.55,
			time: 0,
			rain: 0,
		}
		this.fx = {
			exposure: 1.05, bloom: 0.5, vignette: 0.32,
			damage: 0, saturation: 1.04, grade: [1.02, 1.0, 0.97],
		}
	}

	/** @param {string} preset day|sunset|dusk|night|cycle */
	setTimeOfDay(preset) {
		if (preset === "cycle") {
			this.dynamic = true
			if (this.timeOfDay === undefined) this.timeOfDay = TIME_PRESETS.day
			return
		}
		this.dynamic = false
		this.timeOfDay = TIME_PRESETS[preset] !== undefined ? TIME_PRESETS[preset] : TIME_PRESETS.day
	}

	setWeather(weather) {
		this.weather = weather || "clear"
	}

	/** Interpolate the colour stops and apply weather modifiers. */
	update(dt, damageFx) {
		this.time += dt
		if (this.dynamic) this.timeOfDay = (this.timeOfDay + dt / DAY_LENGTH) % 1
		const t = this.timeOfDay

		let a = STOPS[0]
		let b = STOPS[STOPS.length - 1]
		for (let i = 1; i < STOPS.length; i++) {
			if (STOPS[i].t >= t) {
				a = STOPS[i - 1]
				b = STOPS[i]
				break
			}
		}
		const k = b.t === a.t ? 0 : (t - a.t) / (b.t - a.t)
		const e = this.env
		mix3(e.sunColor, a.sun, b.sun, k)
		mix3(e.skyTop, a.sky, b.sky, k)
		mix3(e.skyHorizon, a.hor, b.hor, k)
		mix3(e.ambientSky, a.amb, b.amb, k)
		mix3(e.ambientGround, a.gnd, b.gnd, k)
		e.night = lerp(a.night, b.night, k)

		// Sun travels an arc; elevation never fully reaches the horizon so
		// shadow projection stays stable.
		const angle = (t - 0.25) * Math.PI * 2
		const elevation = Math.max(0.12, Math.sin(t * Math.PI))
		e.sunDir[0] = Math.cos(angle) * 0.85
		e.sunDir[1] = elevation
		e.sunDir[2] = Math.sin(angle) * 0.5
		const len = Math.hypot(e.sunDir[0], e.sunDir[1], e.sunDir[2]) || 1
		e.sunDir[0] /= len
		e.sunDir[1] /= len
		e.sunDir[2] /= len

		// Weather.
		let fog = 0.0013 + e.night * 0.0006
		let wind = 0.5
		let targetRain = 0
		let sunScale = 1
		if (this.weather === "cloudy") {
			fog += 0.0009
			sunScale = 0.72
			wind = 0.8
		} else if (this.weather === "fog") {
			fog += 0.0055
			sunScale = 0.6
			wind = 0.35
		} else if (this.weather === "rain") {
			fog += 0.0028
			sunScale = 0.5
			wind = 1.1
			targetRain = 1
		}
		this.rain += (targetRain - this.rain) * Math.min(1, dt * 0.8)
		e.fogDensity = fog
		e.windStrength = wind
		e.time = this.time
		e.rain = this.rain
		mix3(e.fogColor, e.skyHorizon, e.ambientSky, 0.35)
		for (let i = 0; i < 3; i++) e.sunColor[i] *= sunScale

		// Post processing: brighter exposure and stronger vignette at night,
		// red tint driven by recent damage.
		this.fx.exposure = lerp(1.05, 1.32, e.night)
		this.fx.bloom = lerp(0.42, 0.75, e.night)
		this.fx.vignette = lerp(0.3, 0.44, e.night)
		this.fx.saturation = this.weather === "fog" ? 0.9 : 1.04
		this.fx.damage = clamp(damageFx || 0, 0, 1)
		return e
	}

	get nightFactor() {
		return this.env.night
	}
}
