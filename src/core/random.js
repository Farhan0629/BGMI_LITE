/** Deterministic RNG + value noise, so the island is identical every load. */

export class Rng {
	constructor(seed = 1337) {
		this.state = seed >>> 0 || 1
	}

	/** xorshift32 - fast and good enough for content generation. */
	next() {
		let x = this.state
		x ^= x << 13
		x ^= x >>> 17
		x ^= x << 5
		this.state = x >>> 0
		return this.state / 4294967296
	}

	range(a, b) {
		return a + this.next() * (b - a)
	}

	int(a, b) {
		return Math.floor(this.range(a, b + 1))
	}

	chance(p) {
		return this.next() < p
	}

	pick(list) {
		return list[Math.floor(this.next() * list.length) % list.length]
	}

	/** Weighted pick over entries exposing a numeric `weight`. */
	pickWeighted(entries) {
		let total = 0
		for (const e of entries) total += e.weight
		let r = this.next() * total
		for (const e of entries) {
			r -= e.weight
			if (r <= 0) return e
		}
		return entries[entries.length - 1]
	}

	angle() {
		return this.next() * Math.PI * 2
	}
}

function hash2(x, y) {
	let h = x * 374761393 + y * 668265263
	h = (h ^ (h >> 13)) * 1274126177
	return ((h ^ (h >> 16)) >>> 0) / 4294967296
}

export function valueNoise2D(x, y) {
	const xi = Math.floor(x)
	const yi = Math.floor(y)
	const xf = x - xi
	const yf = y - yi
	const u = xf * xf * (3 - 2 * xf)
	const v = yf * yf * (3 - 2 * yf)
	const a = hash2(xi, yi)
	const b = hash2(xi + 1, yi)
	const c = hash2(xi, yi + 1)
	const d = hash2(xi + 1, yi + 1)
	return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v
}

/** Fractal brownian motion - used for terrain height and material blending. */
export function fbm2D(x, y, octaves = 4, lacunarity = 2, gain = 0.5) {
	let amp = 1
	let freq = 1
	let sum = 0
	let norm = 0
	for (let i = 0; i < octaves; i++) {
		sum += valueNoise2D(x * freq, y * freq) * amp
		norm += amp
		amp *= gain
		freq *= lacunarity
	}
	return sum / norm
}
