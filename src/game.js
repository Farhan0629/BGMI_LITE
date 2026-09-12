/**
 * Game: owns every system and the main loop.
 *
 * Loop shape
 *  - Simulation runs on a fixed 1/60 s step (max 5 steps per frame) so
 *    physics, recoil and AI are frame-rate independent and deterministic
 *    enough to be re-simulated by an authoritative server in V2.
 *  - Rendering happens once per animation frame.
 *  - The world is built one labelled step per frame so the loading screen
 *    shows real progress instead of freezing the tab.
 */
import { GAME } from "./config/game.js"
import { QUALITY } from "./config/graphics.js"
import { WEAPONS } from "./config/weapons.js"
import { PLAYER } from "./config/player.js"
import { bus } from "./core/events.js"
import { Rng } from "./core/random.js"
import { clamp } from "./core/math.js"
import { SettingsStore } from "./core/settings.js"
import { Renderer } from "./rendering/renderer.js"
import { ParticleSystem } from "./rendering/particles.js"
import { Environment } from "./rendering/environment.js"
import { World } from "./world/world.js"
import { Player } from "./player/player.js"
import { CameraRig } from "./camera/cameraRig.js"
import { InputSystem } from "./input/input.js"
import { WeaponController } from "./weapons/weaponController.js"
import { CombatSystem } from "./combat/combat.js"
import { GrenadeSystem } from "./combat/grenades.js"
import { BotManager } from "./ai/botManager.js"
import { LootSystem, lootLabel } from "./loot/loot.js"
import { Inventory } from "./inventory/inventory.js"
import { Zone } from "./zone/zone.js"
import { AudioEngine } from "./audio/audio.js"
import { Hud } from "./ui/hud.js"
import { Minimap } from "./ui/minimap.js"
import { DebugOverlay } from "./ui/debug.js"
import { MenuSystem } from "./ui/menu.js"
import { InventoryPanel } from "./ui/inventoryPanel.js"
import { MatchSystem, MATCH_STATE } from "./match/match.js"
import { Vehicle, ATV, spawnVehicles } from "./vehicle/atv.js"
import { NetAdapter } from "./net/netAdapter.js"

const BOT_COUNTS = GAME.botCounts

export class Game {
	constructor(canvas, uiRoot) {
		this.canvas = canvas
		this.uiRoot = uiRoot
		this.settings = new SettingsStore()
		this.running = false
		this.paused = false
		this.accumulator = 0
		this.lastTime = 0
		this.cmd = {}
		this.scratchDir = { x: 0, y: 0, z: 0 }
		this.candidates = []
		this.vehicles = []
		this.buildQueue = null
		this.buildIndex = 0
		this.damageFx = 0
		this.promptText = ""
		this.nearbyLoot = null
		this.nearbyVehicle = null

		const gfx = this.settings.get("graphics")
		this.renderer = new Renderer(canvas, gfx.quality)
		this.particles = new ParticleSystem(QUALITY[gfx.quality].maxParticles)
		this.environment = new Environment()
		this.audio = new AudioEngine()
		this.input = new InputSystem(canvas)
		this.net = new NetAdapter()

		this.hud = new Hud(uiRoot, this.settings)
		this.minimap = new Minimap(uiRoot)
		this.debug = new DebugOverlay(uiRoot)
		this.inventoryPanel = new InventoryPanel(uiRoot, {
			onSelectSlot: (i) => this.player && this.player.weapons.selectSlot(i),
			onUseHeal: (id) => this.useHeal(id),
		})
		this.menu = new MenuSystem(uiRoot, this.settings, {
			onPlay: () => this.startMatch("battle"),
			onTraining: () => this.startMatch("training"),
			onResume: () => this.resume(),
			onRestart: () => this.startMatch(this.match ? this.match.mode : "battle"),
			onQuit: () => this.quitToMenu(),
			onQualityChange: (q) => this.applyQuality(q),
			onGraphicsChange: () => this.applyGraphics(),
			onAudioChange: () => this.applyAudio(),
			onCameraMode: (m) => this.camera && this.camera.setMode(m),
			onUiScale: (v) => this.applyUiScale(v),
			onEnvironmentChange: () => this.applyEnvironment(),
			onFullscreen: () => this.toggleFullscreen(),
			onClickSound: () => this.audio.uiClick(),
			onHoverSound: () => this.audio.uiHover(),
		})

		this.applyUiScale(this.settings.get("gameplay").uiScale)
		this.applyEnvironment()
		this.bindEvents()
		this.showMenu()
		this.loop = this.loop.bind(this)
		requestAnimationFrame(this.loop)
	}

