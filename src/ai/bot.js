/**
 * Enemy bot: perception, a twelve state finite state machine and the same
 * movement/collision/weapon code paths the player uses.
 *
 * Perception is deliberately imperfect: bots only see inside a view cone with
 * clear line of sight, they hear gunshots (loudness scaled by distance) and
 * footsteps, and they remember a "last known position" they will investigate
 * and search around. Difficulty changes reaction time, cover usage, flanking
 * and retreat thresholds far more than raw accuracy.
 */
import { BOTS, BOT_PROFILES, BOT_STATE } from "../config/bots.js"
import { PLAYER } from "../config/player.js"
import { WEAPONS } from "../config/weapons.js"
import { clamp, damp, wrapAngle, angleDamp } from "../core/math.js"
import { bus } from "../core/events.js"
import { resolveMovement } from "../physics/collision.js"
import { CharacterRig, PALETTES } from "../player/character.js"
import { WeaponController } from "../weapons/weaponController.js"

const S = BOT_STATE

export class Bot {
	constructor(index, world, combat, rng, difficulty = "normal") {
		this.index = index
		this.world = world
		this.combat = combat
		this.rng = rng
		this.name = "BOT-" + String(index + 1).padStart(2, "0")
		this.isPlayer = false
		this.profile = BOT_PROFILES[difficulty] || BOT_PROFILES.normal
		this.difficulty = difficulty
		this.rig = new CharacterRig(PALETTES.bot)
		this.weapons = new WeaponController(this, combat)

		this.pos = { x: 0, y: 0, z: 0 }
		this.vel = { x: 0, y: 0, z: 0 }
		this.yaw = 0
		this.pitch = 0
		this.aimYaw = 0
		this.aimPitch = 0
		this.speed = 0
		this.grounded = true
		this.dead = false
		this.crouching = false
		this.sprinting = false
		this.aiming = false
		this.health = BOTS.maxHealth
		this.helmetLevel = 0
		this.vestLevel = 0
		this.hitTimer = 0
		this.landTimer = 0
		this.deadTime = 0
		this.surface = "dirt"

		this.state = S.IDLE
		this.stateTime = 0
		this.thinkTimer = 0
		this.target = null
		this.targetVisible = false
		this.visibleTime = 0
		this.reactionTimer = 0
		this.lastKnown = { x: 0, z: 0, valid: false, age: 0 }
		this.destination = { x: 0, z: 0, valid: false }
		this.coverPoint = null
		this.burstRemaining = 0
		this.burstPause = 0
		this.healCharges = 1
		this.healTimer = 0
		this.patrolAnchor = { x: 0, z: 0 }
		this.stuckTimer = 0
		this.lastPos = { x: 0, z: 0 }
		this.coverScratch = []
		this.hitboxScratch = []
		this.fireState = {
			fire: false, firePressed: false, aiming: false,
			moveSpeed: 0, crouching: false,
			origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 0 },
		}
		this.stats = { kills: 0, damageDealt: 0, damageTaken: 0, shotsFired: 0, shotsHit: 0, headshots: 0 }
	}

	// ----------------------------------------------------------------- setup

	spawn(x, z, loadout) {
		this.pos.x = x
		this.pos.z = z
		this.pos.y = this.world.groundAt(x, z)
		this.vel.x = this.vel.y = this.vel.z = 0
		this.patrolAnchor.x = x
		this.patrolAnchor.z = z
		this.yaw = this.rng.angle()
		this.aimYaw = this.yaw
		this.dead = false
		this.deadTime = 0
		this.health = BOTS.maxHealth
		this.state = S.PATROL
		this.stateTime = 0
		this.target = null
		this.lastKnown.valid = false
		this.destination.valid = false
		this.healCharges = this.rng.int(0, 2)
		this.rig.reset()
		this.weapons.reset()

		// Loadout: a primary, sometimes a sidearm, plus reserve ammo.
		const primary = loadout || this.rng.pick(["ar_vanguard", "smg_hornet", "shotgun_breaker", "sniper_longbow"])
		this.weapons.equip(primary, true)
		this.weapons.mags[primary] = WEAPONS[primary].magazine
		this.weapons.addAmmo(WEAPONS[primary].ammo, 120)
		if (this.rng.chance(0.5)) {
			this.weapons.equip("pistol_sidewinder", false)
			this.weapons.addAmmo("pistol", 45)
		}
		if (this.rng.chance(BOTS.armorChance)) {
			this.vestLevel = this.rng.int(1, 2)
			this.helmetLevel = this.rng.int(0, 2)
		}
	}

	eyeY() {
		return this.pos.y + (this.crouching ? 1.05 : BOTS.eyeHeight)
	}

	hitboxes() {
		return this.rig.hitboxes(this.pos.x, this.pos.y, this.pos.z, this.yaw, this.hitboxScratch)
	}

	// ---------------------------------------------------------------- damage

	applyDamage(amount, info = {}) {
		if (this.dead || amount <= 0) return 0
		const location = info.location || "chest"
		let dmg = amount
		// Simple armour model mirroring the player's.
		if (!info.ignoreArmor) {
			const a = PLAYER.armor
			if (location === "head" && this.helmetLevel > 0) dmg *= 1 - (a.helmetAbsorb[this.helmetLevel] || 0)
			else if (location !== "head" && this.vestLevel > 0) dmg *= 1 - (a.vestAbsorb[this.vestLevel] || 0)
		}
		this.health -= dmg
		this.stats.damageTaken += dmg
		this.hitTimer = 0.3

		// Being shot reveals the attacker's rough position.
		if (info.attacker && info.attacker !== this) {
			this.target = info.attacker
			this.rememberPosition(info.attacker.pos.x, info.attacker.pos.z)
			if (this.state !== S.COMBAT && this.state !== S.TAKE_COVER) {
				this.setState(this.rng.chance(this.profile.coverBias) ? S.TAKE_COVER : S.COMBAT)
			}
		}
		if (this.health <= 0) {
			this.health = 0
			this.die(info)
		}
		return dmg
	}

	die(info = {}) {
		if (this.dead) return
		this.dead = true
		this.setState(S.DEAD)
		this.vel.x = 0
		this.vel.z = 0
		const killer = info.attacker
		bus.emit("combat:kill", {
			victim: this.name,
			victimIsPlayer: false,
			killer: killer ? (killer.isPlayer ? "YOU" : killer.name) : (info.cause || "THE ZONE"),
			killerIsPlayer: !!(killer && killer.isPlayer),
			location: info.location || "chest",
			x: this.pos.x, y: this.pos.y, z: this.pos.z,
			bot: this,
		})
	}

	// ------------------------------------------------------------ perception

	rememberPosition(x, z) {
		this.lastKnown.x = x
		this.lastKnown.z = z
		this.lastKnown.valid = true
		this.lastKnown.age = 0
	}

	/** Called by the bot manager when a noise is made anywhere on the map. */
	hearNoise(x, z, loudness) {
		if (this.dead) return
		const dist = Math.hypot(x - this.pos.x, z - this.pos.z)
		const range = this.profile.hearingRange * clamp(loudness / 100, 0.15, 1.6)
		if (dist > range) return
		// Direction estimate degrades with distance, so bots investigate an area
		// rather than snapping to the exact source.
		const error = (dist / Math.max(1, range)) * 18
		this.rememberPosition(x + this.rng.range(-error, error), z + this.rng.range(-error, error))
		if (this.state === S.IDLE || this.state === S.PATROL || this.state === S.LOOT) {
			this.setState(S.INVESTIGATE)
		}
	}

	canSee(entity) {
		if (!entity || entity.dead) return false
		const dx = entity.pos.x - this.pos.x
		const dz = entity.pos.z - this.pos.z
		const dist = Math.hypot(dx, dz)
		if (dist > this.profile.viewDistance) return false
		// View cone test.
		const angle = Math.abs(wrapAngle(Math.atan2(dx, -dz) - this.yaw))
		if (angle > this.profile.fov) return false
		// Crouching in vegetation is harder to spot at range.
		if (entity.crouching && dist > this.profile.viewDistance * 0.55) return false
		const ey = entity.pos.y + (entity.crouching ? 0.9 : 1.3)
		return this.world.collision.lineOfSight(this.pos.x, this.eyeY(), this.pos.z, entity.pos.x, ey, entity.pos.z)
	}

	// ------------------------------------------------------------------ FSM

	setState(state) {
		if (this.state === state) return
		this.state = state
		this.stateTime = 0
		if (state === S.TAKE_COVER) this.coverPoint = null
	}

	/**
	 * @param {number} dt
	 * @param {object[]} candidates potential enemies (player + other bots)
	 * @param {number} distanceToPlayer used for simulation LOD
	 */
	update(dt, candidates, distanceToPlayer) {
		this.hitTimer = Math.max(0, this.hitTimer - dt)
		this.stateTime += dt
		if (this.lastKnown.valid) this.lastKnown.age += dt

		if (this.dead) {
			this.deadTime += dt
			this.vel.x = damp(this.vel.x, 0, 6, dt)
			this.vel.z = damp(this.vel.z, 0, 6, dt)
			this.physics(dt)
			this.rig.update(dt, this.animState())
			return
		}

		// Simulation LOD: distant bots re-plan less often (they still move).
		const interval = distanceToPlayer < BOTS.nearThinkDistance
			? BOTS.thinkIntervalNear : BOTS.thinkIntervalFar
		this.thinkTimer -= dt
		if (this.thinkTimer <= 0) {
			this.thinkTimer = interval
			this.think(candidates)
		}

		this.act(dt)
		this.physics(dt)
		this.updateWeapon(dt)
		this.rig.update(dt, this.animState())
		this.updateFootsteps(dt)
	}

	/** Target selection, perception refresh and state transitions. */
	think(candidates) {
		// Refresh or acquire a target.
		let best = null
		let bestDist = Infinity
		for (let i = 0; i < candidates.length; i++) {
			const c = candidates[i]
			if (!c || c === this || c.dead) continue
			const d = Math.hypot(c.pos.x - this.pos.x, c.pos.z - this.pos.z)
			if (d > this.profile.viewDistance) continue
			if (!this.canSee(c)) continue
			// Prefer the human player slightly so fights converge on them.
			const score = d * (c.isPlayer ? 0.8 : 1)
			if (score < bestDist) {
				bestDist = score
				best = c
			}
		}

		if (best) {
			if (this.target !== best) this.reactionTimer = this.profile.reactionTime
			this.target = best
			this.targetVisible = true
			this.rememberPosition(best.pos.x, best.pos.z)
		} else {
			this.targetVisible = this.target ? this.canSee(this.target) : false
			if (this.targetVisible && this.target) this.rememberPosition(this.target.pos.x, this.target.pos.z)
		}

		const healthFrac = this.health / BOTS.maxHealth
		const w = this.weapons.weapon
		const needsReload = this.weapons.magazine <= 0 && this.weapons.reserve > 0

		// Priority ladder.
		if (healthFrac < this.profile.retreatHealth && this.healCharges > 0 && !this.targetVisible) {
			this.setState(S.HEAL)
			return
		}
		if (healthFrac < this.profile.retreatHealth && this.targetVisible) {
			this.setState(S.RETREAT)
			return
		}
		if (needsReload) {
			this.weapons.startReload()
			if (this.targetVisible && this.rng.chance(this.profile.coverBias)) this.setState(S.TAKE_COVER)
			else this.setState(S.RELOAD)
			return
		}
		if (this.targetVisible && this.target) {
			const dist = Math.hypot(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z)
			// Snipers hold distance; shotguns close in; others may flank.
			if (this.rng.chance(this.profile.flankBias * 0.35) && dist > 18) this.setState(S.FLANK)
			else if (this.rng.chance(this.profile.coverBias * 0.3)) this.setState(S.TAKE_COVER)
			else this.setState(S.COMBAT)
			return
		}
		if (this.lastKnown.valid && this.lastKnown.age < BOTS.searchDuration) {
			this.setState(this.lastKnown.age < 5 ? S.INVESTIGATE : S.SEARCH)
			return
		}
		if (this.profile.looting && this.rng.chance(0.15)) {
			this.setState(S.LOOT)
			return
		}
		if (this.state !== S.PATROL) this.setState(S.PATROL)
	}

	/** Execute the current state: pick destinations, aim and pull the trigger. */
	act(dt) {
		const prof = this.profile
		this.reactionTimer = Math.max(0, this.reactionTimer - dt)
		this.sprinting = false
		this.crouching = false
		this.aiming = false
		let wantFire = false

		switch (this.state) {
			case S.IDLE:
				this.destination.valid = false
				if (this.stateTime > 2) this.setState(S.PATROL)
				break

			case S.PATROL:
				if (!this.destination.valid || this.reachedDestination(2.5) || this.stateTime > 14) {
					const a = this.rng.angle()
					const r = this.rng.range(12, BOTS.patrolRadius)
					this.setDestination(this.patrolAnchor.x + Math.cos(a) * r, this.patrolAnchor.z + Math.sin(a) * r)
					this.stateTime = 0
				}
				break

			case S.INVESTIGATE:
				this.sprinting = true
				if (this.lastKnown.valid) this.setDestination(this.lastKnown.x, this.lastKnown.z)
				if (this.reachedDestination(3)) this.setState(S.SEARCH)
				break

			case S.SEARCH: {
				// Sweep cover positions around the last known position.
				if (!this.destination.valid || this.reachedDestination(2.5)) {
					const base = this.lastKnown.valid ? this.lastKnown : this.pos
					const cover = this.pickCover(base.x, base.z, BOTS.coverSearchRadius, false)
					if (cover) this.setDestination(cover.x, cover.z)
					else this.setDestination(base.x + this.rng.range(-16, 16), base.z + this.rng.range(-16, 16))
				}
				if (this.stateTime > BOTS.searchDuration) {
					this.lastKnown.valid = false
					this.setState(S.PATROL)
				}
				break
			}

			case S.COMBAT: {
				const t = this.target
				if (!t || t.dead) { this.setState(S.SEARCH); break }
				const dist = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z)
				const want = this.preferredRange()
				this.aiming = dist < this.profile.viewDistance * 0.8
				if (dist > want * 1.25) {
					this.setDestination(t.pos.x, t.pos.z)
					this.sprinting = dist > want * 2
				} else if (dist < BOTS.minEngageRange) {
					// Back off to keep the weapon effective.
					this.setDestination(
						this.pos.x - (t.pos.x - this.pos.x) * 0.6,
						this.pos.z - (t.pos.z - this.pos.z) * 0.6)
				} else {
					// Strafe around the target instead of standing still.
					const side = this.index % 2 === 0 ? 1 : -1
					const ang = Math.atan2(t.pos.x - this.pos.x, -(t.pos.z - this.pos.z)) + side * 1.1
					this.setDestination(this.pos.x + Math.sin(ang) * 6, this.pos.z - Math.cos(ang) * 6)
				}
				wantFire = this.targetVisible && this.reactionTimer <= 0
				break
			}

			case S.TAKE_COVER: {
				const t = this.target
				if (!this.coverPoint) {
					this.coverPoint = this.pickCover(this.pos.x, this.pos.z, BOTS.coverSearchRadius, true)
					if (this.coverPoint) this.setDestination(this.coverPoint.x, this.coverPoint.z)
					else this.setState(S.COMBAT)
				}
				if (this.reachedDestination(1.8)) {
					// In cover: crouch, peek and fire when the target is visible.
					this.crouching = this.stateTime % 3 < 1.6
					this.aiming = true
					wantFire = this.targetVisible && !this.crouching && this.reactionTimer <= 0
					if (this.weapons.magazine <= 0) this.weapons.startReload()
					if (this.stateTime > 6) this.setState(t && this.targetVisible ? S.COMBAT : S.SEARCH)
				}
				break
			}

			case S.FLANK: {
				const t = this.target
				if (!t || t.dead) { this.setState(S.SEARCH); break }
				const side = this.index % 2 === 0 ? 1 : -1
				const ang = Math.atan2(t.pos.x - this.pos.x, -(t.pos.z - this.pos.z)) + side * 1.45
				this.setDestination(t.pos.x + Math.sin(ang) * 22, t.pos.z - Math.cos(ang) * 22)
				this.sprinting = true
				wantFire = this.targetVisible && this.reactionTimer <= 0 && this.stateTime > 1.5
				if (this.stateTime > 7 || this.reachedDestination(3)) this.setState(S.COMBAT)
				break
			}

			case S.RETREAT: {
				const t = this.target
				this.sprinting = true
				if (t) {
					const dx = this.pos.x - t.pos.x
					const dz = this.pos.z - t.pos.z
					const l = Math.hypot(dx, dz) || 1
					this.setDestination(this.pos.x + (dx / l) * 26, this.pos.z + (dz / l) * 26)
				}
				if (this.stateTime > 3.5) this.setState(this.healCharges > 0 ? S.HEAL : S.TAKE_COVER)
				break
			}

			case S.HEAL:
				this.destination.valid = false
				this.crouching = true
				this.healTimer += dt
				if (this.healTimer > 3.4) {
					this.healTimer = 0
					if (this.healCharges > 0) {
						this.healCharges--
						this.health = Math.min(BOTS.maxHealth, this.health + 45)
					}
					this.setState(this.targetVisible ? S.COMBAT : S.SEARCH)
				}
				if (this.targetVisible && this.stateTime > 1.2) {
					this.healTimer = 0
					this.setState(S.TAKE_COVER)
				}
				break

			case S.RELOAD:
				this.crouching = true
				if (!this.weapons.reloading) this.setState(this.targetVisible ? S.COMBAT : S.PATROL)
				break

			case S.LOOT: {
				if (!this.destination.valid) {
					const spot = this.world.lootSpawns.length
						? this.world.lootSpawns[this.rng.int(0, this.world.lootSpawns.length - 1)]
						: null
					if (spot && Math.hypot(spot.x - this.pos.x, spot.z - this.pos.z) < 80) {
						this.setDestination(spot.x, spot.y !== undefined ? spot.z : spot.z)
					} else {
						this.setState(S.PATROL)
					}
				}
				if (this.reachedDestination(2.5) || this.stateTime > 10) {
					this.weapons.addAmmo(this.weapons.weapon ? this.weapons.weapon.ammo : "rifle", 30)
					this.setState(S.PATROL)
				}
				break
			}

			default:
				break
		}

		this.steer(dt)
		this.aim(dt, wantFire)
	}

	preferredRange() {
		const w = this.weapons.weapon
		if (!w) return 6
		if (w.ammo === "sniper") return 90
		if (w.ammo === "shell") return 9
		if (w.ammo === "smg") return 16
		if (w.ammo === "none") return 2
		return BOTS.preferredRange
	}

	setDestination(x, z) {
		const clamped = this.world.clamp(x, z)
		this.destination.x = clamped.x
		this.destination.z = clamped.z
		this.destination.valid = true
	}

	reachedDestination(tolerance) {
		if (!this.destination.valid) return true
		return Math.hypot(this.destination.x - this.pos.x, this.destination.z - this.pos.z) < tolerance
	}

	/**
	 * Choose a cover point. When `fromTarget` is set, cover must be roughly
	 * between the bot and its target so it actually blocks incoming fire.
	 */
	pickCover(x, z, radius, fromTarget) {
		const list = this.world.nearbyCover(x, z, radius, this.coverScratch)
		if (!list.length) return null
		let best = null
		let bestScore = -Infinity
		const t = this.target
		for (let i = 0; i < list.length; i++) {
			const c = list[i]
			let score = -Math.hypot(c.x - this.pos.x, c.z - this.pos.z) * 0.4 + (c.height || 1) * 2
			if (fromTarget && t) {
				const toTargetX = t.pos.x - c.x
				const toTargetZ = t.pos.z - c.z
				const d = Math.hypot(toTargetX, toTargetZ)
				if (d < 5) continue
				// Prefer cover that keeps a useful engagement distance.
				score -= Math.abs(d - this.preferredRange()) * 0.25
			}
			if (score > bestScore) {
				bestScore = score
				best = c
			}
		}
		return best
	}

	/** Simple local steering: head to the destination, slide along obstacles. */
	steer(dt) {
		let wishX = 0
		let wishZ = 0
		if (this.destination.valid) {
			wishX = this.destination.x - this.pos.x
			wishZ = this.destination.z - this.pos.z
			const len = Math.hypot(wishX, wishZ)
			if (len < 0.6) {
				wishX = wishZ = 0
			} else {
				wishX /= len
				wishZ /= len
				// Obstacle avoidance: if blocked ahead, steer sideways.
				const probe = this.world.collision.raycast(
					this.pos.x, this.pos.y + 0.9, this.pos.z, wishX, 0, wishZ, 2.6)
				if (probe.hit) {
					const side = this.index % 2 === 0 ? 1 : -1
					const nx = -wishZ * side
					const nz = wishX * side
					wishX = nx
					wishZ = nz
				}
			}
		}

		const base = (this.sprinting ? BOTS.sprintSpeed : BOTS.moveSpeed) *
			this.profile.moveSpeedScale * (this.crouching ? 0.45 : 1)
		const targetVx = wishX * base
		const targetVz = wishZ * base
		this.vel.x = damp(this.vel.x, targetVx, 9, dt)
		this.vel.z = damp(this.vel.z, targetVz, 9, dt)

		// Unstick: if the bot has barely moved while trying to, re-plan.
		const moved = Math.hypot(this.pos.x - this.lastPos.x, this.pos.z - this.lastPos.z)
		this.lastPos.x = this.pos.x
		this.lastPos.z = this.pos.z
		if ((wishX || wishZ) && moved < 0.01) {
			this.stuckTimer += dt
			if (this.stuckTimer > 1.2) {
				this.stuckTimer = 0
				this.setDestination(
					this.pos.x + this.rng.range(-14, 14),
					this.pos.z + this.rng.range(-14, 14))
				if (this.grounded && this.rng.chance(0.4)) this.vel.y = PLAYER.jumpSpeed * 0.8
			}
		} else {
			this.stuckTimer = 0
		}
	}

	/** Aim toward the target with human-like lag and error, then fire bursts. */
	aim(dt, wantFire) {
		const prof = this.profile
		let desiredYaw = this.yaw
		let desiredPitch = 0
		const t = this.target

		if (t && (this.targetVisible || this.state === S.COMBAT)) {
			const dx = t.pos.x - this.pos.x
			const dz = t.pos.z - this.pos.z
			const dy = (t.pos.y + 1.2) - this.eyeY()
			const flat = Math.hypot(dx, dz)
			desiredYaw = Math.atan2(dx, -dz)
			desiredPitch = Math.atan2(dy, Math.max(0.2, flat))
		} else if (this.destination.valid) {
			desiredYaw = Math.atan2(this.destination.x - this.pos.x, -(this.destination.z - this.pos.z))
		}

		this.yaw = angleDamp(this.yaw, desiredYaw, prof.aimSpeed, dt)
		this.pitch = damp(this.pitch, desiredPitch, prof.aimSpeed, dt)

		// Burst discipline.
		const w = this.weapons.weapon
		let fire = false
		if (wantFire && w) {
			if (this.burstPause > 0) {
				this.burstPause -= dt
			} else if (this.burstRemaining > 0) {
				fire = true
				this.burstRemaining -= dt * (w.rpm / 60)
				if (this.burstRemaining <= 0) {
					this.burstPause = this.rng.range(prof.burstPause[0], prof.burstPause[1])
				}
			} else {
				this.burstRemaining = this.rng.int(prof.burstMin, prof.burstMax)
			}
		} else {
			this.burstRemaining = 0
		}

		// Build the fire command with aim error applied to the direction.
		const fs = this.fireState
		const errorYaw = this.rng.range(-prof.aimError, prof.aimError)
		const errorPitch = this.rng.range(-prof.aimError, prof.aimError) * 0.6
		const ay = this.yaw + errorYaw
		const ap = clamp(this.pitch + errorPitch, -1.1, 1.1)
		const cp = Math.cos(ap)
		fs.dir.x = Math.sin(ay) * cp
		fs.dir.y = Math.sin(ap)
		fs.dir.z = -Math.cos(ay) * cp
		fs.origin.x = this.pos.x + fs.dir.x * 0.5
		fs.origin.y = this.eyeY() - 0.12
		fs.origin.z = this.pos.z + fs.dir.z * 0.5
		fs.fire = fire
		fs.firePressed = fire
		fs.aiming = this.aiming
		fs.crouching = this.crouching
		fs.moveSpeed = this.speed
	}

	updateWeapon(dt) {
		const shots = this.weapons.update(dt, this.fireState)
		if (shots > 0) this.rig.notifyShot(0.8)
	}

	physics(dt) {
		this.vel.y = Math.max(-PLAYER.maxFallSpeed, this.vel.y - PLAYER.gravity * dt)
		const terrainY = this.world.groundAt(this.pos.x, this.pos.z)
		const result = resolveMovement(
			this.world.collision, this.pos, this.vel,
			BOTS.radius, this.crouching ? PLAYER.crouchHeight : BOTS.height,
			dt, PLAYER.stepHeight, terrainY)
		this.grounded = result.grounded
		this.speed = Math.hypot(this.vel.x, this.vel.z)
		this.surface = this.world.surfaceAt(this.pos.x, this.pos.z)
	}

	updateFootsteps(dt) {
		if (!this.grounded || this.speed < 1) return
		this.footstepTimer = (this.footstepTimer || 0) + dt * this.speed
		if (this.footstepTimer > 3.4) {
			this.footstepTimer = 0
			bus.emit("player:footstep", {
				x: this.pos.x, y: this.pos.y, z: this.pos.z,
				surface: this.surface, loud: this.sprinting, isPlayer: false,
			})
		}
	}

	animState() {
		return {
			speed: this.speed,
			maxSpeed: BOTS.sprintSpeed,
			sprinting: this.sprinting,
			crouching: this.crouching,
			grounded: this.grounded,
			aiming: this.aiming,
			reloading: this.weapons.reloading,
			switching: this.weapons.switching,
			hitTimer: this.hitTimer,
			landTimer: this.landTimer,
			dead: this.dead,
			yaw: this.yaw,
		}
	}

	draw(scene) {
		this.rig.draw(scene, {
			x: this.pos.x, y: this.pos.y, z: this.pos.z,
			yaw: this.yaw, pitch: this.pitch, weaponId: this.weapons.weaponId,
		})
	}
}

export { BOT_STATE }
