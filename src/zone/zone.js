/**
 * Shrinking combat zone.
 *
 * Each stage holds for a while (with a warning before it moves), then shrinks
 * toward a new centre that is guaranteed to stay inside the island. Anyone
 * outside the current circle takes damage over time that scales up with the
 * stage, so late-game fights are forced into a small area.
 */
import { ZONE } from "../config/zone.js"
import { clamp, lerp } from "../core/math.js"
import { bus } from "../core/events.js"

export const ZONE_PHASE = { HOLD: "HOLD", SHRINK: "SHRINK", FINISHED: "FINISHED" }

export class Zone {
	constructor(world, rng) {
		this.world = world
		this.rng = rng
		this.reset()
	}

	reset() {
		this.centerX = 0
		this.centerZ = 0
		this.radius = ZONE.startRadius
		this.fromRadius = ZONE.startRadius
		this.fromX = 0
		this.fromZ = 0
		this.targetX = 0
		this.targetZ = 0
		this.targetRadius = ZONE.startRadius
		this.stageIndex = -1
		this.phase = ZONE_PHASE.HOLD
		this.timer = ZONE.startHold
		this.phaseDuration = ZONE.startHold
		this.damage = 0
		this.warned = false
		this.damageAccumulator = new WeakMap()
	}

	get stage() {
		return this.stageIndex >= 0 ? ZONE.stages[this.stageIndex] : null
	}

	get stageLabel() {
		const s = this.stage
		if (this.phase === ZONE_PHASE.FINISHED) return "ZONE LOCKED"
		if (!s) return "ZONE STABLE"
		return this.phase === ZONE_PHASE.SHRINK ? s.label + " - COLLAPSING" : "NEXT: " + s.label
	}

	/** Seconds until the next phase change, for the HUD timer. */
	get timeRemaining() {
		return Math.max(0, this.timer)
	}

	/** Pick the next centre, biased toward the island interior. */
	planNextStage() {
		const next = this.stageIndex + 1
		if (next >= ZONE.stages.length) {
			this.phase = ZONE_PHASE.FINISHED
			this.timer = Infinity
			return
		}
		const stage = ZONE.stages[next]
		const drift = (this.radius - stage.radius) * ZONE.centerDrift
		const angle = this.rng.angle()
		let cx = this.centerX + Math.cos(angle) * drift
		let cz = this.centerZ + Math.sin(angle) * drift
		// Keep the new circle inside the playable island.
		const maxOffset = Math.max(0, this.world.radius * 0.72 - stage.radius)
		const dist = Math.hypot(cx, cz)
		if (dist > maxOffset && dist > 0) {
			cx = (cx / dist) * maxOffset
			cz = (cz / dist) * maxOffset
		}
		this.stageIndex = next
		this.fromX = this.centerX
		this.fromZ = this.centerZ
		this.fromRadius = this.radius
		this.targetX = cx
		this.targetZ = cz
		this.targetRadius = stage.radius
		this.phase = ZONE_PHASE.HOLD
		this.timer = stage.hold
		this.phaseDuration = stage.hold
		this.warned = false
		bus.emit("zone:stage", {
			index: next, label: stage.label,
			radius: stage.radius, hold: stage.hold, shrink: stage.shrink,
		})
	}

	start() {
		this.reset()
		this.timer = ZONE.startHold
		this.phaseDuration = ZONE.startHold
		this.phase = ZONE_PHASE.HOLD
		this.stageIndex = -1
	}

	/**
	 * @param {number} dt
	 * @param {object[]} combatants everyone who can take zone damage
	 */
	update(dt, combatants) {
		if (this.phase !== ZONE_PHASE.FINISHED) {
			this.timer -= dt
			if (this.phase === ZONE_PHASE.HOLD) {
				if (!this.warned && this.timer <= ZONE.warningSeconds) {
					this.warned = true
					const next = this.stageIndex < 0 ? ZONE.stages[0] : ZONE.stages[this.stageIndex]
					bus.emit("zone:warning", {
						seconds: Math.round(Math.max(0, this.timer)),
						label: next ? next.label : "ZONE",
					})
				}
				if (this.timer <= 0) {
					if (this.stageIndex < 0) {
						this.planNextStage()
						this.beginShrink()
					} else {
						this.beginShrink()
					}
				}
			} else if (this.phase === ZONE_PHASE.SHRINK) {
				const t = 1 - clamp(this.timer / Math.max(0.001, this.phaseDuration), 0, 1)
				this.radius = lerp(this.fromRadius, this.targetRadius, t)
				this.centerX = lerp(this.fromX, this.targetX, t)
				this.centerZ = lerp(this.fromZ, this.targetZ, t)
				if (this.timer <= 0) {
					this.radius = this.targetRadius
					this.centerX = this.targetX
					this.centerZ = this.targetZ
					this.planNextStage()
				}
			}
		}
		this.applyDamage(dt, combatants)
	}

	beginShrink() {
		const stage = this.stage
		if (!stage) {
			this.phase = ZONE_PHASE.FINISHED
			return
		}
		this.phase = ZONE_PHASE.SHRINK
		this.timer = stage.shrink
		this.phaseDuration = stage.shrink
		this.damage = stage.damage
		this.warned = false
	}

	distanceOutside(x, z) {
		return Math.hypot(x - this.centerX, z - this.centerZ) - this.radius
	}

	isOutside(x, z) {
		return this.distanceOutside(x, z) > 0
	}

	get damagePerSecond() {
		const stage = this.stage
		return stage ? stage.damage : (ZONE.stages[0] ? ZONE.stages[0].damage * 0.5 : 1)
	}

	/** Damage is applied in whole points so health readouts tick sensibly. */
	applyDamage(dt, combatants) {
		if (!combatants) return
		const dps = this.damagePerSecond
		for (let i = 0; i < combatants.length; i++) {
			const c = combatants[i]
			if (!c || c.dead) continue
			if (!this.isOutside(c.pos.x, c.pos.z)) continue
			const pending = (this.damageAccumulator.get(c) || 0) + dps * dt
			if (pending >= 1) {
				const whole = Math.floor(pending)
				this.damageAccumulator.set(c, pending - whole)
				c.applyDamage(whole, { cause: "THE ZONE", ignoreArmor: true, location: "chest" })
			} else {
				this.damageAccumulator.set(c, pending)
			}
		}
	}

	/** Nearest safe point, used by bots to rotate into the circle. */
	safePoint(x, z, margin = 0.75) {
		const dx = x - this.centerX
		const dz = z - this.centerZ
		const d = Math.hypot(dx, dz)
		if (d <= this.radius * margin) return { x, z }
		const target = this.radius * margin
		return {
			x: this.centerX + (dx / (d || 1)) * target,
			z: this.centerZ + (dz / (d || 1)) * target,
		}
	}
}