	// ------------------------------------------------------------- lifecycle

	showMenu() {
		this.hud.setVisible(false)
		this.minimap.setVisible(false)
		this.inventoryPanel.setVisible(false)
		this.menu.show("main")
		this.input.enabled = false
		this.input.releaseLock()
	}

	/** Build the world (async, one step per frame) then deploy. */
	async startMatch(mode) {
		this.audio.init()
		this.audio.resume()
		this.applyAudio()
		this.menu.show("loading")
		this.menu.setLoading(0, "Allocating systems...")
		this.hud.clear()
		this.mode = mode

		// Fresh world each match so the island layout and loot are re-rolled.
		if (this.world) this.world.dispose()
		const seed = GAME.worldSeed + (Date.now() % 100000)
		this.world = new World(seed)
		this.rng = new Rng(seed ^ 0x9e37)
		const gfx = this.settings.get("graphics")
		const steps = this.world.buildSteps(QUALITY[this.renderer.qualityName].terrainSegments)

		for (let i = 0; i < steps.length; i++) {
			this.menu.setLoading(i / (steps.length + 2), steps[i].label)
			// Yield to the browser so the progress bar actually paints.
			await new Promise((resolve) => requestAnimationFrame(() => resolve()))
			try {
				steps[i].run()
			} catch (err) {
				console.error("[world] build step failed:", steps[i].label, err)
				this.menu.showError("World generation failed during: " + steps[i].label)
				return
			}
		}

		this.menu.setLoading(0.9, "Uploading terrain and spawning combatants...")
		await new Promise((resolve) => requestAnimationFrame(() => resolve()))
		this.renderer.uploadTerrain(this.world.terrain)
		this.buildSystems(mode)
		this.menu.setLoading(1, "Ready")

		this.menu.show("countdown")
		this.hud.setVisible(true)
		this.minimap.setVisible(mode === "battle")
		this.input.enabled = true
		this.input.requestLock()
		this.audio.startAmbience()
		const botCount = mode === "training" ? 6 : BOT_COUNTS[this.settings.get("gameplay").botCount]
		this.match.begin(mode, botCount)
		this.running = true
		this.paused = false
		void gfx
	}

	/** Instantiate gameplay systems against the freshly built world. */
	buildSystems(mode) {
		const gameplay = this.settings.get("gameplay")
		this.combat = new CombatSystem(this.world, this.particles)
		this.grenades = new GrenadeSystem(this.world, this.combat, this.particles)
		this.loot = new LootSystem(this.world, this.rng)
		this.zone = new Zone(this.world, this.rng)
		this.player = new Player(this.world)
		this.player.weapons = new WeaponController(this.player, this.combat)
		this.player.inventory = new Inventory(this.player, this.player.weapons, this.loot)
		this.camera = new CameraRig(this.world.collision)
		this.camera.setMode(gameplay.cameraMode)
		this.bots = new BotManager(this.world, this.combat, this.world.rng.int(1, 1e9))

		this.loot.generate()
		this.vehicles = mode === "battle" ? spawnVehicles(this.world, 6) : []

		// Spawn the player at the first deployment point, bots everywhere else.
		const spawn = this.world.spawns[0] || { x: 0, z: 0 }
		this.player.spawn(spawn.x, spawn.z, this.world.rng.angle())
		this.player.weapons.equip("pistol_sidewinder", true)
		this.player.weapons.addAmmo("pistol", 45)
		this.camera.reset(this.player.yaw)

		const botCount = mode === "training" ? 6 : BOT_COUNTS[gameplay.botCount]
		this.bots.spawn(botCount, gameplay.difficulty)
		this.refreshTargets()

		this.match = new MatchSystem({
			player: this.player, bots: this.bots, loot: this.loot,
			zone: mode === "battle" ? this.zone : null, hud: this.hud, audio: this.audio,
		})
		this.applyGraphics()
		this.applyControls()
	}

	refreshTargets() {
		const list = [this.player]
		for (const b of this.bots.bots) list.push(b)
		this.combat.setTargets(list)
	}

	pause() {
		if (!this.running || this.paused || !this.match || this.match.state === MATCH_STATE.OVER) return
		this.paused = true
		this.input.enabled = false
		this.input.releaseLock()
		this.menu.show("pause")
	}

	resume() {
		if (!this.running) return
		this.paused = false
		this.menu.hide()
		this.input.enabled = true
		this.input.requestLock()
		this.audio.resume()
	}

	quitToMenu() {
		this.running = false
		this.paused = false
		this.audio.stopAmbience()
		this.audio.setEngine(false, 0)
		if (this.match) this.match.reset()
		this.showMenu()
	}

