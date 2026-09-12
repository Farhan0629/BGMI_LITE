/**
 * Procedural character rig.
 *
 * The body is assembled from instanced primitives (helmet, vest, backpack,
 * gloves, boots, utility belt, holster) and animated procedurally: no external
 * skeletal assets are required, but the rig exposes the same interface a GLTF
 * loader would (`update(dt, state)` + `draw(scene)` + `hitboxes()`), so a real
 * GLB character can be dropped in later without touching gameplay code.
 *
 * Animation states: idle, walk, run, sprint, crouch, jump, fall, land, shoot,
 * reload, switch, hit, death - all blended from a handful of scalar drivers.
 */
import { mat4, mat4Compose, clamp, lerp, damp, saturate } from "../core/math.js"
import { WEAPONS } from "../config/weapons.js"

export const PALETTES = {
	player: {
		cloth: [0.21, 0.23, 0.19], clothDark: [0.14, 0.15, 0.13],
		vest: [0.17, 0.18, 0.16], helmet: [0.19, 0.2, 0.18],
		skin: [0.62, 0.47, 0.36], glove: [0.1, 0.1, 0.1],
		boot: [0.09, 0.09, 0.09], pack: [0.24, 0.22, 0.16],
		accent: [0.45, 0.35, 0.12],
	},
	bot: {
		cloth: [0.24, 0.2, 0.17], clothDark: [0.16, 0.14, 0.12],
		vest: [0.2, 0.16, 0.14], helmet: [0.22, 0.18, 0.15],
		skin: [0.58, 0.44, 0.34], glove: [0.11, 0.1, 0.1],
		boot: [0.08, 0.08, 0.08], pack: [0.2, 0.18, 0.15],
		accent: [0.5, 0.18, 0.14],
	},
}

// Hitbox layout in local space (x right, y up from feet, z forward).
// `mult` is the damage multiplier applied by the combat system.
const HITBOXES = [
	{ type: "head", y: 1.66, rx: 0.16, ry: 0.16, rz: 0.16, mult: 1 },
	{ type: "chest", y: 1.28, rx: 0.26, ry: 0.24, rz: 0.19, mult: 1 },
	{ type: "stomach", y: 0.98, rx: 0.23, ry: 0.2, rz: 0.17, mult: 1 },
	{ type: "arms", y: 1.25, rx: 0.46, ry: 0.2, rz: 0.16, mult: 1 },
	{ type: "legs", y: 0.45, rx: 0.24, ry: 0.45, rz: 0.18, mult: 1 },
]

export class CharacterRig {
	constructor(palette = PALETTES.player) {
		this.palette = palette
		this.m = mat4()
		// Animation drivers.
		this.stridePhase = 0
		this.strideAmount = 0
		this.crouchBlend = 0
		this.airBlend = 0
		this.aimBlend = 0
		this.shootKick = 0
		this.reloadBlend = 0
		this.switchBlend = 0
		this.hitBlend = 0
		this.deathBlend = 0
		this.landBlend = 0
		this.breath = Math.random() * 10
		this.lean = 0
		this.torsoYaw = 0
	}

