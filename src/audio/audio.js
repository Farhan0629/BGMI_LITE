/**
 * Audio engine.
 *
 * Every sound is synthesised at runtime with the Web Audio API - no external
 * audio files, so nothing proprietary ships with the game and there is no
 * download cost. Positional sounds use a PannerNode so a gunshot to the left
 * is heard on the left; the listener is updated from the camera each frame.
 *
 * Buses: master -> {sfx, ambience, music}. Levels persist via the settings
 * store. All nodes are created per one-shot and garbage collected once they
 * stop, which keeps voice management trivial while staying cheap enough for a
 * shooter (a burst of automatic fire is a handful of oscillators).
 */
import { bus } from "../core/events.js"
import { clamp } from "../core/math.js"
import { WEAPONS } from "../config/weapons.js"

/** Per surface footstep character: [filter Hz, noise burst length, gain]. */
const FOOTSTEP_SURFACES = {
	concrete: [1500, 0.07, 0.55],
	metal: [2600, 0.09, 0.6],
	wood: [900, 0.08, 0.5],
	dirt: [600, 0.09, 0.42],
	grass: [420, 0.11, 0.36],
	glass: [3200, 0.06, 0.5],
	water: [700, 0.14, 0.45],
}

/** Impact character per surface. */
const IMPACT_SURFACES = {
	concrete: [1800, 0.12],
	metal: [3400, 0.18],
	wood: [1100, 0.12],
	dirt: [500, 0.1],
	grass: [420, 0.09],
	glass: [4200, 0.22],
	water: [800, 0.16],
	flesh: [320, 0.1],
}

export class AudioEngine {
	constructor() {
		this.ctx = null
		this.available = false
		this.enabled = true
		this.noiseBuffer = null
		this.listener = { x: 0, y: 0, z: 0, yaw: 0 }
		this.volumes = { master: 0.8, sfx: 0.9, ambience: 0.6, music: 0.4 }
		this.ambientNodes = null
		this.rainGain = null
		this.engineOsc = null
		this.lastBirdTime = 0
		this.unsub = []
	}

	/** Must be called from a user gesture (browser autoplay policy). */
	init() {
		if (this.ctx) return this.available
		try {
			const Ctor = window.AudioContext || window.webkitAudioContext
			if (!Ctor) throw new Error("Web Audio API unavailable")
			this.ctx = new Ctor()
			this.master = this.ctx.createGain()
			this.sfxBus = this.ctx.createGain()
			this.ambienceBus = this.ctx.createGain()
			this.musicBus = this.ctx.createGain()
			// Light limiter so explosions do not clip the mix.
			this.limiter = this.ctx.createDynamicsCompressor()
			this.limiter.threshold.value = -8
			this.limiter.ratio.value = 6
			this.sfxBus.connect(this.master)
			this.ambienceBus.connect(this.master)
			this.musicBus.connect(this.master)
			this.master.connect(this.limiter)
			this.limiter.connect(this.ctx.destination)
			this.buildNoise()
			this.applyVolumes()
			this.available = true
			this.subscribe()
		} catch (err) {
			// The game must stay playable without audio.
			console.warn("[audio] disabled:", err && err.message ? err.message : err)
			this.available = false
		}
		return this.available
	}

	resume() {
		if (this.ctx && this.ctx.state === "suspended") this.ctx.resume().catch(() => {})
	}

	buildNoise() {
		const len = Math.floor(this.ctx.sampleRate * 1.5)
		const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
		const data = buf.getChannelData(0)
		for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
		this.noiseBuffer = buf
	}

	setVolumes(partial) {
		Object.assign(this.volumes, partial)
		this.applyVolumes()
	}

	applyVolumes() {
		if (!this.available) return
		const v = this.volumes
		this.master.gain.value = clamp(v.master, 0, 1) * (this.enabled ? 1 : 0)
		this.sfxBus.gain.value = clamp(v.sfx, 0, 1)
		this.ambienceBus.gain.value = clamp(v.ambience, 0, 1)
		this.musicBus.gain.value = clamp(v.music, 0, 1)
	}

	setListener(x, y, z, yaw) {
		this.listener.x = x
		this.listener.y = y
		this.listener.z = z
		this.listener.yaw = yaw
		if (!this.available) return
		const l = this.ctx.listener
		const fx = Math.sin(yaw)
		const fz = -Math.cos(yaw)
		if (l.positionX) {
			const t = this.ctx.currentTime
			l.positionX.setValueAtTime(x, t)
			l.positionY.setValueAtTime(y, t)
			l.positionZ.setValueAtTime(z, t)
			l.forwardX.setValueAtTime(fx, t)
			l.forwardY.setValueAtTime(0, t)
			l.forwardZ.setValueAtTime(fz, t)
			l.upX.setValueAtTime(0, t)
			l.upY.setValueAtTime(1, t)
			l.upZ.setValueAtTime(0, t)
		} else if (l.setPosition) {
			l.setPosition(x, y, z)
			l.setOrientation(fx, 0, fz, 0, 1, 0)
		}
	}

