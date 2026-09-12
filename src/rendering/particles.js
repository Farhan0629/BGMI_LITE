/**
 * Pooled particle system.
 *
 * Particles live in a fixed size ring buffer and are written each frame into
 * two interleaved typed arrays: one additive pass (muzzle flashes, sparks,
 * tracers, fire) and one alpha pass (smoke, dust, blood, rain). Nothing is
 * allocated after construction.
 */
const SURFACE_COLORS = {
	flesh: [0.55, 0.08, 0.08],
	metal: [1, 0.82, 0.45],
	concrete: [0.6, 0.58, 0.55],
	wood: [0.42, 0.3, 0.18],
	dirt: [0.4, 0.33, 0.24],
	glass: [0.75, 0.85, 0.9],
	water: [0.6, 0.75, 0.85],
	grass: [0.3, 0.4, 0.2],
}

export class ParticleSystem {
	constructor(capacity = 2200) {
		this.capacity = capacity
		this.pool = []
		for (let i = 0; i < capacity; i++) {
			this.pool.push({
				active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
				life: 0, maxLife: 1, size: 1, sizeGrow: 0,
				r: 1, g: 1, b: 1, alpha: 1, drag: 0, gravity: 0, additive: false,
			})
		}
		this.cursor = 0
		// 8 floats per particle: x, y, z, size, r, g, b, alpha
		this.additiveData = new Float32Array(capacity * 8)
		this.alphaData = new Float32Array(capacity * 8)
		this.additiveCount = 0
		this.alphaCount = 0
		this.budget = capacity
	}

	setBudget(max) {
		this.budget = Math.max(64, Math.min(this.capacity, max | 0))
	}

	acquire() {
		const p = this.pool[this.cursor]
		this.cursor = (this.cursor + 1) % this.budget
		return p
	}

	spawn(kind, x, y, z, vx, vy, vz, color, size, life) {
		const p = this.acquire()
		p.active = true
		p.x = x; p.y = y; p.z = z
		p.vx = vx; p.vy = vy; p.vz = vz
		p.life = life; p.maxLife = life
		p.size = size
		p.r = color[0]; p.g = color[1]; p.b = color[2]
		p.alpha = 1
		switch (kind) {
			case "spark": p.gravity = 9; p.drag = 1.5; p.sizeGrow = -size * 0.6; p.additive = true; break
			case "flash": p.gravity = 0; p.drag = 6; p.sizeGrow = size * 2; p.additive = true; break
			case "tracer": p.gravity = 0; p.drag = 0.2; p.sizeGrow = -size * 0.3; p.additive = true; break
			case "fire": p.gravity = -2.5; p.drag = 1.4; p.sizeGrow = -size * 0.4; p.additive = true; break
			case "smoke": p.gravity = -0.6; p.drag = 1.2; p.sizeGrow = size * 1.4; p.additive = false; break
			case "dust": p.gravity = 0.4; p.drag = 2; p.sizeGrow = size * 0.8; p.additive = false; break
			case "blood": p.gravity = 12; p.drag = 1; p.sizeGrow = -size * 0.2; p.additive = false; break
			case "debris": p.gravity = 16; p.drag = 0.6; p.sizeGrow = 0; p.additive = false; break
			case "rain": p.gravity = 26; p.drag = 0; p.sizeGrow = 0; p.additive = false; break
			default: p.gravity = 0; p.drag = 1; p.sizeGrow = 0; p.additive = false
		}
	}

	muzzleFlash(x, y, z, dx, dy, dz, scale = 1) {
		this.spawn("flash", x, y, z, dx * 2, dy * 2, dz * 2, [1, 0.78, 0.35], 0.5 * scale, 0.055)
		for (let i = 0; i < 4; i++) {
			this.spawn("spark", x, y, z,
				dx * 9 + (Math.random() - 0.5) * 4,
				dy * 9 + (Math.random() - 0.5) * 4,
				dz * 9 + (Math.random() - 0.5) * 4,
				[1, 0.7, 0.3], 0.07 * scale, 0.12 + Math.random() * 0.1)
		}
		this.spawn("smoke", x + dx * 0.4, y + dy * 0.4, z + dz * 0.4, dx, dy + 0.4, dz,
			[0.32, 0.31, 0.3], 0.26 * scale, 0.5)
	}

	shellEject(x, y, z, rx, rz) {
		this.spawn("debris", x, y, z, rx * 2 + Math.random(), 2.4, rz * 2 + Math.random(), [0.75, 0.62, 0.25], 0.055, 1.1)
	}

