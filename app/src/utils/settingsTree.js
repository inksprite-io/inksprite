/**
 * @module utils/settingsTree
 * @description What Export settings offers, as a tree of boxes, and what the
 * boxes ticked choose: the writer's setup, under a heading for each kind
 * (`utils/settingsFile.js`). Its nodes and ticks are PrimeVue Tree's: a key,
 * a label and children each, and the ticks as `selectionKeys`, a node
 * checked or partly checked.
 *
 * What is kept between ticks is only the settings ticked. A heading is
 * ticked when everything under it is, and partly when some is, and ticking
 * a setting ticks what it is no use without, such as a preset's connection.
 *
 * Pure: reading and writing the rows is `composables/useBackup.js`.
 */

import { KINDS, SETTINGS_TABLES, pickWithNeeds } from './settingsFile.js'

/** @typedef {import('./settingsFile.js').SettingsItem} SettingsItem */
/** @typedef {import('primevue/tree').TreeSelectionKeys} TreeSelectionKeys */

/**
 * A box in the tree.
 *
 * @typedef {Object} SettingsNode
 * @property {string} key
 * @property {string} label
 * @property {SettingsNode[]} [children]
 */

const settingKey = (/** @type {string} */ itemKey) => `setting:${itemKey}`

/**
 * The item a leaf's key holds.
 *
 * @param {string} key
 * @returns {string|undefined}
 */
const itemOf = key => (key.startsWith('setting:') ? key.slice('setting:'.length) : undefined)

/**
 * The tree Export settings shows: a heading for each kind there is any of,
 * in the order the kinds are listed.
 *
 * @param {SettingsItem[]} items
 * @returns {SettingsNode[]}
 */
export function settingsTree(items) {
  return [...SETTINGS_TABLES, /** @type {const} */ ('settings')]
    .map(kind => ({
      key: `kind:${kind}`,
      label: KINDS[kind].heading,
      children: items
        .filter(item => item.kind === kind)
        .map(item => ({ key: settingKey(item.key), label: item.name })),
    }))
    .filter(group => group.children.length > 0)
}

/**
 * Every leaf of the tree, in order.
 *
 * @param {SettingsNode[]} nodes
 * @returns {string[]}
 */
export function leavesOf(nodes) {
  return nodes.flatMap(node =>
    node.children && node.children.length > 0 ? leavesOf(node.children) : [node.key]
  )
}

/**
 * The ticks to show for the leaves ticked: each heading checked when all
 * under it is, partly when some is.
 *
 * @param {SettingsNode[]} nodes
 * @param {Set<string>} ticked - Leaf keys
 * @returns {TreeSelectionKeys}
 */
export function selectionKeys(nodes, ticked) {
  /** @type {TreeSelectionKeys} */
  const keys = {}
  /**
   * @param {SettingsNode} node
   * @returns {'all'|'some'|'none'}
   */
  const visit = node => {
    const under = node.children || []
    if (under.length === 0) {
      if (!ticked.has(node.key)) return 'none'
      keys[node.key] = { checked: true, partialChecked: false }
      return 'all'
    }
    const states = under.map(visit)
    if (states.every(state => state === 'all')) {
      keys[node.key] = { checked: true, partialChecked: false }
      return 'all'
    }
    if (states.every(state => state === 'none')) return 'none'
    keys[node.key] = { checked: false, partialChecked: true }
    return 'some'
  }
  nodes.forEach(visit)
  return keys
}

/**
 * The leaves ticked, read back from the ticks the tree reports after a
 * click, with what each setting newly ticked is no use without ticked too
 * (`pickWithNeeds`).
 *
 * @param {SettingsNode[]} nodes
 * @param {TreeSelectionKeys} keys
 * @param {Set<string>} before - The leaves ticked before the click
 * @param {SettingsItem[]} items
 * @returns {Set<string>}
 */
export function tickedLeaves(nodes, keys, before, items) {
  const ticked = new Set(leavesOf(nodes).filter(key => keys[key]?.checked))
  for (const key of [...ticked]) {
    const item = itemOf(key)
    if (item === undefined || before.has(key)) continue
    for (const needed of pickWithNeeds(new Set(), items, item)) ticked.add(settingKey(needed))
  }
  return ticked
}

/**
 * The settings items the boxes ticked choose, by their keys
 * (`SettingsItem.key`).
 *
 * @param {Set<string>} ticked
 * @returns {Set<string>}
 */
export function pickedSettings(ticked) {
  return new Set([...ticked].flatMap(key => itemOf(key) ?? []))
}
