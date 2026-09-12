#!/usr/bin/env node
/**
 * Zero dependency static dev server.
 *
 * The game ships as native ES modules with no build step, so serving the
 * repository root over HTTP is all that is required. Used by both
 * `npm run dev` and `npm start`.
 */
import { createServer } from "node:http"
import { readFile, stat } from "node:fs/promises"
import { extname, join, normalize, resolve, sep } from "node:path"

const ROOT = resolve(process.cwd())
const PORT = Number(process.env.PORT || 5173)
const HOST = process.env.HOST || "127.0.0.1"

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".webp": "image/webp",
	".ico": "image/x-icon",
	".woff2": "font/woff2",
	".map": "application/json; charset=utf-8",
	".md": "text/markdown; charset=utf-8",
}

/** Strip the query string and resolve inside ROOT (no path traversal). */
function resolveRequestPath(rawUrl) {
	const pathOnly = String(rawUrl || "/").split("?")[0].split("#")[0]
	let decoded
	try {
		decoded = decodeURIComponent(pathOnly)
	} catch {
		decoded = pathOnly
	}
	if (decoded === "/" || decoded === "") decoded = "/index.html"
	const candidate = resolve(join(ROOT, normalize(decoded)))
	if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null
	return candidate
}

const server = createServer(async (req, res) => {
	const filePath = resolveRequestPath(req.url)
	if (!filePath) {
		res.writeHead(403, { "content-type": "text/plain" })
		res.end("Forbidden")
		return
	}
	try {
		const info = await stat(filePath)
		const target = info.isDirectory() ? join(filePath, "index.html") : filePath
		const body = await readFile(target)
		res.writeHead(200, {
			"content-type": MIME[extname(target).toLowerCase()] || "application/octet-stream",
			"cache-control": "no-cache",
			// Needed if you later enable SharedArrayBuffer based workers.
			"x-content-type-options": "nosniff",
		})
		res.end(body)
	} catch (err) {
		res.writeHead(404, { "content-type": "text/plain; charset=utf-8" })
		res.end("404 - " + (req.url || ""))
	}
})

server.listen(PORT, HOST, () => {
	const origin = "http" + "://" + HOST + ":" + PORT
	console.log("FRONTIER STRIKE dev server")
	console.log("  serving " + ROOT)
	console.log("  open    " + origin + "/index.html")
})