	// -------------------------------------------------------------- plumbing

	panner(x, y, z, refDistance = 8, maxDistance = 400) {
		const p = this.ctx.createPanner()
		p.panningModel = "HRTF"
		p.distanceModel = "inverse"
		p.refDistance = refDistance
		p.maxDistance = maxDistance
		p.rolloffFactor = 1.1
		if (p.positionX) {
			p.positionX.value = x
			p.positionY.value = y
			p.positionZ.value = z
		} else if (p.setPosition) {
			p.setPosition(x, y, z)
		}
		return p
	}

	noiseSource(duration, filterType, frequency, q = 1) {
		const src = this.ctx.createBufferSource()
		src.buffer = this.noiseBuffer
		src.loop = true
		src.playbackRate.value = 0.8 + Math.random() * 0.5
		const filter = this.ctx.createBiquadFilter()
		filter.type = filterType
		filter.frequency.value = frequency
		filter.Q.value = q
		src.connect(filter)
		src.start()
		src.stop(this.ctx.currentTime + duration + 0.05)
		return { src, out: filter }
	}

	envelope(duration, peak, attack = 0.002) {
		const g = this.ctx.createGain()
		const t = this.ctx.currentTime
		g.gain.setValueAtTime(0.0001, t)
		g.gain.linearRampToValueAtTime(peak, t + attack)
		g.gain.exponentialRampToValueAtTime(0.0001, t + duration)
		return g
	}

	/** 2D UI sound. */
	blip(frequency, duration, type = "square", gain = 0.12) {
		if (!this.available) return
		const osc = this.ctx.createOscillator()
		osc.type = type
		osc.frequency.value = frequency
		const env = this.envelope(duration, gain, 0.004)
		osc.connect(env)
		env.connect(this.sfxBus)
		osc.start()
		osc.stop(this.ctx.currentTime + duration + 0.02)
	}

	// --------------------------------------------------------------- sounds

	gunshot(x, y, z, weaponId, isPlayer) {
		if (!this.available) return
		const w = WEAPONS[weaponId]
		if (!w) return
		const dur = w.ammo === "sniper" ? 0.55 : w.ammo === "shell" ? 0.4 : 0.26
		const lowFreq = w.ammo === "sniper" ? 70 : w.ammo === "shell" ? 95 : 130
		const peak = (isPlayer ? 0.5 : 0.42) * clamp(w.loudness / 120, 0.4, 1.3)

		const dest = isPlayer ? this.sfxBus : this.panner(x, y, z, 12, 600)
		if (!isPlayer) dest.connect(this.sfxBus)

		// Crack: band-passed noise burst.
		const crack = this.noiseSource(dur, "bandpass", w.ammo === "shell" ? 1400 : 2200, 0.8)
		const crackEnv = this.envelope(dur * 0.6, peak, 0.001)
		crack.out.connect(crackEnv)
		crackEnv.connect(dest)

		// Body: fast pitch-dropping sine for the thump.
		const osc = this.ctx.createOscillator()
		osc.type = "sine"
		const t = this.ctx.currentTime
		osc.frequency.setValueAtTime(lowFreq * 2.4, t)
		osc.frequency.exponentialRampToValueAtTime(lowFreq, t + dur * 0.5)
		const bodyEnv = this.envelope(dur, peak * 0.8, 0.002)
		osc.connect(bodyEnv)
		bodyEnv.connect(dest)
		osc.start()
		osc.stop(t + dur + 0.05)

		// Distant tail so far away fire reads as environmental.
		if (!isPlayer) {
			const tail = this.noiseSource(dur * 2.2, "lowpass", 700, 0.6)
			const tailEnv = this.envelope(dur * 2.2, peak * 0.35, 0.02)
			tail.out.connect(tailEnv)
			tailEnv.connect(dest)
		}
	}

	melee(x, y, z) {
		if (!this.available) return
		const n = this.noiseSource(0.18, "bandpass", 2600, 1.4)
		const env = this.envelope(0.18, 0.26, 0.004)
		n.out.connect(env)
		env.connect(this.sfxBus)
	}

	impact(x, y, z, surface) {
		if (!this.available) return
		const cfg = IMPACT_SURFACES[surface] || IMPACT_SURFACES.concrete
		const p = this.panner(x, y, z, 6, 180)
		p.connect(this.sfxBus)
		const n = this.noiseSource(cfg[1], "bandpass", cfg[0], 1.6)
		const env = this.envelope(cfg[1], 0.22, 0.001)
		n.out.connect(env)
		env.connect(p)
	}