	/**
	 * @param {number} dt
	 * @param {object} s state: {speed, maxSpeed, sprinting, crouching, grounded,
	 *   aiming, firing, reloading, switching, hitTimer, dead, moveYaw, yaw}
	 */
	update(dt, s) {
		const speed = s.speed || 0
		const norm = clamp(speed / Math.max(0.01, s.maxSpeed || 6), 0, 1.4)
		// Stride frequency scales with speed; sprint adds a longer, heavier cycle.
		const freq = s.sprinting ? 5.4 : 4.2 + norm * 1.6
		this.stridePhase += dt * freq * Math.max(norm, s.grounded ? 0.0 : 0)
		if (this.stridePhase > Math.PI * 2) this.stridePhase -= Math.PI * 2
		this.strideAmount = damp(this.strideAmount, s.grounded ? norm : 0.15, 10, dt)
		this.crouchBlend = damp(this.crouchBlend, s.crouching ? 1 : 0, 12, dt)
		this.airBlend = damp(this.airBlend, s.grounded ? 0 : 1, 9, dt)
		this.aimBlend = damp(this.aimBlend, s.aiming ? 1 : 0, 14, dt)
		this.reloadBlend = damp(this.reloadBlend, s.reloading ? 1 : 0, 11, dt)
		this.switchBlend = damp(this.switchBlend, s.switching ? 1 : 0, 14, dt)
		this.hitBlend = damp(this.hitBlend, s.hitTimer > 0 ? 1 : 0, 9, dt)
		this.deathBlend = damp(this.deathBlend, s.dead ? 1 : 0, 4.5, dt)
		this.landBlend = damp(this.landBlend, s.landTimer > 0 ? 1 : 0, 12, dt)
		this.shootKick = Math.max(0, this.shootKick - dt * 7)
		this.breath += dt
		// Upper body twists toward the aim direction relative to movement.
		this.torsoYaw = damp(this.torsoYaw, 0, 8, dt)
		this.lean = damp(this.lean, s.sprinting ? 0.16 : norm * 0.06, 7, dt)
	}

	/** Called by the weapon system on each shot. */
	notifyShot(strength = 1) {
		this.shootKick = Math.min(1.2, this.shootKick + 0.5 * strength)
	}

	/** Feet-position height offset caused by crouch/death, used by the camera. */
	get stanceOffset() {
		return -0.42 * this.crouchBlend - 0.55 * this.deathBlend
	}

	part(scene, geom, x, y, z, sx, sy, sz, yaw, pitch, roll, color, rough = 0.8, ao = 1) {
		mat4Compose(this.m, x, y, z, yaw, pitch, roll, sx, sy, sz)
		scene.addDynamic(geom, this.m, color[0], color[1], color[2], rough, 0, 0, ao)
	}

