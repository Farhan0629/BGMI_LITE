#!/usr/bin/env node
/**
 * Zero-dependency static dev server.
 * The game ships as native ES modules, so no bundling step is required:
 * this simply serves the project root with correct MIME types.
 *
 *   node scripts/dev-server.mjs [--port 5173]
 */
import { createServer } from "node:http"
import { readFile, stat } from "node:fs/promises"
import { extname, join, normalize, resolve } from "node:path"

const ROOT = resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : ".")
const portFlag = process.argv.indexOf("--port")
const PORT = Number(process.env.PORT || (portFlag > -1 ? process.argv[portFlag + 1] : 5173))

const MIME = {
	".html": "text/html; charset=utf-8",
	".js": "text/javascript; charset=utf-8",
	".mjs": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".svg": "image/svg+xml",
	".glb": "model/gltf-binary",
	".gltf": "model/gltf+json",
	".ogg": "audio/ogg",
	".mp3": "audio/mpeg",
	".wav": "audio/wav",
	".ico": "image/x-icon",
}

const server = createServer(async (req, res) => {
	try {
		const url = new URL(req.url || "/", `http://${req.headers.host}`)
		let path = decodeURIComponent(url.pathname)
		if (path.endsWith("/")) path += "index.html"
		const filePath = join(ROOT, normalize(path).replace(/^\/+/, ""))
		if (!filePath.startsWith(ROOT)) {
			res.writeHead(403).end("Forbidden")
			return
		}
		const info = await stat(filePath)
		if (info.isDirectory()) {
			res.writeHead(302, { Location: path + "/" }).end()
			return
		}
		const body = await readFile(filePath)
		res.writeHead(200, {
			"Content-Type": MIME[extname(filePath)] || "application/octet-stream",
			"Cache-Control": "no-cache",
		})
		res.end(body)
	} catch {
		res.writeHead(404, { "Content-Type": "text/plain" }).end("404 Not Found")
	}
})

server.listen(PORT, () => {
	console.log(`FRONTIER STRIKE dev server -> http://localhost:${PORT}`)
})
