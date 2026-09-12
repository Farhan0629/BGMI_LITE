/**
 * Minimal RFC 6455 WebSocket server on top of node:http.
 *
 * The whole project is dependency free on purpose (see README), so instead of
 * pulling in `ws` or socket.io this implements just what the game needs:
 * the upgrade handshake, text/binary frame decoding, close/ping handling and
 * text frame encoding. It supports fragmented frames and payloads up to 2^32.
 */
import { createHash } from "node:crypto"
import { EventEmitter } from "node:events"

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const OP = { CONT: 0x0, TEXT: 0x1, BIN: 0x2, CLOSE: 0x8, PING: 0x9, PONG: 0xa }

function acceptKey(key) {
	return createHash("sha1").update(key + GUID).digest("base64")
}

/** Encode a server -> client frame (never masked). */
function encodeFrame(opcode, payload) {
	const len = payload.length
	let header
	if (len < 126) {
		header = Buffer.alloc(2)
		header[1] = len
	} else if (len < 65536) {
		header = Buffer.alloc(4)
		header[1] = 126
		header.writeUInt16BE(len, 2)
	} else {
		header = Buffer.alloc(10)
		header[1] = 127
		header.writeUInt32BE(0, 2)
		header.writeUInt32BE(len, 6)
	}
	header[0] = 0x80 | opcode
	return Buffer.concat([header, payload])
}

export class WsConnection extends EventEmitter {
	constructor(socket) {
		super()
		this.socket = socket
		this.buffer = Buffer.alloc(0)
		this.fragments = []
		this.fragmentOp = 0
		this.open = true
		this.lastSeen = Date.now()

		socket.on("data", (chunk) => {
			this.buffer = Buffer.concat([this.buffer, chunk])
			try {
				this.drain()
			} catch (err) {
				this.close(1002, "protocol error")
			}
		})
		socket.on("close", () => this.handleClosed())
		socket.on("error", () => this.handleClosed())
	}

	handleClosed() {
		if (!this.open) return
		this.open = false
		this.emit("close")
	}

	/** Parse as many complete frames as the buffer holds. */
	drain() {
		for (;;) {
			const buf = this.buffer
			if (buf.length < 2) return
			const fin = (buf[0] & 0x80) !== 0
			const opcode = buf[0] & 0x0f
			const masked = (buf[1] & 0x80) !== 0
			let len = buf[1] & 0x7f
			let offset = 2
			if (len === 126) {
				if (buf.length < 4) return
				len = buf.readUInt16BE(2)
				offset = 4
			} else if (len === 127) {
				if (buf.length < 10) return
				const high = buf.readUInt32BE(2)
				if (high !== 0) throw new Error("frame too large")
				len = buf.readUInt32BE(6)
				offset = 10
			}
			const maskLen = masked ? 4 : 0
			if (buf.length < offset + maskLen + len) return
			const mask = masked ? buf.subarray(offset, offset + 4) : null
			const start = offset + maskLen
			const payload = Buffer.from(buf.subarray(start, start + len))
			if (mask) {
				for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3]
			}
			this.buffer = buf.subarray(start + len)
			this.lastSeen = Date.now()
			this.handleFrame(fin, opcode, payload)
		}
	}

	handleFrame(fin, opcode, payload) {
		if (opcode === OP.CLOSE) {
			this.close(1000, "bye")
			return
		}
		if (opcode === OP.PING) {
			this.socket.write(encodeFrame(OP.PONG, payload))
			return
		}
		if (opcode === OP.PONG) return

		if (opcode === OP.CONT) {
			this.fragments.push(payload)
		} else {
			this.fragments = [payload]
			this.fragmentOp = opcode
		}
		if (!fin) return
		const full = Buffer.concat(this.fragments)
		this.fragments = []
		if (this.fragmentOp === OP.TEXT) {
			const text = full.toString("utf8")
			let message = null
			try {
				message = JSON.parse(text)
			} catch (err) {
				this.emit("invalid", text)
				return
			}
			this.emit("message", message)
		} else {
			this.emit("binary", full)
		}
	}

	send(object) {
		if (!this.open) return false
		try {
			this.socket.write(encodeFrame(OP.TEXT, Buffer.from(JSON.stringify(object), "utf8")))
			return true
		} catch (err) {
			this.handleClosed()
			return false
		}
	}

	ping() {
		if (this.open) this.socket.write(encodeFrame(OP.PING, Buffer.alloc(0)))
	}

	close(code = 1000, reason = "") {
		if (!this.open) return
		const payload = Buffer.alloc(2 + Buffer.byteLength(reason))
		payload.writeUInt16BE(code, 0)
		payload.write(reason, 2)
		try {
			this.socket.write(encodeFrame(OP.CLOSE, payload))
			this.socket.end()
		} catch (err) { /* socket already gone */ }
		this.handleClosed()
	}
}

/** Attach WebSocket upgrade handling to an http server. */
export function attachWebSocket(httpServer, onConnection) {
	httpServer.on("upgrade", (req, socket) => {
		const key = req.headers["sec-websocket-key"]
		if (String(req.headers.upgrade || "").toLowerCase() !== "websocket" || !key) {
			socket.end("HTTP/1.1 400 Bad Request\r\n\r\n")
			return
		}
		socket.setNoDelay(true)
		socket.write(
			"HTTP/1.1 101 Switching Protocols\r\n" +
			"Upgrade: websocket\r\n" +
			"Connection: Upgrade\r\n" +
			"Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n")
		onConnection(new WsConnection(socket), req)
	})
}
