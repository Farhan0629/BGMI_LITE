/**
 * Player controller: acceleration based movement with sprint/crouch/jump,
 * swept AABB collision against the world, slope-aware ground detection,
 * fall damage, armour mitigation, healing and the animation state fed to the
 * character rig.
 *
 * The controller is deliberately input-driven (`update(dt, cmd)`), so the
 * multiplayer client can feed the very same command objects it sends to the
 * authoritative server.
 */
import { PLAYER } from "../config/player.js"
import { WEAPONS, HIT_LOCATIONS } from "../config/weapons.js"
import { clamp, damp, lerp } from "../core/math.js"
import { bus } from "../core/events.js"
import { resolveMovement } from "../physics/collision.js"
import { CharacterRig, PALETTES } from "./character.js"

export class Player {
	constructor(world) {
		this.world = world
		this.rig = new CharacterRig(PALETTES.player)
		this.name = "RAVEN-07"
		this.isPlayer = true
		this.pos = { x: 0, y: 0, z: 0 }
		this.vel = { x: 0, y: 0, z: 0 }
		this.yaw = 0
		this.pitch = 0
		this.speed = 0
		this.grounded = true
		this.crouching = false
		this.sprinting = false
		this.aiming = false
		this.dead = false
		this.health = PLAYER.maxHealth
		this.helmetLevel = 0
		this.vestLevel = 0
		this.helmetDurability = 0
		this.vestDurability = 0
		this.hitTimer = 0
		this.landTimer = 0
		this.lastHitDirection = 0
		this.healing = null
		this.healProgress = 0
		this.inVehicle = null
		this.surface = "dirt"
		this.footstepAccumulator = 0
		this.fallSpeed = 0
		this.weaponId = "melee_talon"
		this.hitboxScratch = []
		this.stats = {
			kills: 0, damageDealt: 0, damageTaken: 0, shotsFired: 0, shotsHit: 0,
			lootCollected: 0, survivalTime: 0, headshots: 0,
		}
	}

	get height() {
		return this.crouching ? PLAYER.crouchHeight : PLAYER.height
	}

	eyeY() {
		return this.pos.y + (this.crouching ? PLAYER.crouchEyeHeight : PLAYER.eyeHeight)
	}

	chestY() {
		return this.pos.y + (this.crouching ? 0.85 : 1.25)
	}

	spawn(x, z, yaw = 0) {
		this.pos.x = x
		this.pos.z = z
		this.pos.y = this.world.groundAt(x, z)
		this.vel.x = this.vel.y = this.vel.z = 0
		this.yaw = yaw
		this.pitch = 0
		this.dead = false
		this.health = PLAYER.maxHealth
		this.helmetLevel = 0
		this.vestLevel = 0
		this.helmetDurability = 0
		this.vestDurability = 0
		this.healing = null
		this.hitTimer = 0
		this.crouching = false
		this.sprinting = false
		this.rig.reset()
		for (const k in this.stats) this.stats[k] = 0
	}

	/** Maximum planar speed for the current stance and weapon. */
	maxSpeed(cmd) {
		let base = PLAYER.walkSpeed
		if (this.crouching) base = PLAYER.crouchSpeed
		else if (this.sprinting) base = PLAYER.sprintSpeed
		if (this.aiming && !this.crouching) base *= PLAYER.aimSpeedScale
		if (this.healing) base *= 0.45
		const weapon = WEAPONS[this.weaponId]
		if (weapon) base *= weapon.moveSpeedScale
		if (cmd && cmd.forward < 0) base *= PLAYER.backpedalScale
		else if (cmd && cmd.forward === 0 && cmd.strafe !== 0) base *= PLAYER.strafeScale
		return base
	}

