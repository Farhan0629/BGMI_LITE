/**
 * Tiny synchronous event bus. Systems communicate through it instead of
 * holding references to each other, which is what keeps audio, UI, HUD and
 * (later) the network layer decoupled from gameplay code.
 *
 * Event keys used by the game:
 *   combat:shot, combat:hit, combat:kill, combat:playerDamaged,
 *   player:heal, player:pickup, player:reload, player:switch,
 *   player:footstep, player:jump, player:land,
 *   zone:stage, zone:warning, match:state, explosion, ui:toast
 */
export class EventBus {
	constructor() {
		/** @type {Map<string, Set<Function>>} */
		this.listeners = new Map()
	}

	on(event, fn) {
		let set = this.listeners.get(event)
		if (!set) {
			set = new Set()
			this.listeners.set(event, set)
		}
		set.add(fn)
		return () => set.delete(fn)
	}

	off(event, fn) {
		this.listeners.get(event)?.delete(fn)
	}

	emit(event, payload) {
		const set = this.listeners.get(event)
		if (!set) return
		for (const fn of set) {
			try {
				fn(payload)
			} catch (err) {
				console.error(`[bus] listener for "${event}" failed`, err)
			}
		}
	}

	clear() {
		this.listeners.clear()
	}
}

export const bus = new EventBus()