	footstep(x, y, z, surface, loud, isPlayer) {
		if (!this.available) return
		const cfg = FOOTSTEP_SURFACES[surface] || FOOTSTEP_SURFACES.dirt
		const dest = isPlayer ? this.sfxBus : this.panner(x, y, z, 4, 60)
		if (!isPlayer) dest.connect(this.sfxBus)
		const n = this.noiseSource(cfg[1], "bandpass", cfg[0], 1.1)
		const env = this.envelope(cfg[1], cfg[2] * (loud ? 0.3 : 0.18) * (isPlayer ? 0.8 : 1), 0.002)
		n.out.connect(env)
		env.connect(dest)
	}

	reload(weaponId) {
		if (!this.available) return
		// Magazine out, magazine in, bolt.
		this.blip(320, 0.06, "square", 0.09)
		setTimeout(() => this.blip(240, 0.07, "square", 0.1), 220)
		setTimeout(() => this.blip(520, 0.05, "square", 0.08), 520)
	}

	weaponSwitch() {
		this.blip(420, 0.05, "triangle", 0.08)
		setTimeout(() => this.blip(300, 0.05, "triangle", 0.07), 90)
	}

	dryFire() {
		this.blip(180, 0.04, "square", 0.07)
	}

	hitMarker(headshot) {
		this.blip(headshot ? 1500 : 980, headshot ? 0.1 : 0.06, "square", 0.1)
	}

	damageTaken() {
		if (!this.available) return
		const n = this.noiseSource(0.3, "lowpass", 420, 0.7)
		const env = this.envelope(0.3, 0.3, 0.003)
		n.out.connect(env)
		env.connect(this.sfxBus)
		this.blip(140, 0.18, "sine", 0.16)
	}

	explosion(x, y, z, scale = 1) {
		if (!this.available) return
		const p = this.panner(x, y, z, 20, 900)
		p.connect(this.sfxBus)
		const dur = 1.4 * scale
		const n = this.noiseSource(dur, "lowpass", 480, 0.5)
		const env = this.envelope(dur, 0.7, 0.005)
		n.out.connect(env)
		env.connect(p)
		const osc = this.ctx.createOscillator()
		const t = this.ctx.currentTime
		osc.type = "sine"
		osc.frequency.setValueAtTime(90, t)
		osc.frequency.exponentialRampToValueAtTime(28, t + dur * 0.7)
		const oe = this.envelope(dur, 0.55, 0.004)
		osc.connect(oe)
		oe.connect(p)
		osc.start()
		osc.stop(t + dur + 0.1)
	}

	pickup() {
		this.blip(660, 0.07, "triangle", 0.09)
		setTimeout(() => this.blip(880, 0.07, "triangle", 0.08), 70)
	}

	heal() {
		this.blip(520, 0.12, "sine", 0.1)
		setTimeout(() => this.blip(700, 0.16, "sine", 0.09), 140)
	}

	uiClick() {
		this.blip(520, 0.04, "square", 0.06)
	}

	uiHover() {
		this.blip(760, 0.03, "sine", 0.03)
	}

	zoneWarning() {
		this.blip(300, 0.25, "sawtooth", 0.08)
		setTimeout(() => this.blip(240, 0.3, "sawtooth", 0.08), 300)
	}

