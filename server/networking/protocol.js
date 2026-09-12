/**
 * Wire protocol shared by the client net adapter and the server.
 *
 * Clients only ever send intent (input frames, room actions). The server is
 * the sole authority for movement results, damage, health, inventory and match
 * state, and broadcasts snapshots.
 */

export const CLIENT_MSG = {
	HELLO: "hello",
	CREATE_ROOM: "createRoom",
	JOIN_ROOM: "joinRoom",
	READY: "ready",
	INPUT: "input",
	REMATCH: "rematch",
	LEAVE: "leave",
	PING: "ping",
}

export const SERVER_MSG = {
	WELCOME: "welcome",
	ROOM_STATE: "roomState",
	MATCH_START: "matchStart",
	SNAPSHOT: "snapshot",
	EVENT: "event",
	MATCH_END: "matchEnd",
	ERROR: "error",
	PONG: "pong",
}

export const ERROR_CODE = {
	INVALID_ROOM: "INVALID_ROOM",
	ROOM_FULL: "ROOM_FULL",
	NOT_IN_ROOM: "NOT_IN_ROOM",
	RATE_LIMITED: "RATE_LIMITED",
	BAD_MESSAGE: "BAD_MESSAGE",
}

/** Input button bit flags, mirrored in src/net/netAdapter.js. */
export const BUTTON = {
	FIRE: 1, AIM: 2, SPRINT: 4, CROUCH: 8, JUMP: 16, RELOAD: 32, INTERACT: 64,
}

export const TICK_RATE = 30
export const SNAPSHOT_INTERVAL = 1000 / TICK_RATE
export const CLIENT_TIMEOUT_MS = 12000
export const MAX_INPUTS_PER_SECOND = 180

/** Room codes avoid ambiguous characters (no O/0, I/1). */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"

export function generateRoomCode(length = 6) {
	let out = ""
	for (let i = 0; i < length; i++) {
		out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
	}
	return out
}

export function isValidRoomCode(code) {
	return typeof code === "string" && /^[A-Z2-9]{6}$/.test(code.toUpperCase())
}
