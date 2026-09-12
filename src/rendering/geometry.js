/**
 * Procedural geometry library.
 *
 * Every prop in the game is assembled from these primitives, which lets the
 * renderer draw the entire island with a handful of instanced draw calls.
 * The data layout (positions + normals + Uint16 indices) is exactly what a
 * GLTF/GLB loader produces, so real assets can be registered here later
 * without touching the renderer.
 */

function pack(p, n, idx) {
	return { positions: new Float32Array(p), normals: new Float32Array(n), indices: new Uint16Array(idx) }
}

function buildBox() {
	const p = [], n = [], idx = []
	const faces = [
		[[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5], [0, 0, 1]],
		[[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5], [0, 0, -1]],
		[[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5], [1, 0, 0]],
		[[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [-1, 0, 0]],
		[[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5], [0, 1, 0]],
		[[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5], [0, -1, 0]],
	]
	for (const f of faces) {
		const nor = f[4]
		const base = p.length / 3
		for (let i = 0; i < 4; i++) {
			p.push(f[i][0], f[i][1], f[i][2])
			n.push(nor[0], nor[1], nor[2])
		}
		idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
	}
	return pack(p, n, idx)
}

/** Cylinder / truncated cone along +Y. Unit height, unit diameter. */
function buildCylinder(segments, topScale = 1) {
	const p = [], n = [], idx = []
	for (let i = 0; i < segments; i++) {
		const a0 = (i / segments) * Math.PI * 2
		const a1 = ((i + 1) / segments) * Math.PI * 2
		const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1)
		const base = p.length / 3
		p.push(c0 * 0.5, -0.5, s0 * 0.5, c1 * 0.5, -0.5, s1 * 0.5,
			c1 * 0.5 * topScale, 0.5, s1 * 0.5 * topScale, c0 * 0.5 * topScale, 0.5, s0 * 0.5 * topScale)
		n.push(c0, 0.15, s0, c1, 0.15, s1, c1, 0.15, s1, c0, 0.15, s0)
		idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
		const top = p.length / 3
		p.push(0, 0.5, 0, c0 * 0.5 * topScale, 0.5, s0 * 0.5 * topScale, c1 * 0.5 * topScale, 0.5, s1 * 0.5 * topScale)
		n.push(0, 1, 0, 0, 1, 0, 0, 1, 0)
		idx.push(top, top + 1, top + 2)
		const bot = p.length / 3
		p.push(0, -0.5, 0, c1 * 0.5, -0.5, s1 * 0.5, c0 * 0.5, -0.5, s0 * 0.5)
		n.push(0, -1, 0, 0, -1, 0, 0, -1, 0)
		idx.push(bot, bot + 1, bot + 2)
	}
	return pack(p, n, idx)
}

function buildCone(segments) {
	const p = [], n = [], idx = []
	for (let i = 0; i < segments; i++) {
		const a0 = (i / segments) * Math.PI * 2
		const a1 = ((i + 1) / segments) * Math.PI * 2
		const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1)
		const base = p.length / 3
		p.push(c0 * 0.5, -0.5, s0 * 0.5, c1 * 0.5, -0.5, s1 * 0.5, 0, 0.5, 0)
		n.push(c0, 0.5, s0, c1, 0.5, s1, 0, 1, 0)
		idx.push(base, base + 1, base + 2)
		const bot = p.length / 3
		p.push(0, -0.5, 0, c1 * 0.5, -0.5, s1 * 0.5, c0 * 0.5, -0.5, s0 * 0.5)
		n.push(0, -1, 0, 0, -1, 0, 0, -1, 0)
		idx.push(bot, bot + 1, bot + 2)
	}
	return pack(p, n, idx)
}

function buildSphere(rings, segments) {
	const p = [], n = [], idx = []
	for (let r = 0; r <= rings; r++) {
		const phi = (r / rings) * Math.PI
		for (let s = 0; s <= segments; s++) {
			const theta = (s / segments) * Math.PI * 2
			const x = Math.sin(phi) * Math.cos(theta)
			const y = Math.cos(phi)
			const z = Math.sin(phi) * Math.sin(theta)
			p.push(x * 0.5, y * 0.5, z * 0.5)
			n.push(x, y, z)
		}
	}
	const stride = segments + 1
	for (let r = 0; r < rings; r++) {
		for (let s = 0; s < segments; s++) {
			const a = r * stride + s
			idx.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1)
		}
	}
	return pack(p, n, idx)
}

/** Flat horizontal quad on the XZ plane (roads, decals, helipads). */
function buildPlane() {
	return pack(
		[-0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 0, -0.5, -0.5, 0, -0.5],
		[0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
		[0, 1, 2, 0, 2, 3],
	)
}

/** Two crossed vertical quads - cheap double sided vegetation billboard. */
function buildCard() {
	const p = [], n = [], idx = []
	for (const rot of [0, Math.PI / 2]) {
		const c = Math.cos(rot), s = Math.sin(rot)
		const base = p.length / 3
		p.push(-0.5 * c, 0, -0.5 * s, 0.5 * c, 0, 0.5 * s, 0.5 * c, 1, 0.5 * s, -0.5 * c, 1, -0.5 * s)
		for (let i = 0; i < 4; i++) n.push(-s * 0.35, 0.92, c * 0.35)
		idx.push(base, base + 1, base + 2, base, base + 2, base + 3)
		idx.push(base + 2, base + 1, base, base + 3, base + 2, base)
	}
	return pack(p, n, idx)
}

/** Irregular low poly boulder. */
function buildPrism() {
	const base = buildSphere(4, 7)
	const positions = base.positions.slice()
	for (let i = 0; i < positions.length; i += 3) {
		const h = Math.sin(positions[i] * 9.7 + positions[i + 2] * 5.3) * 0.14
		positions[i] *= 1 + h
		positions[i + 1] *= 0.9 + h * 0.5
		positions[i + 2] *= 1 + h * 0.8
	}
	return { positions, normals: base.normals, indices: base.indices }
}

export const GEOMETRIES = {
	box: buildBox(),
	cyl: buildCylinder(14),
	cylLow: buildCylinder(8),
	taper: buildCylinder(8, 0.55),
	sphere: buildSphere(10, 14),
	sphereLow: buildSphere(5, 7),
	cone: buildCone(10),
	plane: buildPlane(),
	card: buildCard(),
	prism: buildPrism(),
}

export const GEOMETRY_NAMES = Object.keys(GEOMETRIES)