	// ---------------------------------------------------------------- options

	applyQuality(name) {
		this.renderer.setQuality(name)
		this.particles.setBudget(Math.floor(
			QUALITY[this.renderer.qualityName].maxParticles * this.settings.get("graphics").particleDensity))
		if (this.world && this.world.terrain) this.renderer.uploadTerrain(this.world.terrain)
	}

	applyGraphics() {
		const g = this.settings.get("graphics")
		this.particles.setBudget(Math.floor(QUALITY[this.renderer.qualityName].maxParticles * g.particleDensity))
		this.renderer.resize()
	}

	applyAudio() {
		const a = this.settings.get("audio")
		this.audio.setVolumes({ master: a.master, sfx: a.sfx, ambience: a.ambience, music: a.music })
	}

	applyControls() {
		const c = this.settings.get("controls")
		if (!this.camera) return
		this.camera.sensitivity = c.sensitivity
		this.camera.invertY = c.invertY
		this.camera.shakeScale = this.settings.get("gameplay").cameraShake
	}

	applyUiScale(scale) {
		document.documentElement.style.setProperty("--ui-scale", String(scale || 1))
	}

	applyEnvironment() {
		const g = this.settings.get("gameplay")
		this.environment.setTimeOfDay(g.timeOfDay)
		this.environment.setWeather(g.weather)
	}

	toggleFullscreen() {
		const target = document.documentElement
		if (!document.fullscreenElement) {
			if (target.requestFullscreen) target.requestFullscreen().catch(() => {})
		} else if (document.exitFullscreen) {
			document.exitFullscreen().catch(() => {})
		}
	}

	// ----------------------------------------------------------------- events

	bindEvents() {
		window.addEventListener("resize", () => this.renderer.resize())
		bus.on("combat:shot", (e) => {
			// Gunfire shows on the minimap briefly, which is how the player
			// locates fights without seeing every bot.
			if (!e.isPlayer) this.minimap.addBlip(e.x, e.z)
		})
		bus.on("combat:playerDamaged", (e) => {
			this.damageFx = 1
			if (this.camera) this.camera.addShake(0.35)
			if (e && this.player) {
				e.playerX = this.player.pos.x
				e.playerZ = this.player.pos.z
				e.playerYaw = this.player.yaw
			}
		})
		bus.on("explosion", (e) => {
			if (!this.camera || !this.player) return
			const d = Math.hypot(e.x - this.player.pos.x, e.z - this.player.pos.z)
			this.camera.addShake(clamp(1 - d / 30, 0, 1) * 0.9)
		})
		bus.on("player:land", (e) => {
			if (this.camera && e.speed > 6) this.camera.addShake(clamp(e.speed / 30, 0, 0.6))
		})
		bus.on("match:state", (e) => {
			if (e.state === MATCH_STATE.OVER) {
				this.input.releaseLock()
			}
		})
		bus.on("input:pointerLock", (locked) => {
			// Losing the pointer lock mid-match pauses rather than leaving the
			// player defenceless.
			if (!locked && this.running && !this.paused && this.match && this.match.isLive) this.pause()
		})
	}

	// ------------------------------------------------------------ interaction

	useHeal(id) {
		if (!this.player || this.player.dead) return
		const best = id || this.player.inventory.bestHeal()
		if (!best) {
			bus.emit("ui:toast", { text: "NO MEDICAL ITEMS", tone: "warn" })
			return
		}
		if (this.player.inventory.useHeal(best)) {
			this.hud.showSubtitle("[using " + (PLAYER.healItems[best] ? PLAYER.healItems[best].name : best) + "]")
		}
	}

	/** Resolve the nearest interactable and build the HUD prompt. */
	updateInteraction() {
		this.promptText = ""
		this.nearbyLoot = null
		this.nearbyVehicle = null
		if (!this.player || this.player.dead) return
		const p = this.player.pos

		if (this.player.inVehicle) {
			this.promptText = "F - EXIT " + ATV.name.toUpperCase()
			return
		}
		for (let i = 0; i < this.vehicles.length; i++) {
			const v = this.vehicles[i]
			if (v.destroyed || v.occupied) continue
			if (Math.hypot(v.pos.x - p.x, v.pos.z - p.z) < ATV.enterRange) {
				this.nearbyVehicle = v
				this.promptText = "F - ENTER " + ATV.name.toUpperCase()
				break
			}
		}
		const item = this.loot.nearest(p.x, p.y, p.z, PLAYER.interactRange)
		if (item) {
			this.nearbyLoot = item
			this.promptText = this.player.inventory.isFull && item.kind !== "weapon"
				? "INVENTORY FULL"
				: "E - PICK UP " + lootLabel(item).toUpperCase()
		}
	}