	victory() {
		const notes = [523, 659, 784, 1047]
		notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.35, "triangle", 0.12), i * 160))
	}

	defeat() {
		const notes = [392, 330, 262, 196]
		notes.forEach((f, i) => setTimeout(() => this.blip(f, 0.45, "sine", 0.12), i * 200))
	}

	countdownBeep(final) {
		this.blip(final ? 900 : 600, final ? 0.3 : 0.12, "square", 0.1)
	}

	// -------------------------------------------------------------- ambience

	/** Start a looping wind bed plus an idle rain layer (gain 0 until used). */
	startAmbience() {
		if (!this.available || this.ambientNodes) return
		const wind = this.ctx.createBufferSource()
		wind.buffer = this.noiseBuffer
		wind.loop = true
		const windFilter = this.ctx.createBiquadFilter()
		windFilter.type = "lowpass"
		windFilter.frequency.value = 420
		const windGain = this.ctx.createGain()
		windGain.gain.value = 0.18
		wind.connect(windFilter)
		windFilter.connect(windGain)
		windGain.connect(this.ambienceBus)
		wind.start()

		// Slow LFO on the wind so it breathes.
		const lfo = this.ctx.createOscillator()
		lfo.frequency.value = 0.07
		const lfoGain = this.ctx.createGain()
		lfoGain.gain.value = 0.1
		lfo.connect(lfoGain)
		lfoGain.connect(windGain.gain)
		lfo.start()

		const rain = this.ctx.createBufferSource()
		rain.buffer = this.noiseBuffer
		rain.loop = true
		const rainFilter = this.ctx.createBiquadFilter()
		rainFilter.type = "highpass"
		rainFilter.frequency.value = 1400
		const rainGain = this.ctx.createGain()
		rainGain.gain.value = 0
		rain.connect(rainFilter)
		rainFilter.connect(rainGain)
		rainGain.connect(this.ambienceBus)
		rain.start()

		this.rainGain = rainGain
		this.windGain = windGain
		this.ambientNodes = { wind, rain, lfo }
	}

	stopAmbience() {
		if (!this.ambientNodes) return
		try {
			this.ambientNodes.wind.stop()
			this.ambientNodes.rain.stop()
			this.ambientNodes.lfo.stop()
		} catch (e) { /* already stopped */ }
		this.ambientNodes = null
		this.rainGain = null
	}

	/** Drive ambience from weather/time of day each frame. */
	updateEnvironment(dt, env) {
		if (!this.available || !this.ambientNodes) return
		if (this.rainGain) {
			const target = (env.rain || 0) * 0.22
			this.rainGain.gain.value += (target - this.rainGain.gain.value) * Math.min(1, dt * 2)
		}
		if (this.windGain) {
			const target = 0.1 + (env.windStrength || 0.4) * 0.16
			this.windGain.gain.value += (target - this.windGain.gain.value) * Math.min(1, dt)
		}
		// Occasional bird calls in daylight, only when it is not raining.
		this.lastBirdTime -= dt
		if (this.lastBirdTime <= 0) {
			this.lastBirdTime = 6 + Math.random() * 14
			if ((env.night || 0) < 0.25 && (env.rain || 0) < 0.3) this.birdCall()
		}
	}

	birdCall() {
		if (!this.available) return
		const osc = this.ctx.createOscillator()
		const t = this.ctx.currentTime
		osc.type = "sine"
		const base = 1800 + Math.random() * 1200
		osc.frequency.setValueAtTime(base, t)
		osc.frequency.linearRampToValueAtTime(base * 1.35, t + 0.08)
		osc.frequency.linearRampToValueAtTime(base * 0.9, t + 0.18)
		const env = this.envelope(0.22, 0.05, 0.01)
		osc.connect(env)
		env.connect(this.ambienceBus)
		osc.start()
		osc.stop(t + 0.3)
	}

	/** Continuous vehicle engine tone, pitch follows speed. */
	setEngine(active, speed01) {
		if (!this.available) return
		if (active && !this.engineOsc) {
			const osc = this.ctx.createOscillator()
			osc.type = "sawtooth"
			osc.frequency.value = 60
			const filter = this.ctx.createBiquadFilter()
			filter.type = "lowpass"
			filter.frequency.value = 700
			const gain = this.ctx.createGain()
			gain.gain.value = 0.12
			osc.connect(filter)
			filter.connect(gain)
			gain.connect(this.sfxBus)
			osc.start()
			this.engineOsc = { osc, gain }
		} else if (!active && this.engineOsc) {
			try { this.engineOsc.osc.stop() } catch (e) { /* ignore */ }
			this.engineOsc = null
		}
		if (this.engineOsc) {
			this.engineOsc.osc.frequency.value = 55 + speed01 * 150
			this.engineOsc.gain.gain.value = 0.08 + speed01 * 0.1
		}
	}

	// ----------------------------------------------------------- event wiring

	subscribe() {
		const add = (name, fn) => {
			const off = bus.on(name, fn)
			if (typeof off === "function") this.unsub.push(off)
		}
		add("combat:shot", (e) => {
			if (e.melee) this.melee(e.x, e.y, e.z)
			else this.gunshot(e.x, e.y, e.z, e.weapon, e.isPlayer)
		})
		add("combat:dryFire", () => this.dryFire())
		add("combat:hit", (e) => {
			if (e.byPlayer) this.hitMarker(e.headshot)
			this.impact(e.x, e.y, e.z, "flesh")
		})
		add("combat:playerDamaged", () => this.damageTaken())
		add("explosion", (e) => this.explosion(e.x, e.y, e.z, e.scale || 1))
		add("player:footstep", (e) => this.footstep(e.x, e.y, e.z, e.surface, e.loud, e.isPlayer !== false))
		add("player:reload", (e) => this.reload(e.weapon))
		add("player:switch", () => this.weaponSwitch())
		add("player:pickup", () => this.pickup())
		add("player:heal", () => this.heal())
		add("zone:warning", () => this.zoneWarning())
		add("world:broken", (e) => this.impact(e.x, e.y, e.z, e.surface || "glass"))
	}

	dispose() {
		for (const off of this.unsub) off()
		this.unsub.length = 0
		this.stopAmbience()
		if (this.ctx) this.ctx.close().catch(() => {})
		this.ctx = null
		this.available = false
	}
}