	/**
	 * Emit the character into the scene's dynamic instance list.
	 * @param {object} scene
	 * @param {object} s {x, y, z, yaw, pitch, weaponId}
	 */
	draw(scene, s) {
		const p = this.palette
		const yaw = s.yaw
		const cy = Math.cos(yaw), sy = Math.sin(yaw)
		const crouch = this.crouchBlend
		const death = this.deathBlend
		const stride = Math.sin(this.stridePhase) * this.strideAmount
		const strideAlt = Math.sin(this.stridePhase + Math.PI) * this.strideAmount
		const bob = Math.abs(Math.cos(this.stridePhase)) * this.strideAmount * 0.06
		const breathe = Math.sin(this.breath * 1.6) * 0.012
		const hipY = s.y + 0.92 - crouch * 0.34 - this.airBlend * 0.05 - this.landBlend * 0.12 + bob + breathe - death * 0.74
		const pitchLean = this.lean + death * 1.35

		// Helper converting local offsets (right, up, forward) to world space.
		const wx = (rx, fz) => s.x + rx * cy + fz * sy
		const wz = (rx, fz) => s.z - rx * sy + fz * cy

		// ---- legs
		const legSwing = this.airBlend > 0.4 ? 0.5 : stride * 0.62
		const legSwingB = this.airBlend > 0.4 ? -0.3 : strideAlt * 0.62
		for (const [side, swing] of [[-1, legSwing], [1, legSwingB]]) {
			const hx = 0.13 * side
			const thighY = hipY - 0.26
			this.part(scene, "box", wx(hx, swing * 0.18), thighY, wz(hx, swing * 0.18),
				0.19, 0.52, 0.21, yaw, swing * 0.5 - crouch * 0.5, 0, p.cloth, 0.85, 0.9)
			const shinY = thighY - 0.44
			const shinF = swing * 0.3 - crouch * 0.1
			this.part(scene, "box", wx(hx, shinF), shinY, wz(hx, shinF),
				0.17, 0.46, 0.19, yaw, -Math.abs(swing) * 0.45 + crouch * 0.85, 0, p.clothDark, 0.85, 0.85)
			// Boot
			this.part(scene, "box", wx(hx, shinF + 0.08), shinY - 0.27, wz(hx, shinF + 0.08),
				0.18, 0.16, 0.3, yaw, 0, 0, p.boot, 0.7, 0.8)
		}

		// ---- pelvis / utility belt
		this.part(scene, "box", s.x, hipY, s.z, 0.36, 0.2, 0.26, yaw, 0, 0, p.clothDark, 0.85, 0.9)
		this.part(scene, "box", s.x, hipY + 0.06, s.z, 0.4, 0.09, 0.3, yaw, 0, 0, p.accent, 0.7, 0.95)
		// Holster on the right thigh
		this.part(scene, "box", wx(0.22, 0.02), hipY - 0.22, wz(0.22, 0.02), 0.1, 0.22, 0.14, yaw, 0, 0, p.clothDark, 0.7)

		// ---- torso (leans with movement, twists with aim)
		const torsoY = hipY + 0.36
		const torsoYaw = yaw + this.torsoYaw
		this.part(scene, "box", wx(0, 0.02), torsoY, wz(0, 0.02), 0.42, 0.56, 0.27, torsoYaw, pitchLean * 0.5, 0, p.cloth, 0.86, 0.95)
		// Tactical vest with front plates and pouches
		this.part(scene, "box", wx(0, 0.05), torsoY + 0.02, wz(0, 0.05), 0.44, 0.44, 0.3, torsoYaw, pitchLean * 0.5, 0, p.vest, 0.75, 0.95)
		for (const ox of [-0.13, 0.13]) {
			this.part(scene, "box", wx(ox, 0.18), torsoY - 0.06, wz(ox, 0.18), 0.11, 0.14, 0.08, torsoYaw, 0, 0, p.clothDark, 0.8)
		}
		// Backpack
		this.part(scene, "box", wx(0, -0.24), torsoY + 0.04, wz(0, -0.24), 0.34, 0.46, 0.22, torsoYaw, pitchLean * 0.5, 0, p.pack, 0.9, 0.85)
		this.part(scene, "box", wx(0, -0.3), torsoY - 0.16, wz(0, -0.3), 0.26, 0.14, 0.16, torsoYaw, 0, 0, p.clothDark, 0.9, 0.8)

		// ---- head, helmet, neck
		const headY = torsoY + 0.46
		const headPitch = clamp(s.pitch * 0.55, -0.5, 0.5) + death * 0.4
		this.part(scene, "box", wx(0, 0.01), headY - 0.14, wz(0, 0.01), 0.14, 0.12, 0.14, yaw, 0, 0, p.skin, 0.7)
		this.part(scene, "box", wx(0, 0.02), headY, wz(0, 0.02), 0.21, 0.24, 0.23, yaw, headPitch, 0, p.skin, 0.65)
		this.part(scene, "sphereLow", wx(0, 0.01), headY + 0.09, wz(0, 0.01), 0.28, 0.26, 0.3, yaw, headPitch, 0, p.helmet, 0.55, 0.95)
		// Helmet rail + NVG mount detail
		this.part(scene, "box", wx(0, 0.13), headY + 0.1, wz(0, 0.13), 0.08, 0.06, 0.1, yaw, headPitch, 0, p.clothDark, 0.5)

		// ---- arms hold the weapon; reload dips the support hand
		const weapon = WEAPONS[s.weaponId] || null
		const aim = this.aimBlend
		const reload = this.reloadBlend
		const kick = this.shootKick
		const armPitch = -0.55 - aim * 0.35 + kick * 0.22 + this.switchBlend * 0.7
		const shoulderY = torsoY + 0.22

		// Right (trigger) arm
		const rArmSide = 0.3
		this.part(scene, "box", wx(rArmSide, 0.04), shoulderY - 0.02, wz(rArmSide, 0.04), 0.15, 0.34, 0.16,
			yaw, armPitch * 0.6 - stride * 0.25 * (1 - aim), 0, p.cloth, 0.85, 0.9)
		const rHandF = 0.34 + aim * 0.06 - kick * 0.05
		this.part(scene, "box", wx(rArmSide - 0.05, rHandF * 0.55), shoulderY - 0.28, wz(rArmSide - 0.05, rHandF * 0.55),
			0.13, 0.3, 0.15, yaw, armPitch, 0, p.cloth, 0.85, 0.9)
		this.part(scene, "box", wx(rArmSide - 0.11, rHandF), shoulderY - 0.36, wz(rArmSide - 0.11, rHandF),
			0.11, 0.11, 0.13, yaw, 0, 0, p.glove, 0.7)

		// Left (support) arm - drops to the magazine while reloading
		const lArmSide = -0.28 + aim * 0.06
		const lReach = 0.46 + aim * 0.1 - reload * 0.24
		const lDrop = -0.3 - reload * 0.18
		this.part(scene, "box", wx(lArmSide, 0.06), shoulderY - 0.02, wz(lArmSide, 0.06), 0.15, 0.34, 0.16,
			yaw, armPitch * 0.5 + stride * 0.25 * (1 - aim), 0, p.cloth, 0.85, 0.9)
		this.part(scene, "box", wx(lArmSide + 0.06, lReach * 0.6), shoulderY + lDrop * 0.8, wz(lArmSide + 0.06, lReach * 0.6),
			0.13, 0.3, 0.15, yaw, armPitch - reload * 0.5, 0, p.cloth, 0.85, 0.9)
		this.part(scene, "box", wx(lArmSide + 0.1, lReach), shoulderY + lDrop - 0.06, wz(lArmSide + 0.1, lReach),
			0.11, 0.11, 0.13, yaw, 0, 0, p.glove, 0.7)

		// ---- weapon in hand
		if (weapon) {
			const muzzle = this.drawWeapon(scene, weapon, s, yaw, shoulderY, aim, kick, reload)
			this.muzzleX = muzzle.x
			this.muzzleY = muzzle.y
			this.muzzleZ = muzzle.z
		}
	}

