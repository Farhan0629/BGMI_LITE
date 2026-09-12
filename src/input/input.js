/**
 * Input system: keyboard + mouse with pointer lock, rebindable actions and
 * frame-consumable "pressed" edges so gameplay code never reads raw events.
 */
import { bus } from "../core/events.js"
import { GAME } from "../config/game.js"

export const DEFAULT_BINDINGS = {
	forward: "KeyW",
	back: "KeyS",
	left: "KeyA",
	right: "KeyD",
	sprint: "ShiftLeft",
	crouch: "ControlLeft",
	jump: "Space",
	reload: "KeyR",
	interact: "KeyE",
	slot1: "Digit1",
	slot2: "Digit2",
	slot3: "Digit3",
	inventory: "Tab",
	heal: "KeyH",
	cameraToggle: "KeyV",
	vehicle: "KeyF",
	grenade: "KeyG",
	map: "KeyM",
	debug: "F3",
	fullscreen: "F11",
}

const STORAGE_KEY = GAME.storageKey + "/bindings"

export class InputSystem {
	constructor(canvas) {
		this.canvas = canvas
		this.bindings = Object.assign({}, DEFAULT_BINDINGS)
		this.loadBindings()
		/** Held physical keys. */
		this.down = new Set()
		/** Keys pressed since the last frame (edge triggered). */
		this.pressed = new Set()
		this.mouse = { left: false, right: false, dx: 0, dy: 0, wheel: 0 }
		this.mousePressed = { left: false, right: false }
		this.locked = false
		this.enabled = true
		this.captureMouse = true
		this.handlers = []
		this.attach()
	}

	loadBindings() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY)
			if (raw) Object.assign(this.bindings, JSON.parse(raw))
		} catch (err) {
			console.warn("[input] could not read key bindings", err)
		}
	}

	saveBindings() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(this.bindings))
		} catch (err) {
			console.warn("[input] could not save key bindings", err)
		}
	}

	rebind(action, code) {
		if (!(action in this.bindings)) return false
		this.bindings[action] = code
		this.saveBindings()
		return true
	}

	resetBindings() {
		this.bindings = Object.assign({}, DEFAULT_BINDINGS)
		this.saveBindings()
	}

	on(target, type, fn, opts) {
		target.addEventListener(type, fn, opts)
		this.handlers.push([target, type, fn])
	}

	attach() {
		this.on(window, "keydown", (e) => {
			// Keep browser shortcuts usable while still capturing gameplay keys.
			if (e.code === "Tab" || e.code === "Space" || e.code.startsWith("Digit") || e.code === "F3") {
				if (this.enabled) e.preventDefault()
			}
			if (e.repeat) return
			this.down.add(e.code)
			this.pressed.add(e.code)
			bus.emit("input:key", e.code)
		})
		this.on(window, "keyup", (e) => this.down.delete(e.code))
		this.on(window, "blur", () => this.clear())

		this.on(this.canvas, "mousedown", (e) => {
			if (e.button === 0) { this.mouse.left = true; this.mousePressed.left = true }
			if (e.button === 2) { this.mouse.right = true; this.mousePressed.right = true }
			if (this.captureMouse) this.requestLock()
		})
		this.on(window, "mouseup", (e) => {
			if (e.button === 0) this.mouse.left = false
			if (e.button === 2) this.mouse.right = false
		})
		this.on(this.canvas, "contextmenu", (e) => e.preventDefault())
		this.on(window, "mousemove", (e) => {
			if (!this.locked) return
			this.mouse.dx += e.movementX || 0
			this.mouse.dy += e.movementY || 0
		})
		this.on(window, "wheel", (e) => {
			if (!this.enabled) return
			this.mouse.wheel += Math.sign(e.deltaY)
		}, { passive: true })
		this.on(document, "pointerlockchange", () => {
			this.locked = document.pointerLockElement === this.canvas
			bus.emit("input:pointerLock", this.locked)
		})
	}

	requestLock() {
		if (this.locked || !this.enabled) return
		const p = this.canvas.requestPointerLock && this.canvas.requestPointerLock()
		if (p && typeof p.catch === "function") p.catch(() => {})
	}

	releaseLock() {
		if (document.pointerLockElement) document.exitPointerLock()
	}

	clear() {
		this.down.clear()
		this.pressed.clear()
		this.mouse.left = false
		this.mouse.right = false
		this.mouse.dx = 0
		this.mouse.dy = 0
		this.mouse.wheel = 0
	}

	isDown(action) {
		if (!this.enabled) return false
		return this.down.has(this.bindings[action])
	}

	wasPressed(action) {
		if (!this.enabled) return false
		return this.pressed.has(this.bindings[action])
	}

	keyPressed(code) {
		return this.pressed.has(code)
	}

	/** Build the per-frame command object consumed by the player controller. */
	sample(out) {
		const cmd = out || {}
		cmd.forward = (this.isDown("forward") ? 1 : 0) - (this.isDown("back") ? 1 : 0)
		cmd.strafe = (this.isDown("right") ? 1 : 0) - (this.isDown("left") ? 1 : 0)
		cmd.sprint = this.isDown("sprint")
		cmd.crouch = this.isDown("crouch")
		cmd.jump = this.isDown("jump")
		cmd.fire = this.enabled && this.mouse.left
		cmd.firePressed = this.enabled && this.mousePressed.left
		cmd.aim = this.enabled && this.mouse.right
		cmd.reload = this.wasPressed("reload")
		cmd.interact = this.wasPressed("interact")
		cmd.heal = this.wasPressed("heal")
		cmd.grenade = this.wasPressed("grenade")
		cmd.vehicle = this.wasPressed("vehicle")
		cmd.slot = this.wasPressed("slot1") ? 0 : this.wasPressed("slot2") ? 1 : this.wasPressed("slot3") ? 2 : -1
		cmd.wheel = this.mouse.wheel
		cmd.lookX = this.mouse.dx
		cmd.lookY = this.mouse.dy
		return cmd
	}

	/** Must be called once at the end of every frame. */
	endFrame() {
		this.pressed.clear()
		this.mousePressed.left = false
		this.mousePressed.right = false
		this.mouse.dx = 0
		this.mouse.dy = 0
		this.mouse.wheel = 0
	}

	dispose() {
		for (const [t, type, fn] of this.handlers) t.removeEventListener(type, fn)
		this.handlers.length = 0
	}
}
