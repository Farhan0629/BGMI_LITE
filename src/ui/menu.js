/**
 * Menu shell: main menu, loading screen, deploy countdown, pause menu,
 * settings, controls, credits and the end-of-match screen.
 *
 * All screens live in one overlay container and are toggled by name, so only
 * one screen is ever interactive. Every control writes straight through to the
 * settings store (which persists to localStorage) and reports changes via
 * callbacks so the engine can apply them live.
 */
import { GAME } from "../config/game.js"
import { QUALITY_NAMES } from "../config/graphics.js"
import { DEFAULT_BINDINGS } from "../input/input.js"
import { formatTime } from "./hud.js"

function el(tag, className, parent, text) {
	const node = document.createElement(tag)
	if (className) node.className = className
	if (text !== undefined) node.textContent = text
	if (parent) parent.appendChild(node)
	return node
}

const CONTROL_ROWS = [
	["Move", "W A S D"],
	["Sprint", "Shift"],
	["Crouch", "Ctrl"],
	["Jump", "Space"],
	["Fire", "Left Mouse"],
	["Aim down sights", "Right Mouse"],
	["Reload", "R"],
	["Interact / pick up", "E"],
	["Primary / Secondary / Melee", "1 / 2 / 3"],
	["Cycle weapon", "Mouse Wheel"],
	["Inventory", "Tab"],
	["Use medical item", "H"],
	["Throw grenade", "G"],
	["Enter / exit vehicle", "F"],
	["Toggle camera (TPS/FPS)", "V"],
	["Full map", "M"],
	["Pause", "Esc"],
	["Debug overlay", "F3"],
	["Fullscreen", "F11"],
]

export class MenuSystem {
	/**
	 * @param {HTMLElement} root
	 * @param {import("../core/settings.js").SettingsStore} settings
	 * @param {object} handlers callbacks into the game
	 */
	constructor(root, settings, handlers) {
		this.root = root
		this.settings = settings
		this.handlers = handlers || {}
		this.screens = {}
		this.current = null
		this.build()
	}

	button(parent, label, onClick, className) {
		const b = el("button", "ui-button" + (className ? " " + className : ""), parent, label)
		b.addEventListener("click", (e) => {
			e.preventDefault()
			if (this.handlers.onClickSound) this.handlers.onClickSound()
			onClick()
		})
		b.addEventListener("mouseenter", () => {
			if (this.handlers.onHoverSound) this.handlers.onHoverSound()
		})
		return b
	}

	screen(name, className) {
		const node = el("div", "screen " + (className || "") + " hidden", this.overlay)
		this.screens[name] = node
		return node
	}

	build() {
		this.overlay = el("div", "ui-overlay", this.root)
		this.buildMainMenu()
		this.buildLoading()
		this.buildCountdown()
		this.buildSettings()
		this.buildControls()
		this.buildCredits()
		this.buildPause()
		this.buildEndScreen()
		this.buildError()
	}

	// ------------------------------------------------------------ main menu

	buildMainMenu() {
		const s = this.screen("main", "main-menu")
		const hero = el("div", "menu-hero", s)
		el("div", "menu-eyebrow", hero, "BROWSER TACTICAL SHOOTER")
		el("h1", "menu-title", hero, GAME.name)
		el("div", "menu-subtitle", hero, GAME.mapName + "  -  SOLO SURVIVAL")

		const panel = el("div", "menu-panel", s)
		this.button(panel, "PLAY", () => this.handlers.onPlay && this.handlers.onPlay(), "primary")
		this.button(panel, "TRAINING", () => this.handlers.onTraining && this.handlers.onTraining())
		this.button(panel, "SETTINGS", () => this.show("settings"))
		this.button(panel, "CONTROLS", () => this.show("controls"))
		this.button(panel, "CREDITS", () => this.show("credits"))

		// Match setup shown next to the buttons.
		const setup = el("div", "menu-setup", s)
		el("div", "setup-title", setup, "MATCH SETUP")
		const gameplay = this.settings.get("gameplay")
		this.addSelect(setup, "Enemy count", [
			["low", "LOW - 8 bots"],
			["medium", "MEDIUM - 16 bots"],
			["high", "HIGH - 30 bots"],
		], gameplay.botCount, (v) => this.settings.set("gameplay", { botCount: v }))
		this.addSelect(setup, "AI difficulty", [
			["easy", "EASY"], ["normal", "NORMAL"], ["hard", "HARD"],
		], gameplay.difficulty, (v) => this.settings.set("gameplay", { difficulty: v }))
		this.addSelect(setup, "Time of day", [
			["day", "DAY"], ["sunset", "SUNSET"], ["dusk", "DUSK"], ["night", "NIGHT"], ["cycle", "DYNAMIC CYCLE"],
		], gameplay.timeOfDay, (v) => {
			this.settings.set("gameplay", { timeOfDay: v })
			if (this.handlers.onEnvironmentChange) this.handlers.onEnvironmentChange()
		})
		this.addSelect(setup, "Weather", [
			["clear", "CLEAR"], ["cloudy", "CLOUDY"], ["fog", "FOG"], ["rain", "RAIN"],
		], gameplay.weather, (v) => {
			this.settings.set("gameplay", { weather: v })
			if (this.handlers.onEnvironmentChange) this.handlers.onEnvironmentChange()
		})

		const footer = el("div", "menu-footer", s)
		el("span", null, footer, "v" + GAME.version + "  -  original assets, procedurally generated  -  keyboard + mouse")
	}

