/**
 * Entry point. Creates the canvas + UI root, verifies the browser can run the
 * engine and fails gracefully with a readable message when it cannot.
 */
import { GAME } from "./config/game.js"
import { Game } from "./game.js"

function fatal(message, detail) {
	console.error("[" + GAME.name + "] " + message, detail || "")
	const root = document.getElementById("ui-root") || document.body
	const panel = document.createElement("div")
	panel.className = "fatal-error"
	panel.innerHTML =
		'<h1>' + GAME.name + '</h1>' +
		'<h2>UNABLE TO START</h2>' +
		'<p></p>' +
		'<p class="muted">Requires a desktop browser with WebGL2 and hardware acceleration ' +
		'(Chrome, Edge or Firefox recommended).</p>'
	panel.querySelectorAll("p")[0].textContent = message
	root.appendChild(panel)
}

function supportsWebGL2() {
	try {
		const probe = document.createElement("canvas")
		return !!probe.getContext("webgl2")
	} catch (err) {
		return false
	}
}

function boot() {
	const canvas = document.getElementById("game-canvas")
	const uiRoot = document.getElementById("ui-root")
	if (!canvas || !uiRoot) {
		fatal("Page shell is missing the game canvas or UI root element.")
		return
	}
	if (!supportsWebGL2()) {
		fatal("This browser does not expose WebGL2, which the renderer requires.")
		return
	}
	try {
		window.frontierStrike = new Game(canvas, uiRoot)
		console.info("[" + GAME.name + "] v" + GAME.version + " ready")
	} catch (err) {
		if (err && String(err.message).indexOf("WEBGL2_UNAVAILABLE") >= 0) {
			fatal("Could not create a WebGL2 context.", err)
		} else {
			fatal("The engine failed to initialise: " + (err && err.message ? err.message : String(err)), err)
		}
	}
}

// Surface unexpected runtime errors instead of silently dying.
window.addEventListener("error", (e) => {
	console.error("[runtime]", e.message, e.filename + ":" + e.lineno)
})
window.addEventListener("unhandledrejection", (e) => {
	console.error("[runtime] unhandled promise rejection:", e.reason)
})

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", boot)
} else {
	boot()
}