	handleCommands(cmd) {
		const p = this.player
		if (!p) return

		// Weapon selection.
		if (cmd.slot >= 0) p.weapons.selectSlot(cmd.slot)
		if (cmd.wheel) p.weapons.cycleSlot(cmd.wheel > 0 ? 1 : -1)
		if (cmd.reload) p.weapons.startReload()
		if (cmd.heal) this.useHeal(null)

		// Pick up / enter vehicle.
		if (cmd.interact && this.nearbyLoot) {
			const result = p.inventory.pickup(this.nearbyLoot)
			if (!result.ok) bus.emit("ui:toast", { text: result.reason || "CANNOT PICK UP", tone: "warn" })
		}
		if (cmd.vehicle) {
			if (p.inVehicle) {
				p.inVehicle.exit()
				p.inVehicle = null
				this.audio.setEngine(false, 0)
			} else if (this.nearbyVehicle && this.nearbyVehicle.enter(p)) {
				p.inVehicle = this.nearbyVehicle
			}
		}

		// Grenade throw from the camera aim direction.
		if (cmd.grenade && p.inventory.grenades > 0 && !p.dead) {
			const dir = this.camera.forward(this.scratchDir)
			p.inventory.grenades--
			this.grenades.throw_(p, p.pos.x + dir.x, p.eyeY(), p.pos.z + dir.z, dir.x, dir.y + 0.18, dir.z, 19)
			bus.emit("ui:toast", { text: "GRENADE OUT" })
		}
	}

	// ------------------------------------------------------------- simulation

	step(dt, cmd) {
		const p = this.player

		// Vehicle driving takes over movement.
		if (p.inVehicle) {
			const v = p.inVehicle
			v.update(dt, { forward: cmd.forward, right: cmd.strafe, brake: !!cmd.jump })
			this.audio.setEngine(true, v.speed01)
			p.yaw = this.camera.yaw
			p.pitch = this.camera.pitch
			if (v.destroyed) {
				v.exit()
				p.inVehicle = null
				this.audio.setEngine(false, 0)
			}
		} else {
			p.update(dt, cmd, this.camera)
		}

		// Weapons: fire/aim state drives the controller, which reports shots so
		// the camera can kick and the rig can animate.
		const dir = this.camera.forward(this.scratchDir)
		const originY = this.camera.mode === "first" ? p.eyeY() : p.eyeY()
		const shots = p.weapons.update(dt, {
			fire: cmd.fire && !p.dead && this.match.isLive,
			firePressed: cmd.firePressed && !p.dead && this.match.isLive,
			aiming: p.aiming,
			moveSpeed: p.speed,
			crouching: p.crouching,
			origin: { x: p.pos.x, y: originY, z: p.pos.z },
			dir: { x: dir.x, y: dir.y, z: dir.z },
		})
		p.weaponId = p.weapons.weaponId || "melee_talon"
		p.reloading = p.weapons.reloading
		p.switching = p.weapons.switching
		if (shots > 0) {
			const w = p.weapons.weapon
			if (w) {
				const aimScale = p.aiming ? 0.65 : 1
				this.camera.addRecoil(w.recoilPitch * shots * aimScale,
					(Math.random() - 0.5) * w.recoilYaw * 2 * shots * aimScale)
				this.camera.addShake(w.shakeAmount * shots)
				p.stats.shotsFired += shots * (w.pellets || 1)
			}
		}

		// Camera after the player so it follows the resolved position.
		this.camera.update(dt, p.pos, {
			aiming: p.aiming,
			sprinting: p.sprinting,
			crouching: p.crouching,
			grounded: p.grounded,
			dead: p.dead,
			zoomFov: p.aiming && p.weapons.weapon && p.weapons.weapon.scoped ? 26 : 0,
		})

		// AI, combat, loot, zone.
		this.bots.update(dt, p, this.candidates)
		this.combat.update(dt)
		this.grenades.update(dt)
		this.loot.update(dt)
		for (let i = 0; i < this.vehicles.length; i++) {
			const v = this.vehicles[i]
			if (!v.occupied) v.update(dt, null)
		}
		if (this.match.mode === "battle") {
			this.candidates.length = 0
			this.candidates.push(p)
			for (const b of this.bots.bots) if (!b.dead) this.candidates.push(b)
			this.zone.update(dt, this.candidates)
		}
		this.match.update(dt)
	}

	// ------------------------------------------------------------------ frame