	// ------------------------------------------------------------- loading

	buildLoading() {
		const s = this.screen("loading", "loading-screen")
		el("div", "loading-title", s, "LOADING " + GAME.mapName)
		const track = el("div", "loading-track", s)
		this.loadingFill = el("div", "loading-fill", track)
		this.loadingPercent = el("div", "loading-percent", s, "0%")
		this.loadingStep = el("div", "loading-step", s, "Preparing...")
		el("div", "loading-tip", s,
			"TIP: hold Right Mouse to aim down sights - crouching tightens your spread")
	}

	setLoading(progress, stepLabel) {
		const pct = Math.round(progress * 100)
		this.loadingFill.style.width = pct + "%"
		this.loadingPercent.textContent = pct + "%"
		if (stepLabel) this.loadingStep.textContent = stepLabel
	}

	// ------------------------------------------------------------ countdown

	buildCountdown() {
		const s = this.screen("countdown", "countdown-screen")
		el("div", "countdown-label", s, "MATCH STARTING")
		this.countdownValue = el("div", "countdown-value", s, "3")
		el("div", "countdown-hint", s, GAME.mapName + "  -  LAST COMBATANT STANDING WINS")
	}

	setCountdown(text) {
		this.countdownValue.textContent = text
		this.countdownValue.classList.remove("pop")
		// Restart the CSS animation.
		void this.countdownValue.offsetWidth
		this.countdownValue.classList.add("pop")
	}

	// ------------------------------------------------------------- settings

	addSelect(parent, label, options, value, onChange) {
		const row = el("label", "option-row", parent)
		el("span", "option-label", row, label)
		const select = el("select", "option-select", row)
		for (const [v, text] of options) {
			const opt = el("option", null, select, text)
			opt.value = v
		}
		select.value = value
		select.addEventListener("change", () => onChange(select.value))
		return select
	}

	addSlider(parent, label, min, max, step, value, onChange, format) {
		const row = el("label", "option-row", parent)
		el("span", "option-label", row, label)
		const input = el("input", "option-slider", row)
		input.type = "range"
		input.min = String(min)
		input.max = String(max)
		input.step = String(step)
		input.value = String(value)
		const readout = el("span", "option-value", row, format ? format(value) : String(value))
		input.addEventListener("input", () => {
			const v = parseFloat(input.value)
			readout.textContent = format ? format(v) : String(v)
			onChange(v)
		})
		return input
	}

	addToggle(parent, label, value, onChange) {
		const row = el("label", "option-row", parent)
		el("span", "option-label", row, label)
		const input = el("input", "option-toggle", row)
		input.type = "checkbox"
		input.checked = !!value
		input.addEventListener("change", () => onChange(input.checked))
		return input
	}