	/**
	 * @param {number} dt fixed timestep
	 * @param {object} cmd command from InputSystem.sample()
	 * @param {object} camera CameraRig (supplies yaw/pitch)
	 */
	update(dt, cmd, camera) {
		this.stats.survivalTime += dt
		this.hitTimer = Math.max(0, this.hitTimer - dt)
		this.landTimer = Math.max(0, this.landTimer - dt)

		if (this.dead) {
			this.vel.x = damp(this.vel.x, 0, 8, dt)
			this.vel.z = damp(this.vel.z, 0, 8, dt)
			this.applyPhysics(dt)
			this.rig.update(dt, this.animState())
			return
		}

		this.yaw = camera.yaw
		this.pitch = camera.pitch
		this.aiming = !!cmd.aim

		// Stance: crouch is blocked while airborne, sprint requires forward input.
		this.crouching = !!cmd.crouch && this.grounded
		this.sprinting = !!cmd.sprint && !this.crouching && !this.aiming && cmd.forward > 0 && !this.healing

		// Desired direction in world space from camera-relative input.
		const cy = Math.cos(this.yaw)
		const sy = Math.sin(this.yaw)
		let wishX = sy * cmd.forward + cy * cmd.strafe
		let wishZ = -cy * cmd.forward - sy * cmd.strafe
		const wishLen = Math.hypot(wishX, wishZ)
		if (wishLen > 0.0001) {
			wishX /= wishLen
			wishZ /= wishLen
		}

		const max = this.maxSpeed(cmd)
		const accel = this.grounded ? PLAYER.accel : PLAYER.airAccel
		if (wishLen > 0.0001) {
			this.vel.x += wishX * max * accel * dt / Math.max(1, max)
			this.vel.z += wishZ * max * accel * dt / Math.max(1, max)
			// Clamp to the stance speed so acceleration never overshoots.
			const planar = Math.hypot(this.vel.x, this.vel.z)
			if (planar > max) {
				const s = max / planar
				this.vel.x *= s
				this.vel.z *= s
			}
		} else if (this.grounded) {
			const f = Math.max(0, 1 - PLAYER.friction * dt)
			this.vel.x *= f
			this.vel.z *= f
			if (Math.abs(this.vel.x) < 0.02) this.vel.x = 0
			if (Math.abs(this.vel.z) < 0.02) this.vel.z = 0
		}

		// Jump cancels healing and crouch.
		if (cmd.jump && this.grounded && !this.crouching) {
			this.vel.y = PLAYER.jumpSpeed
			this.grounded = false
			this.cancelHeal()
			bus.emit("player:jump", { x: this.pos.x, y: this.pos.y, z: this.pos.z, surface: this.surface })
		}

		this.applyPhysics(dt)
		this.updateHealing(dt)
		this.updateFootsteps(dt)
		this.rig.update(dt, this.animState())
	}

	applyPhysics(dt) {
		const wasGrounded = this.grounded
		this.vel.y = Math.max(-PLAYER.maxFallSpeed, this.vel.y - PLAYER.gravity * dt)
		const terrainY = this.world.groundAt(this.pos.x, this.pos.z)
		const result = resolveMovement(
			this.world.collision, this.pos, this.vel,
			PLAYER.radius, this.height, dt, PLAYER.stepHeight, terrainY)
		const landingSpeed = -this.fallSpeed
		this.fallSpeed = this.vel.y
		this.grounded = result.grounded

		// Landing: camera/rig feedback plus fall damage above a safe threshold.
		if (!wasGrounded && this.grounded) {
			this.landTimer = 0.25
			bus.emit("player:land", {
				x: this.pos.x, y: this.pos.y, z: this.pos.z,
				speed: landingSpeed, surface: this.surface,
			})
			if (landingSpeed > PLAYER.safeFallSpeed && !this.dead) {
				const dmg = (landingSpeed - PLAYER.safeFallSpeed) * PLAYER.fallDamagePerSpeed
				this.applyDamage(dmg, { cause: "fall", ignoreArmor: true })
			}
		}

		// Keep the player inside the playable island.
		const clamped = this.world.clamp(this.pos.x, this.pos.z)
		if (clamped.x !== this.pos.x || clamped.z !== this.pos.z) {
			this.pos.x = clamped.x
			this.pos.z = clamped.z
			this.vel.x *= 0.2
			this.vel.z *= 0.2
		}

		this.speed = Math.hypot(this.vel.x, this.vel.z)
		this.surface = this.world.surfaceAt(this.pos.x, this.pos.z)
	}

	// --------------------------------------------------------------- healing

	beginHeal(itemId) {
		const item = PLAYER.healItems[itemId]
		if (!item || this.dead || this.healing) return false
		if (this.health >= item.healthCap) return false
		this.healing = item
		this.healProgress = 0
		return true
	}

	cancelHeal() {
		if (!this.healing) return
		this.healing = null
		this.healProgress = 0
	}

	updateHealing(dt) {
		if (!this.healing) return
		this.healProgress += dt
		if (this.healProgress >= this.healing.useTime) {
			const item = this.healing
			this.health = Math.min(item.healthCap, this.health + item.heal)
			this.healing = null
			this.healProgress = 0
			bus.emit("player:heal", { item: item.id, health: this.health })
		}
	}

	get healFraction() {
		return this.healing ? clamp(this.healProgress / this.healing.useTime, 0, 1) : 0
	}

	// ---------------------------------------------------------------- damage

	/**
	 * @param {number} amount raw damage before armour
	 * @param {object} info {location, from:{x,z}, attacker, cause, ignoreArmor}
	 * @returns {number} damage actually applied
	 */
	applyDamage(amount, info = {}) {
		if (this.dead || amount <= 0) return 0
		const location = info.location || "chest"
		let dmg = amount
		if (!info.ignoreArmor) dmg = this.mitigate(dmg, location)
		this.health -= dmg
		this.stats.damageTaken += dmg
		this.hitTimer = 0.35
		if (info.from) {
			// Relative bearing for the HUD damage-direction indicator.
			const dx = info.from.x - this.pos.x
			const dz = info.from.z - this.pos.z
			this.lastHitDirection = Math.atan2(dx, -dz) - this.yaw
		}
		this.cancelHeal()
		bus.emit("combat:playerDamaged", {
			amount: dmg, location, from: info.from || null,
			attacker: info.attacker || null, health: this.health,
		})
		if (this.health <= 0) {
			this.health = 0
			this.die(info)
		}
		return dmg
	}