	impact(x, y, z, nx, ny, nz, surface) {
		const color = SURFACE_COLORS[surface] || SURFACE_COLORS.concrete
		const sparks = surface === "metal" ? 7 : surface === "flesh" ? 0 : 3
		for (let i = 0; i < sparks; i++) {
			this.spawn("spark", x, y, z,
				nx * 3 + (Math.random() - 0.5) * 5,
				ny * 3 + Math.random() * 3,
				nz * 3 + (Math.random() - 0.5) * 5,
				surface === "metal" ? [1, 0.8, 0.4] : color, 0.05, 0.25)
		}
		if (surface === "flesh") {
			for (let i = 0; i < 7; i++) {
				this.spawn("blood", x, y, z,
					nx * 2 + (Math.random() - 0.5) * 3, 1 + Math.random() * 2,
					nz * 2 + (Math.random() - 0.5) * 3, color, 0.1, 0.5)
			}
		} else {
			for (let i = 0; i < 4; i++) {
				this.spawn("dust", x, y, z,
					nx * 1.4 + (Math.random() - 0.5) * 1.6, ny * 1.4 + Math.random(),
					nz * 1.4 + (Math.random() - 0.5) * 1.6, color, 0.2, 0.6)
			}
		}
	}

	explosion(x, y, z, scale = 1) {
		for (let i = 0; i < 26; i++) {
			const a = Math.random() * Math.PI * 2
			const e = Math.random() * Math.PI
			const s = 6 + Math.random() * 14
			this.spawn("spark", x, y, z,
				Math.cos(a) * Math.sin(e) * s, Math.cos(e) * s + 3, Math.sin(a) * Math.sin(e) * s,
				[1, 0.6 + Math.random() * 0.3, 0.2], 0.2 * scale, 0.5 + Math.random() * 0.4)
		}
		this.spawn("flash", x, y, z, 0, 0, 0, [1, 0.85, 0.5], 3.2 * scale, 0.12)
		for (let i = 0; i < 14; i++) {
			this.spawn("smoke",
				x + (Math.random() - 0.5) * 2, y + Math.random() * 2, z + (Math.random() - 0.5) * 2,
				(Math.random() - 0.5) * 2.5, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 2.5,
				[0.22, 0.21, 0.2], 1.3 * scale, 2 + Math.random())
		}
	}

	fire(x, y, z, scale = 1) {
		this.spawn("fire", x, y, z, (Math.random() - 0.5) * 0.5, 1.6 + Math.random(), (Math.random() - 0.5) * 0.5,
			[1, 0.55 + Math.random() * 0.25, 0.18], 0.34 * scale, 0.5 + Math.random() * 0.3)
		if (Math.random() < 0.4) {
			this.spawn("smoke", x, y + 0.6, z, (Math.random() - 0.5) * 0.6, 1.4, (Math.random() - 0.5) * 0.6,
				[0.2, 0.19, 0.18], 0.7 * scale, 1.6)
		}
	}

	dust(x, y, z, amount = 4, color = [0.45, 0.4, 0.33]) {
		for (let i = 0; i < amount; i++) {
			this.spawn("dust", x, y, z, (Math.random() - 0.5) * 1.6, Math.random() * 1.2,
				(Math.random() - 0.5) * 1.6, color, 0.28, 0.8)
		}
	}

	tracer(x, y, z, dx, dy, dz, length) {
		const steps = Math.min(8, Math.max(2, Math.round(length / 12)))
		for (let i = 1; i <= steps; i++) {
			const t = (i / steps) * Math.min(length, 90)
			this.spawn("tracer", x + dx * t, y + dy * t, z + dz * t, 0, 0, 0, [1, 0.85, 0.55], 0.065, 0.06)
		}
	}

	rainBurst(cx, cy, cz, amount) {
		for (let i = 0; i < amount; i++) {
			this.spawn("rain",
				cx + (Math.random() - 0.5) * 44, cy + 14 + Math.random() * 7, cz + (Math.random() - 0.5) * 44,
				0.6, -14, 0.3, [0.55, 0.62, 0.7], 0.03, 1.2)
		}
	}

	update(dt) {
		this.additiveCount = 0
		this.alphaCount = 0
		for (let i = 0; i < this.pool.length; i++) {
			const p = this.pool[i]
			if (!p.active) continue
			p.life -= dt
			if (p.life <= 0) {
				p.active = false
				continue
			}
			const drag = 1 - Math.min(1, p.drag * dt)
			p.vx *= drag
			p.vz *= drag
			p.vy = p.vy * drag - p.gravity * dt
			p.x += p.vx * dt
			p.y += p.vy * dt
			p.z += p.vz * dt
			p.size = Math.max(0.01, p.size + p.sizeGrow * dt)
			const t = p.life / p.maxLife
			p.alpha = t * t
			const target = p.additive ? this.additiveData : this.alphaData
			const o = (p.additive ? this.additiveCount++ : this.alphaCount++) * 8
			if (o + 8 > target.length) continue
			target[o] = p.x
			target[o + 1] = p.y
			target[o + 2] = p.z
			target[o + 3] = p.size
			target[o + 4] = p.r
			target[o + 5] = p.g
			target[o + 6] = p.b
			target[o + 7] = p.alpha
		}
	}

	activeCount() {
		return this.additiveCount + this.alphaCount
	}

	reset() {
		for (const p of this.pool) p.active = false
		this.additiveCount = 0
		this.alphaCount = 0
	}
}