	buildSettings() {
		const s = this.screen("settings", "settings-screen")
		el("h2", "screen-title", s, "SETTINGS")
		const cols = el("div", "settings-columns", s)

		const g = this.settings.get("graphics")
		const gfx = el("div", "settings-group", cols)
		el("h3", null, gfx, "GRAPHICS")
		this.addSelect(gfx, "Quality preset", QUALITY_NAMES.map((n) => [n, n.toUpperCase()]), g.quality, (v) => {
			this.settings.set("graphics", { quality: v })
			if (this.handlers.onQualityChange) this.handlers.onQualityChange(v)
		})
		this.addToggle(gfx, "Dynamic shadows", g.shadows, (v) => {
			this.settings.set("graphics", { shadows: v })
			if (this.handlers.onGraphicsChange) this.handlers.onGraphicsChange()
		})
		this.addToggle(gfx, "Post processing", g.postProcessing, (v) => {
			this.settings.set("graphics", { postProcessing: v })
			if (this.handlers.onGraphicsChange) this.handlers.onGraphicsChange()
		})
		this.addToggle(gfx, "Antialiasing (FXAA)", g.antialias, (v) => {
			this.settings.set("graphics", { antialias: v })
			if (this.handlers.onGraphicsChange) this.handlers.onGraphicsChange()
		})
		this.addSlider(gfx, "View distance", 150, 700, 10, g.viewDistance, (v) => {
			this.settings.set("graphics", { viewDistance: v })
			if (this.handlers.onGraphicsChange) this.handlers.onGraphicsChange()
		}, (v) => v + " m")
		this.addSlider(gfx, "Particle density", 0.2, 1.5, 0.1, g.particleDensity, (v) => {
			this.settings.set("graphics", { particleDensity: v })
			if (this.handlers.onGraphicsChange) this.handlers.onGraphicsChange()
		}, (v) => Math.round(v * 100) + "%")
		this.addSlider(gfx, "Resolution scale", 0.5, 1, 0.05, g.resolutionScale, (v) => {
			this.settings.set("graphics", { resolutionScale: v })
			if (this.handlers.onGraphicsChange) this.handlers.onGraphicsChange()
		}, (v) => Math.round(v * 100) + "%")
		this.addToggle(gfx, "Show FPS", g.fpsCounter, (v) => this.settings.set("graphics", { fpsCounter: v }))
		this.button(gfx, "TOGGLE FULLSCREEN", () => this.handlers.onFullscreen && this.handlers.onFullscreen(), "small")

		const a = this.settings.get("audio")
		const audio = el("div", "settings-group", cols)
		el("h3", null, audio, "AUDIO")
		const pct = (v) => Math.round(v * 100) + "%"
		const pushAudio = (patch) => {
			this.settings.set("audio", patch)
			if (this.handlers.onAudioChange) this.handlers.onAudioChange()
		}
		this.addSlider(audio, "Master", 0, 1, 0.05, a.master, (v) => pushAudio({ master: v }), pct)
		this.addSlider(audio, "Effects", 0, 1, 0.05, a.sfx, (v) => pushAudio({ sfx: v }), pct)
		this.addSlider(audio, "Ambience", 0, 1, 0.05, a.ambience, (v) => pushAudio({ ambience: v }), pct)
		this.addSlider(audio, "Music / stingers", 0, 1, 0.05, a.music, (v) => pushAudio({ music: v }), pct)

		const c = this.settings.get("controls")
		const gp = this.settings.get("gameplay")
		const ctrl = el("div", "settings-group", cols)
		el("h3", null, ctrl, "CONTROLS & GAMEPLAY")
		this.addSlider(ctrl, "Mouse sensitivity", 0.0005, 0.006, 0.0001, c.sensitivity,
			(v) => this.settings.set("controls", { sensitivity: v }),
			(v) => (v * 1000).toFixed(1))
		this.addSlider(ctrl, "ADS sensitivity", 0.2, 1, 0.05, c.adsSensitivityScale,
			(v) => this.settings.set("controls", { adsSensitivityScale: v }), pct)
		this.addToggle(ctrl, "Invert Y axis", c.invertY, (v) => this.settings.set("controls", { invertY: v }))
		this.addSelect(ctrl, "Camera mode", [["third", "THIRD PERSON"], ["first", "FIRST PERSON"]], gp.cameraMode, (v) => {
			this.settings.set("gameplay", { cameraMode: v })
			if (this.handlers.onCameraMode) this.handlers.onCameraMode(v)
		})
		this.addSelect(ctrl, "Crosshair", [["cross", "CROSS"], ["dot", "DOT"], ["circle", "CIRCLE"]], gp.crosshair,
			(v) => this.settings.set("gameplay", { crosshair: v }))
		this.addSlider(ctrl, "Camera shake", 0, 1.5, 0.1, gp.cameraShake,
			(v) => this.settings.set("gameplay", { cameraShake: v }), pct)
		this.addSlider(ctrl, "UI scale", 0.8, 1.4, 0.05, gp.uiScale, (v) => {
			this.settings.set("gameplay", { uiScale: v })
			if (this.handlers.onUiScale) this.handlers.onUiScale(v)
		}, pct)
		this.addToggle(ctrl, "Audio cue subtitles", gp.subtitles,
			(v) => this.settings.set("gameplay", { subtitles: v }))

		const footer = el("div", "screen-footer", s)
		this.button(footer, "BACK", () => this.back())
		this.button(footer, "RESET TO DEFAULTS", () => {
			this.settings.reset()
			window.location.reload()
		})
	}

	// ------------------------------------------------------------- controls

	buildControls() {
		const s = this.screen("controls", "controls-screen")
		el("h2", "screen-title", s, "CONTROLS")
		const grid = el("div", "controls-grid", s)
		for (const [label, key] of CONTROL_ROWS) {
			const row = el("div", "control-row", grid)
			el("span", "control-label", row, label)
			el("span", "control-key", row, key)
		}
		el("p", "screen-note", s,
			"Key bindings are stored locally and can be remapped in code via DEFAULT_BINDINGS (" +
			Object.keys(DEFAULT_BINDINGS).length + " actions).")
		const footer = el("div", "screen-footer", s)
		this.button(footer, "BACK", () => this.back())
	}