	/** Armour absorbs part of the damage and loses durability doing so. */
	mitigate(amount, location) {
		const a = PLAYER.armor
		if (location === "head" && this.helmetLevel > 0 && this.helmetDurability > 0) {
			const absorb = a.helmetAbsorb[this.helmetLevel] || 0
			const absorbed = amount * absorb
			this.helmetDurability -= absorbed
			if (this.helmetDurability <= 0) {
				this.helmetDurability = 0
				this.helmetLevel = 0
				bus.emit("ui:toast", { text: "HELMET DESTROYED" })
			}
			return amount - absorbed
		}
		if (location !== "head" && this.vestLevel > 0 && this.vestDurability > 0) {
			const absorb = a.vestAbsorb[this.vestLevel] || 0
			const absorbed = amount * absorb
			this.vestDurability -= absorbed
			if (this.vestDurability <= 0) {
				this.vestDurability = 0
				this.vestLevel = 0
				bus.emit("ui:toast", { text: "ARMOR DESTROYED" })
			}
			return amount - absorbed
		}
		return amount
	}

	equipHelmet(level) {
		if (level <= this.helmetLevel) return false
		this.helmetLevel = level
		this.helmetDurability = PLAYER.armor.helmetDurability[level] || 0
		return true
	}

	equipVest(level) {
		if (level <= this.vestLevel) return false
		this.vestLevel = level
		this.vestDurability = PLAYER.armor.vestDurability[level] || 0
		return true
	}

	/** Total armour points for the HUD bar. */
	get armorPoints() {
		return Math.round(this.helmetDurability + this.vestDurability)
	}

	get armorMax() {
		const a = PLAYER.armor
		return Math.max(1, (a.helmetDurability[this.helmetLevel] || 0) + (a.vestDurability[this.vestLevel] || 0))
	}

	die(info = {}) {
		if (this.dead) return
		this.dead = true
		this.healing = null
		this.vel.x = 0
		this.vel.z = 0
		bus.emit("combat:kill", {
			victim: this.name, victimIsPlayer: true,
			killer: info.attacker ? info.attacker.name : (info.cause || "THE ZONE"),
			killerIsPlayer: false,
			location: info.location || "chest",
		})
	}

	// ------------------------------------------------------------ rig/render

	animState() {
		return {
			speed: this.speed,
			maxSpeed: PLAYER.sprintSpeed,
			sprinting: this.sprinting,
			crouching: this.crouching,
			grounded: this.grounded,
			aiming: this.aiming,
			reloading: !!this.reloading,
			switching: !!this.switching,
			hitTimer: this.hitTimer,
			landTimer: this.landTimer,
			dead: this.dead,
			yaw: this.yaw,
		}
	}

	draw(scene, firstPerson) {
		// In first person the body is hidden, but the weapon is still drawn so
		// muzzle positions stay consistent between camera modes.
		if (firstPerson) {
			const weapon = WEAPONS[this.weaponId]
			if (weapon) {
				this.rig.drawWeapon(scene, weapon, {
					x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, pitch: this.pitch,
				}, this.yaw, this.pos.y + PLAYER.eyeHeight - 0.1, 1, this.rig.shootKick, this.rig.reloadBlend)
			}
			return
		}
		this.rig.draw(scene, {
			x: this.pos.x, y: this.pos.y, z: this.pos.z,
			yaw: this.yaw, pitch: this.pitch, weaponId: this.weaponId,
		})
	}

	hitboxes() {
		return this.rig.hitboxes(this.pos.x, this.pos.y, this.pos.z, this.yaw, this.hitboxScratch)
	}

	updateFootsteps(dt) {
		if (!this.grounded || this.speed < 0.6) {
			this.footstepAccumulator = 0.34
			return
		}
		this.footstepAccumulator += dt * this.speed
		const stride = this.crouching ? 2.6 : this.sprinting ? 4.4 : 3.4
		if (this.footstepAccumulator >= stride) {
			this.footstepAccumulator = 0
			bus.emit("player:footstep", {
				x: this.pos.x, y: this.pos.y, z: this.pos.z,
				surface: this.surface, loud: this.sprinting, isPlayer: true,
			})
		}
	}

	/** Accuracy used on the end-of-match screen. */
	get accuracy() {
		return this.stats.shotsFired > 0 ? this.stats.shotsHit / this.stats.shotsFired : 0
	}
}

export { HIT_LOCATIONS, lerp }