	/**
	 * Draw the held weapon. Returns the world-space muzzle position so the
	 * weapon system can spawn flashes, smoke and tracers from the right spot.
	 */
	drawWeapon(scene, weapon, s, yaw, shoulderY, aim, kick, reload) {
		const cy = Math.cos(yaw), sy = Math.sin(yaw)
		const pitch = clamp(s.pitch, -1.1, 1.1)
		const baseRight = 0.14 - aim * 0.13
		const baseUp = shoulderY - 0.3 + aim * 0.14
		const baseFwd = 0.42 - kick * 0.08 - reload * 0.1
		const body = weapon.model || {}
		const len = body.length || 0.9
		const col = body.color || [0.17, 0.17, 0.18]
		const wood = [0.22, 0.16, 0.11]

		// Weapon axis follows the aim pitch.
		const fx = sy * Math.cos(pitch)
		const fz = cy * Math.cos(pitch)
		const fy = Math.sin(pitch)
		const ox = s.x + baseRight * cy + baseFwd * sy
		const oz = s.z - baseRight * sy + baseFwd * cy
		const oy = baseUp

		const at = (d, out) => {
			out.x = ox + fx * d
			out.y = oy + fy * d
			out.z = oz + fz * d
			return out
		}
		const tmp = { x: 0, y: 0, z: 0 }

		// Receiver
		at(len * 0.12, tmp)
		this.part(scene, "box", tmp.x, tmp.y, tmp.z, 0.085, 0.14, len * 0.55, yaw, pitch, 0, col, 0.45, 0.95)
		// Barrel
		at(len * 0.62, tmp)
		this.part(scene, "box", tmp.x, tmp.y, tmp.z, 0.05, 0.05, len * 0.5, yaw, pitch, 0, col, 0.35, 0.95)
		// Handguard
		at(len * 0.38, tmp)
		this.part(scene, "box", tmp.x, tmp.y, tmp.z, 0.07, 0.08, len * 0.3, yaw, pitch, 0,
			body.wood ? wood : [0.13, 0.13, 0.14], 0.6, 0.95)
		// Magazine
		at(len * 0.1, tmp)
		this.part(scene, "box", tmp.x, tmp.y - 0.14 + reload * 0.1, tmp.z, 0.06, 0.2, 0.1, yaw, pitch, 0, col, 0.5, 0.9)
		// Stock
		at(-len * 0.28, tmp)
		this.part(scene, "box", tmp.x, tmp.y - 0.02, tmp.z, 0.07, 0.13, len * 0.32, yaw, pitch, 0,
			body.wood ? wood : col, 0.6, 0.95)
		// Grip
		at(-len * 0.02, tmp)
		this.part(scene, "box", tmp.x, tmp.y - 0.13, tmp.z, 0.06, 0.17, 0.09, yaw, pitch + 0.35, 0, col, 0.55, 0.9)
		// Optic / scope
		if (body.scope) {
			at(len * 0.3, tmp)
			this.part(scene, "cylLow", tmp.x, tmp.y + 0.13, tmp.z, 0.075, 0.34, 0.075, yaw, pitch + Math.PI / 2, 0, [0.1, 0.1, 0.11], 0.3, 0.95)
		} else {
			at(len * 0.24, tmp)
			this.part(scene, "box", tmp.x, tmp.y + 0.1, tmp.z, 0.05, 0.06, 0.1, yaw, pitch, 0, [0.1, 0.1, 0.11], 0.4, 0.95)
		}
		// Suppressor / muzzle device
		if (body.muzzle) {
			at(len * 0.86, tmp)
			this.part(scene, "cylLow", tmp.x, tmp.y, tmp.z, 0.07, 0.18, 0.07, yaw, pitch + Math.PI / 2, 0, [0.12, 0.12, 0.13], 0.4, 0.95)
		}
		return at(len * (body.muzzle ? 0.98 : 0.9), { x: 0, y: 0, z: 0 })
	}

