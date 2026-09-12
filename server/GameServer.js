#!/usr/bin/env node
/**
 * FRONTIER STRIKE multiplayer server (Version 2 foundation).
 *
 * Responsibilities
 *  - serve the static client (so one process is enough to play online)
 *  - accept WebSocket connections and manage PlayerSessions
 *  - create/join private rooms by 6 character code
 *  - run the authoritative 30 Hz simulation loop and broadcast snapshots
 *
 * Run with: npm run server
 */
import { createServer } from "node:http"
import { readFile, stat } from "node:fs/promises"
import { extname, join, normalize, resolve, sep } from "node:path"
import { attachWebSocket } from "./networking/wsServer.js"
import {
	CLIENT_MSG, SERVER_MSG, ERROR_CODE, TICK_RATE,
	CLIENT_TIMEOUT_MS, generateRoomCode, isValidRoomCode,
} from "./networking/protocol.js"
import { PlayerSession } from "./PlayerSession.js"
import { Room } from "./Room.js"

const ROOT = resolve(process.cwd())
const PORT = Number(process.env.PORT || 8080)
const HOST = process.env.HOST || "0.0.0.0"
const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".md": "text/markdown; charset=utf-8",
}

export class GameServer {
	constructor() {
		this.rooms = new Map()
		this.sessions = new Set()
		this.http = createServer((req, res) => this.serveStatic(req, res))
		attachWebSocket(this.http, (connection) => this.handleConnection(connection))
		this.lastTick = Date.now()
	}

	listen(port = PORT, host = HOST) {
		this.http.listen(port, host, () => {
			console.log("FRONTIER STRIKE server listening on " + host + ":" + port)
			console.log("  static client served from " + ROOT)
			console.log("  websocket endpoint on the same port (path is ignored)")
		})
		this.timer = setInterval(() => this.step(), 1000 / TICK_RATE)
		this.reaper = setInterval(() => this.reap(), 4000)
	}

	stop() {
		clearInterval(this.timer)
		clearInterval(this.reaper)
		this.http.close()
	}

	// -------------------------------------------------------------- static files

	async serveStatic(req, res) {
		const pathOnly = String(req.url || "/").split("?")[0]
		let rel = pathOnly === "/" ? "/index.html" : pathOnly
		try {
			rel = decodeURIComponent(rel)
		} catch { /* keep raw */ }
		const target = resolve(join(ROOT, normalize(rel)))
		if (target !== ROOT && !target.startsWith(ROOT + sep)) {
			res.writeHead(403).end("Forbidden")
			return
		}
		try {
			const info = await stat(target)
			const file = info.isDirectory() ? join(target, "index.html") : target
			const body = await readFile(file)
			res.writeHead(200, {
				"content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream",
				"cache-control": "no-cache",
			})
			res.end(body)
		} catch {
			res.writeHead(404, { "content-type": "text/plain" }).end("404")
		}
	}

	// --------------------------------------------------------------- connections

	handleConnection(connection) {
		const session = new PlayerSession(connection)
		this.sessions.add(session)
		session.send(SERVER_MSG.WELCOME, { id: session.id, tickRate: TICK_RATE })

		connection.on("message", (msg) => {
			try {
				this.handleMessage(session, msg)
			} catch (err) {
				console.error("[server] message handler failed", err)
				session.error(ERROR_CODE.BAD_MESSAGE, "Server could not process that message.")
			}
		})
		connection.on("invalid", () => session.error(ERROR_CODE.BAD_MESSAGE, "Malformed payload."))
		connection.on("close", () => this.dropSession(session))
	}

	dropSession(session) {
		if (session.room) session.room.remove(session)
		this.sessions.delete(session)
		this.pruneRooms()
	}

	handleMessage(session, msg) {
		switch (msg && msg.type) {
			case CLIENT_MSG.HELLO:
				if (typeof msg.name === "string" && msg.name.trim()) {
					session.name = msg.name.trim().slice(0, 18).toUpperCase()
				}
				break
			case CLIENT_MSG.PING:
				session.send(SERVER_MSG.PONG, { t: msg.t })
				break
			case CLIENT_MSG.CREATE_ROOM: {
				if (session.room) session.room.remove(session)
				const room = this.createRoom()
				room.add(session)
				break
			}
			case CLIENT_MSG.JOIN_ROOM: {
				const code = String(msg.code || "").toUpperCase()
				if (!isValidRoomCode(code)) {
					session.error(ERROR_CODE.INVALID_ROOM, "Room codes are 6 characters.")
					return
				}
				const room = this.rooms.get(code)
				if (!room) {
					session.error(ERROR_CODE.INVALID_ROOM, "No match found with code " + code + ".")
					return
				}
				if (room.full) {
					session.error(ERROR_CODE.ROOM_FULL, "That match is already full.")
					return
				}
				if (session.room) session.room.remove(session)
				room.add(session)
				break
			}
			case CLIENT_MSG.READY:
				if (!session.room) return session.error(ERROR_CODE.NOT_IN_ROOM, "Join a room first.")
				session.room.setReady(session, msg.ready !== false)
				break
			case CLIENT_MSG.INPUT:
				if (!session.room) return
				if (!session.queueInput(msg.frame)) return
				break
			case CLIENT_MSG.REMATCH:
				if (session.room) session.room.rematch()
				break
			case CLIENT_MSG.LEAVE:
				if (session.room) session.room.remove(session)
				this.pruneRooms()
				break
			default:
				session.error(ERROR_CODE.BAD_MESSAGE, "Unknown message type.")
		}
	}

	createRoom() {
		let code = generateRoomCode()
		let guard = 0
		while (this.rooms.has(code) && guard++ < 50) code = generateRoomCode()
		const room = new Room(code)
		this.rooms.set(code, room)
		console.log("[server] room created: " + code)
		return room
	}

	pruneRooms() {
		for (const [code, room] of this.rooms) {
			if (room.empty) {
				this.rooms.delete(code)
				console.log("[server] room closed: " + code)
			}
		}
	}

	/** Drop sessions that stopped responding so rooms do not stall. */
	reap() {
		const now = Date.now()
		for (const session of this.sessions) {
			if (now - session.connection.lastSeen > CLIENT_TIMEOUT_MS) {
				console.warn("[server] timing out " + session.id)
				session.connection.close(1001, "timeout")
				this.dropSession(session)
			} else {
				session.connection.ping()
			}
		}
	}

	step() {
		const now = Date.now()
		const dt = Math.min(0.25, (now - this.lastTick) / 1000)
		this.lastTick = now
		for (const room of this.rooms.values()) room.update(dt)
	}
}

// Start when executed directly (node server/GameServer.js).
if (process.argv[1] && process.argv[1].endsWith("GameServer.js")) {
	const server = new GameServer()
	server.listen()
	process.on("SIGINT", () => {
		console.log("\nshutting down")
		server.stop()
		process.exit(0)
	})
}
