/**
 * Small, allocation-conscious math library.
 * Matrices are column-major Float32Array(16) so they upload straight to WebGL.
 */

export const DEG2RAD = Math.PI / 180
export const RAD2DEG = 180 / Math.PI
export const TAU = Math.PI * 2

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
export const lerp = (a, b, t) => a + (b - a) * t
export const saturate = (v) => clamp(v, 0, 1)

/** Frame-rate independent exponential smoothing. */
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt))

export function smoothstep(edge0, edge1, x) {
	const t = saturate((x - edge0) / (edge1 - edge0))
	return t * t * (3 - 2 * t)
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a) {
	while (a > Math.PI) a -= TAU
	while (a < -Math.PI) a += TAU
	return a
}

export function angleLerp(a, b, t) {
	return a + wrapAngle(b - a) * t
}

export function angleDamp(a, b, rate, dt) {
	return a + wrapAngle(b - a) * (1 - Math.exp(-rate * dt))
}

export const randRange = (a, b) => a + Math.random() * (b - a)
export const dist2D = (x0, z0, x1, z1) => Math.hypot(x1 - x0, z1 - z0)

export function moveTowards(current, target, maxDelta) {
	const d = target - current
	if (Math.abs(d) <= maxDelta) return target
	return current + Math.sign(d) * maxDelta
}

// ---------------------------------------------------------------------------
// Matrices
// ---------------------------------------------------------------------------

export function mat4() {
	return mat4Identity(new Float32Array(16))
}

export function mat4Identity(m) {
	m.fill(0)
	m[0] = m[5] = m[10] = m[15] = 1
	return m
}

/**
 * Compose translation * rotationY * rotationX * rotationZ * scale.
 * This covers every transform the game needs (props, characters, weapons).
 */
export function mat4Compose(m, x, y, z, yaw = 0, pitch = 0, roll = 0, sx = 1, sy = sx, sz = sx) {
	const cy = Math.cos(yaw)
	const sy_ = Math.sin(yaw)
	const cp = Math.cos(pitch)
	const sp = Math.sin(pitch)
	const cr = Math.cos(roll)
	const sr = Math.sin(roll)

	const r00 = cy * cr + sy_ * sp * sr
	const r01 = -cy * sr + sy_ * sp * cr
	const r02 = sy_ * cp
	const r10 = cp * sr
	const r11 = cp * cr
	const r12 = -sp
	const r20 = -sy_ * cr + cy * sp * sr
	const r21 = sy_ * sr + cy * sp * cr
	const r22 = cy * cp

	m[0] = r00 * sx
	m[1] = r10 * sx
	m[2] = r20 * sx
	m[3] = 0
	m[4] = r01 * sy
	m[5] = r11 * sy
	m[6] = r21 * sy
	m[7] = 0
	m[8] = r02 * sz
	m[9] = r12 * sz
	m[10] = r22 * sz
	m[11] = 0
	m[12] = x
	m[13] = y
	m[14] = z
	m[15] = 1
	return m
}

export function mat4Perspective(m, fovY, aspect, near, far) {
	const f = 1 / Math.tan(fovY / 2)
	m.fill(0)
	m[0] = f / aspect
	m[5] = f
	m[10] = (far + near) / (near - far)
	m[11] = -1
	m[14] = (2 * far * near) / (near - far)
	return m
}

export function mat4Ortho(m, left, right, bottom, top, near, far) {
	m.fill(0)
	m[0] = 2 / (right - left)
	m[5] = 2 / (top - bottom)
	m[10] = -2 / (far - near)
	m[12] = -(right + left) / (right - left)
	m[13] = -(top + bottom) / (top - bottom)
	m[14] = -(far + near) / (far - near)
	m[15] = 1
	return m
}

export function mat4LookAt(m, ex, ey, ez, cx, cy, cz, ux = 0, uy = 1, uz = 0) {
	let zx = ex - cx
	let zy = ey - cy
	let zz = ez - cz
	let len = Math.hypot(zx, zy, zz) || 1
	zx /= len
	zy /= len
	zz /= len
	let xx = uy * zz - uz * zy
	let xy = uz * zx - ux * zz
	let xz = ux * zy - uy * zx
	len = Math.hypot(xx, xy, xz)
	if (len < 1e-6) {
		xx = 1
		xy = 0
		xz = 0
		len = 1
	}
	xx /= len
	xy /= len
	xz /= len
	const yx = zy * xz - zz * xy
	const yy = zz * xx - zx * xz
	const yz = zx * xy - zy * xx
	m[0] = xx
	m[1] = yx
	m[2] = zx
	m[3] = 0
	m[4] = xy
	m[5] = yy
	m[6] = zy
	m[7] = 0
	m[8] = xz
	m[9] = yz
	m[10] = zz
	m[11] = 0
	m[12] = -(xx * ex + xy * ey + xz * ez)
	m[13] = -(yx * ex + yy * ey + yz * ez)
	m[14] = -(zx * ex + zy * ey + zz * ez)
	m[15] = 1
	return m
}

export function mat4Multiply(out, a, b) {
	for (let c = 0; c < 4; c++) {
		const b0 = b[c * 4]
		const b1 = b[c * 4 + 1]
		const b2 = b[c * 4 + 2]
		const b3 = b[c * 4 + 3]
		out[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3
		out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3
		out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3
		out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3
	}
	return out
}

export function mat4Invert(out, m) {
	const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3]
	const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7]
	const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11]
	const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15]
	const b00 = a00 * a11 - a01 * a10
	const b01 = a00 * a12 - a02 * a10
	const b02 = a00 * a13 - a03 * a10
	const b03 = a01 * a12 - a02 * a11
	const b04 = a01 * a13 - a03 * a11
	const b05 = a02 * a13 - a03 * a12
	const b06 = a20 * a31 - a21 * a30
	const b07 = a20 * a32 - a22 * a30
	const b08 = a20 * a33 - a23 * a30
	const b09 = a21 * a32 - a22 * a31
	const b10 = a21 * a33 - a23 * a31
	const b11 = a22 * a33 - a23 * a32
	let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06
	if (!det) return mat4Identity(out)
	det = 1 / det
	out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det
	out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det
	out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det
	out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det
	out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det
	out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det
	out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det
	out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det
	out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det
	out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det
	out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det
	out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det
	out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det
	out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det
	out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det
	out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det
	return out
}