	/**
	 * World-space hitboxes for the combat raycaster.
	 * @returns {Array<{type:string,x:number,y:number,z:number,rx:number,ry:number,rz:number}>}
	 */
	hitboxes(x, y, z, yaw, out = []) {
		out.length = 0
		const crouch = this.crouchBlend
		const death = this.deathBlend
		const cy = Math.cos(yaw), sy = Math.sin(yaw)
		for (let i = 0; i < HITBOXES.length; i++) {
			const h = HITBOXES[i]
			// Crouching compresses the stack; death flattens it near the ground.
			const hy = y + h.y * (1 - crouch * 0.28) * (1 - death * 0.62) + (death > 0.5 ? 0.1 : 0)
			const spreadZ = death > 0.5 ? h.rz + death * 0.5 : h.rz
			out.push({
				type: h.type,
				x: x, y: hy, z: z,
				rx: h.rx * (cy * cy) + spreadZ * (sy * sy) + 0.02,
				ry: h.ry * (1 - death * 0.5),
				rz: spreadZ * (cy * cy) + h.rx * (sy * sy) + 0.02,
			})
		}
		return out
	}

	/** Approximate eye/aim origin, used for AI line of sight and FPS camera. */
	eyeHeight() {
		return 1.62 - this.crouchBlend * 0.45
	}

	chestHeight() {
		return saturate(1) * (1.28 - this.crouchBlend * 0.36)
	}

	reset() {
		this.deathBlend = 0
		this.hitBlend = 0
		this.crouchBlend = 0
		this.airBlend = 0
		this.shootKick = 0
		this.reloadBlend = 0
		this.stridePhase = 0
		this.strideAmount = 0
	}
}

/** Linear helper re-exported for systems that blend character-driven values. */
export { lerp }