	buildCredits() {
		const s = this.screen("credits", "credits-screen")
		el("h2", "screen-title", s, "CREDITS")
		const body = el("div", "credits-body", s)
		el("p", null, body, GAME.name + " - an original browser shooter built on a custom WebGL2 engine.")
		el("p", null, body, "Engine, renderer, physics, AI, audio and UI: written from scratch in JavaScript modules with zero third party runtime dependencies.")
		el("p", null, body, "All geometry, materials, characters, weapons, sound effects and the " + GAME.mapName + " map are generated procedurally at runtime. No external or proprietary assets are used.")
		el("p", null, body, "Characters, place names and branding are fictional and original.")
		const footer = el("div", "screen-footer", s)
		this.button(footer, "BACK", () => this.back())
	}

	// ---------------------------------------------------------------- pause

	buildPause() {
		const s = this.screen("pause", "pause-screen")
		const panel = el("div", "menu-panel", s)
		el("h2", "screen-title", panel, "PAUSED")
		this.button(panel, "RESUME", () => this.handlers.onResume && this.handlers.onResume(), "primary")
		this.button(panel, "SETTINGS", () => this.show("settings", "pause"))
		this.button(panel, "CONTROLS", () => this.show("controls", "pause"))
		this.button(panel, "RESTART MATCH", () => this.handlers.onRestart && this.handlers.onRestart())
		this.button(panel, "QUIT TO MENU", () => this.handlers.onQuit && this.handlers.onQuit())
	}

	// ------------------------------------------------------------ end screen

	buildEndScreen() {
		const s = this.screen("end", "end-screen")
		this.endTitle = el("h1", "end-title", s, "VICTORY")
		this.endSubtitle = el("div", "end-subtitle", s, "")
		this.endStats = el("div", "end-stats", s)
		const footer = el("div", "screen-footer", s)
		this.button(footer, "PLAY AGAIN", () => this.handlers.onRestart && this.handlers.onRestart(), "primary")
		this.button(footer, "MAIN MENU", () => this.handlers.onQuit && this.handlers.onQuit())
	}

	/**
	 * @param {boolean} victory
	 * @param {object} stats {kills, damage, survival, accuracy, loot, placement, total}
	 */
	showEnd(victory, stats) {
		this.endTitle.textContent = victory ? "VICTORY" : "DEFEATED"
		this.endTitle.classList.toggle("defeat", !victory)
		this.endSubtitle.textContent = victory
			? "LAST COMBATANT STANDING ON " + GAME.mapName
			: "PLACEMENT #" + stats.placement + " OF " + stats.total
		this.endStats.innerHTML = ""
		const rows = [
			["Eliminations", String(stats.kills)],
			["Damage dealt", String(Math.round(stats.damage))],
			["Survival time", formatTime(stats.survival)],
			["Accuracy", Math.round(stats.accuracy * 100) + "%"],
			["Headshots", String(stats.headshots || 0)],
			["Loot collected", String(stats.loot || 0)],
			["Placement", "#" + stats.placement + " / " + stats.total],
		]
		for (const [label, value] of rows) {
			const row = el("div", "end-stat", this.endStats)
			el("span", "stat-name", row, label)
			el("span", "stat-number", row, value)
		}
		this.show("end")
	}

	// ---------------------------------------------------------------- errors

	buildError() {
		const s = this.screen("error", "error-screen")
		el("h2", "screen-title", s, "UNABLE TO START")
		this.errorBody = el("p", "screen-note", s, "")
		el("p", "screen-note", s,
			"This game needs a browser with WebGL2 and hardware acceleration enabled. Try the latest Chrome, Edge or Firefox.")
	}

	showError(message) {
		this.errorBody.textContent = message
		this.show("error")
	}

	// ------------------------------------------------------------ navigation

	show(name, returnTo) {
		if (this.current && this.screens[this.current]) this.screens[this.current].classList.add("hidden")
		this.current = name
		if (name && this.screens[name]) this.screens[name].classList.remove("hidden")
		this.overlay.classList.toggle("active", !!name)
		if (returnTo !== undefined) this.returnTo = returnTo
		else if (name === "main" || name === "pause") this.returnTo = name
	}

	back() {
		this.show(this.returnTo || "main")
	}

	hide() {
		if (this.current && this.screens[this.current]) this.screens[this.current].classList.add("hidden")
		this.current = null
		this.overlay.classList.remove("active")
	}

	get isOpen() {
		return !!this.current
	}
}
