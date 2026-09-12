/**
 * Inventory panel (Tab). Mirrors the loadout, ammo, medical items and armour,
 * and supports mouse clicks as well as keyboard shortcuts so it is usable
 * without a pointer.
 */
import { WEAPONS } from "../config/weapons.js"
import { PLAYER } from "../config/player.js"

function el(tag, className, parent, text) {
	const node = document.createElement(tag)
	if (className) node.className = className
	if (text !== undefined) node.textContent = text
	if (parent) parent.appendChild(node)
	return node
}

export class InventoryPanel {
	constructor(root, handlers) {
		this.handlers = handlers || {}
		this.node = el("div", "inventory-panel hidden", root)
		const header = el("div", "inv-header", this.node)
		el("h2", null, header, "INVENTORY")
		this.capacityNode = el("div", "inv-capacity", header, "")

		const body = el("div", "inv-body", this.node)

		const weapons = el("div", "inv-column", body)
		el("h3", null, weapons, "LOADOUT")
		this.slotNodes = []
		const slotDefs = [["PRIMARY", 0], ["SECONDARY", 1], ["MELEE", 2]]
		for (const [label, index] of slotDefs) {
			const row = el("div", "inv-slot", weapons)
			el("span", "inv-slot-label", row, label)
			const name = el("span", "inv-slot-name", row, "EMPTY")
			row.addEventListener("click", () => this.handlers.onSelectSlot && this.handlers.onSelectSlot(index))
			this.slotNodes.push({ row, name })
		}

		const ammo = el("div", "inv-column", body)
		el("h3", null, ammo, "AMMUNITION")
		this.ammoNode = el("div", "inv-list", ammo)

		const meds = el("div", "inv-column", body)
		el("h3", null, meds, "MEDICAL")
		this.healNode = el("div", "inv-list", meds)

		const gear = el("div", "inv-column", body)
		el("h3", null, gear, "EQUIPMENT")
		this.gearNode = el("div", "inv-list", gear)

		el("div", "inv-footer", this.node,
			"TAB close   -   1/2/3 equip   -   H use best medical item   -   click a row to use it")
	}

	get visible() {
		return !this.node.classList.contains("hidden")
	}

	setVisible(visible) {
		this.node.classList.toggle("hidden", !visible)
	}

	toggle() {
		this.setVisible(!this.visible)
		return this.visible
	}

	/** @param {object} snap Inventory.snapshot() output */
	update(snap, slotIndex) {
		if (!this.visible) return
		this.capacityNode.textContent = "CAPACITY " + snap.used.toFixed(1) + " / " + snap.capacity +
			(snap.used >= snap.capacity ? "   (FULL)" : "")
		const names = [snap.primary, snap.secondary, snap.melee]
		for (let i = 0; i < 3; i++) {
			const node = this.slotNodes[i]
			node.name.textContent = names[i] ? names[i].toUpperCase() : "EMPTY"
			node.row.classList.toggle("active", i === slotIndex)
		}

		this.ammoNode.innerHTML = ""
		for (const entry of snap.ammo) {
			const row = el("div", "inv-row", this.ammoNode)
			el("span", null, row, entry.label)
			el("span", "inv-count", row, String(entry.count))
		}

		this.healNode.innerHTML = ""
		for (const id in snap.heals) {
			const def = PLAYER.healItems[id]
			const row = el("div", "inv-row clickable", this.healNode)
			el("span", null, row, def ? def.name.toUpperCase() : id.toUpperCase())
			el("span", "inv-count", row, "x" + snap.heals[id])
			row.addEventListener("click", () => this.handlers.onUseHeal && this.handlers.onUseHeal(id))
		}
		if (snap.grenades) {
			const row = el("div", "inv-row", this.healNode)
			el("span", null, row, "FRAG GRENADE")
			el("span", "inv-count", row, "x" + snap.grenades)
		}

		this.gearNode.innerHTML = ""
		const gearRows = [
			["HELMET", snap.helmetLevel],
			["BODY ARMOR", snap.vestLevel],
			["BACKPACK", snap.backpackLevel],
		]
		for (const [label, level] of gearRows) {
			const row = el("div", "inv-row", this.gearNode)
			el("span", null, row, label)
			el("span", "inv-count", row, level ? "LV." + level : "-")
		}
	}
}

export { WEAPONS }