	loop(now) {
		requestAnimationFrame(this.loop)
		const seconds = now / 1000
		let frameDt = this.lastTime ? seconds - this.lastTime : 1 / 60
		this.lastTime = seconds
		frameDt = Math.min(frameDt, 0.25)

		// Global hotkeys work even when paused.
		if (this.input.keyPressed("Escape")) {
			if (this.running && !this.paused && this.match && this.match.state !== MATCH_STATE.OVER) this.pause()
			else if (this.paused && this.menu.current === "pause") this.resume()
		}
		if (this.input.keyPressed("F3")) this.debug.toggle()
		if (this.input.keyPressed("F11")) this.toggleFullscreen()

		if (!this.running || !this.player) {
			this.debug.sample(frameDt)
			this.input.endFrame()
			return
		}

		const cmd = this.input.sample(this.cmd)

		if (!this.paused) {
			// Mouse look once per frame (not per fixed step).
			if (this.match.isLive && !this.player.dead) {
				this.camera.addLook(cmd.lookX, cmd.lookY, this.player.aiming)
			}
			if (this.input.wasPressed("cameraToggle")) {
				this.camera.toggleMode()
				this.settings.set("gameplay", { cameraMode: this.camera.mode })
			}
			if (this.input.wasPressed("inventory")) this.inventoryPanel.toggle()
			if (this.input.wasPressed("map")) this.minimap.toggleFullMap()

			if (this.match.state === MATCH_STATE.COUNTDOWN) {
				if (!this.match.updateCountdown(frameDt, this.menu)) this.menu.hide()
			} else if (this.match.isLive) {
				this.updateInteraction()
				this.handleCommands(cmd)
			}

			// Fixed-step simulation.
			this.accumulator += frameDt
			let steps = 0
			while (this.accumulator >= GAME.fixedStep && steps < GAME.maxStepsPerFrame) {
				this.step(GAME.fixedStep, cmd)
				this.accumulator -= GAME.fixedStep
				steps++
				// Edge-triggered inputs must only apply to the first step.
				cmd.firePressed = false
				cmd.jump = cmd.jump && false
			}
			if (steps === GAME.maxStepsPerFrame) this.accumulator = 0

			if (this.match.updateOver(frameDt)) {
				this.hud.setVisible(false)
				this.inventoryPanel.setVisible(false)
				this.menu.showEnd(this.match.victory, this.match.stats)
			}
		}

		this.render(frameDt)
		this.input.endFrame()
	}

	render(dt) {
		const p = this.player
		const gfx = this.settings.get("graphics")
		const gameplay = this.settings.get("gameplay")

		// Environment + audio listener.
		this.damageFx = Math.max(0, this.damageFx - dt * 1.8)
		const env = this.environment.update(dt, this.damageFx * 0.5)
		this.world.updateLights(this.environment.nightFactor)
		this.audio.setListener(this.camera.x, this.camera.y, this.camera.z, this.camera.yaw)
		this.audio.updateEnvironment(dt, env)

		// Rain particles near the camera when it is raining.
		if (this.environment.rain > 0.15 && this.particles.rainBurst) {
			this.particles.rainBurst(this.camera.x, this.camera.y + 12, this.camera.z,
				Math.floor(18 * this.environment.rain * gfx.particleDensity))
		}
		this.particles.update(dt)

		// Dynamic instances for this frame.
		const scene = this.world.scene
		scene.beginFrame()
		p.draw(scene, this.camera.mode === "first")
		this.bots.draw(scene, this.camera, gfx.viewDistance)
		this.loot.draw(scene, this.camera, gfx.viewDistance)
		this.grenades.draw(scene)
		for (let i = 0; i < this.vehicles.length; i++) this.vehicles[i].draw(scene)

		this.renderer.render(scene, this.camera.view, env, this.particles,
			this.world.lights, this.environment.fx)

		// UI.
		const hudState = this.match.hudState({
			prompt: this.promptText,
			crosshairStyle: gameplay.crosshair,
			crosshairColor: gameplay.crosshairColor,
		})
		this.hud.update(dt, hudState)
		if (this.match.mode === "battle") {
			this.minimap.update(dt, p, this.zone, this.bots, this.world.pois)
		}
		if (this.inventoryPanel.visible) {
			const snap = p.inventory.snapshot()
			snap.ammo = this.match.ammoRows()
			snap.helmetLevel = p.helmetLevel
			snap.vestLevel = p.vestLevel
			this.inventoryPanel.update(snap, p.weapons.slotIndex)
		}
		this.debug.update(dt, {
			player: p, bots: this.bots, zone: this.zone, renderer: this.renderer,
			particles: this.particles, loot: this.loot, net: this.net,
			quality: this.renderer.qualityName,
		})
	}
}

export { WEAPONS, Vehicle }
