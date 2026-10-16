/**
 * @module utils/exportTree
 * @description What Export offers, as a tree of boxes, and what the boxes
 * ticked choose.
 *
 * The tree has the projects, each with its documents as the outline has them
 * and its chats; the character cards in the library; and the settings, under
 * a heading per kind (`utils/settingsFile.js`). Its nodes and ticks are
 * PrimeVue Tree's: a key, a label and children each, and the ticks as
 * `selectionKeys`, a node checked or partly checked.
 *
 * What is kept between ticks is only the leaves ticked: a document, a chat, a
 * card, a setting. A node above them is ticked when everything under it is,
 * and partly when some is. A project's documents and chats are read when it
 * is opened; until then it is a leaf of its own, and ticked it stands for the
 * whole of it. One with nothing in it stays that leaf once read, and opens on
 * a line saying so, which has no box: it isn't something to export.
 *
 * Every leaf ticked is everything, which is a whole backup. Pure: reading
 * and writing the rows is `composables/useBackup.js`.
 */

import { rootIdFor } from '../stores/migrations/projectTree.js'
import { compareNames } from './compareNames.js'
import { orderSiblings } from './siblingOrder.js'
import { KINDS, SETTINGS_TABLES, pickWithNeeds } from './settingsFile.js'

/** @typedef {import('../types/models.js').Document} Document */
/** @typedef {import('../types/models.js').Chat} Chat */
/** @typedef {import('./settingsFile.js').SettingsItem} SettingsItem */
/** @typedef {import('primevue/tree').TreeSelectionKeys} TreeSelectionKeys */

/**
 * A box in the tree.
 *
 * @typedef {Object} ExportNode
 * @property {string} key
 * @property {string} label
 * @property {ExportNode[]} [children]
 * @property {boolean} [leaf] - False on a project not read yet, which has
 *   children to show once it is, and on one read with nothing in it
 * @property {boolean} [selectable] - False on the line an empty project
 *   opens on, which has no box
 */

/**
 * A project as Export knows it: its name, and once it has been opened, what
 * is in it.
 *
 * @typedef {Object} ExportProject
 * @property {string} id - The story's
 * @property {string} title
 * @property {{documents: Document[], chats: Chat[]}} [contents] - Once read
 */

/**
 * Everything Export can offer.
 *
 * @typedef {Object} Exportable
 * @property {ExportProject[]} projects
 * @property {Array<{id: string, title: string}>} cards
 * @property {SettingsItem[]} settings
 */

/**
 * What the boxes ticked choose.
 *
 * @typedef {Object} ExportPick
 * @property {boolean} everything - Every box ticked: a whole backup
 * @property {Array<{id: string, whole: boolean, documentIds: string[], chatIds: string[]}>} projects -
 *   Those with anything ticked: all of one, or the documents and chats ticked
 * @property {string[]} cardIds
 * @property {Set<string>} settings - The settings items' keys (`SettingsItem.key`)
 */

const PROJECTS = 'projects'
const CARDS = 'cards'
const SETTINGS = 'settings'

const projectKey = (/** @type {string} */ id) => `project:${id}`
const documentKey = (/** @type {string} */ id) => `document:${id}`
const chatKey = (/** @type {string} */ id) => `chat:${id}`
const cardKey = (/** @type {string} */ id) => `card:${id}`
const settingKey = (/** @type {string} */ itemKey) => `setting:${itemKey}`

/**
 * The id a leaf's key holds, when it is a leaf of that kind.
 *
 * @param {string} key
 * @param {string} prefix - `document`, `chat`, `card`, `setting` or `project`
 * @returns {string|undefined}
 */
const idIn = (key, prefix) =>
  key.startsWith(`${prefix}:`) ? key.slice(prefix.length + 1) : undefined

/**
 * The tree Export shows.
 *
 * @param {Exportable} exportable
 * @returns {ExportNode[]} Projects, character cards and settings, each left
 *   out when there is none
 */
export function exportTree({ projects, cards, settings }) {
  /** @type {ExportNode[]} */
  const nodes = []
  if (projects.length > 0) {
    const sorted = projects.slice().sort((a, b) => compareNames(a.title, b.title))
    nodes.push({ key: PROJECTS, label: 'Projects', children: sorted.map(projectNode) })
  }
  if (cards.length > 0) {
    const sorted = cards.slice().sort((a, b) => compareNames(a.title, b.title))
    nodes.push({
      key: CARDS,
      label: 'Character cards',
      children: sorted.map(card => ({ key: cardKey(card.id), label: card.title })),
    })
  }
  const groups = settingsNodes(settings)
  if (groups.length > 0) nodes.push({ key: SETTINGS, label: 'Settings', children: groups })
  return nodes
}

/**
 * A project's box: its documents and its chats under it once read, or a leaf
 * that opens until then. One with neither is a leaf for good.
 *
 * @param {ExportProject} project
 * @returns {ExportNode}
 */
function projectNode({ id, title, contents }) {
  const key = projectKey(id)
  const label = title || 'Untitled'
  if (!contents) return { key, label, leaf: false }

  /** @type {Map<string, Document[]>} */
  const byParent = new Map()
  for (const document of contents.documents) {
    const siblings = byParent.get(document.parentId)
    if (siblings) siblings.push(document)
    else byParent.set(document.parentId, [document])
  }
  const root = contents.documents.find(document => document.id === rootIdFor(id))

  /** @type {ExportNode[]} */
  const children = []
  const documents = root ? documentNodes(root, byParent) : []
  if (documents.length > 0) {
    children.push({ key: `documents:${id}`, label: 'Documents', children: documents })
  }
  if (contents.chats.length > 0) {
    // Newest first, as the chat list has them.
    const chats = contents.chats
      .slice()
      .sort(
        (a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0) || compareNames(a.title, b.title)
      )
    children.push({
      key: `chats:${id}`,
      label: 'Chats',
      children: chats.map(chat => ({ key: chatKey(chat.id), label: chat.title || 'Untitled' })),
    })
  }
  if (children.length > 0) return { key, label, children }
  return {
    key,
    label,
    leaf: false,
    children: [{ key: `empty:${id}`, label: 'Empty', selectable: false }],
  }
}

/**
 * The boxes under a node: its children but a line with no box. A node with
 * none is a leaf, ticked for itself.
 *
 * @param {ExportNode} node
 * @returns {ExportNode[]}
 */
const boxesUnder = node => (node.children || []).filter(child => child.selectable !== false)

/**
 * A folder's documents, in the outline's order, each folder with its own.
 *
 * @param {Document} folder
 * @param {Map<string, Document[]>} byParent
 * @returns {ExportNode[]}
 */
function documentNodes(folder, byParent) {
  return orderSiblings((byParent.get(folder.id) || []).slice(), folder.ordered).map(document => {
    const children = documentNodes(document, byParent)
    const label = document.title?.trim() || 'Untitled'
    return children.length > 0
      ? { key: documentKey(document.id), label, children }
      : { key: documentKey(document.id), label }
  })
}

/**
 * The settings under a heading per kind, in the order the kinds are listed.
 *
 * @param {SettingsItem[]} items
 * @returns {ExportNode[]}
 */
function settingsNodes(items) {
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
 * @param {ExportNode[]} nodes
 * @returns {string[]}
 */
export function leavesOf(nodes) {
  return nodes.flatMap(node => {
    const under = boxesUnder(node)
    return under.length > 0 ? leavesOf(under) : [node.key]
  })
}

/**
 * The ticks to show for the leaves ticked: each node above them checked when
 * all under it is, partly when some is.
 *
 * @param {ExportNode[]} nodes
 * @param {Set<string>} ticked - Leaf keys
 * @returns {TreeSelectionKeys}
 */
export function selectionKeys(nodes, ticked) {
  /** @type {TreeSelectionKeys} */
  const keys = {}
  /**
   * @param {ExportNode} node
   * @returns {'all'|'some'|'none'}
   */
  const visit = node => {
    const under = boxesUnder(node)
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
 * The leaves ticked, read back from the ticks the tree reports after a click,
 * with what each setting newly ticked is no use without ticked too, as the
 * settings export always has (`pickWithNeeds`).
 *
 * @param {ExportNode[]} nodes
 * @param {TreeSelectionKeys} keys
 * @param {Set<string>} before - The leaves ticked before the click
 * @param {SettingsItem[]} settings
 * @returns {Set<string>}
 */
export function tickedLeaves(nodes, keys, before, settings) {
  const ticked = new Set(leavesOf(nodes).filter(key => keys[key]?.checked))
  for (const key of [...ticked]) {
    const item = idIn(key, 'setting')
    if (item === undefined || before.has(key)) continue
    for (const needed of pickWithNeeds(new Set(), settings, item)) ticked.add(settingKey(needed))
  }
  return ticked
}

/**
 * The leaves ticked once a project has been read: a project ticked whole
 * becomes everything under it ticked.
 *
 * @param {Set<string>} ticked
 * @param {ExportNode[]} nodes - The tree with the project read
 * @param {string} projectId
 * @returns {Set<string>}
 */
export function afterReading(ticked, nodes, projectId) {
  const key = projectKey(projectId)
  const node = nodes
    .find(top => top.key === PROJECTS)
    ?.children?.find(project => project.key === key)
  const under = node ? boxesUnder(node) : []
  if (!ticked.has(key) || under.length === 0) return ticked
  const out = new Set(ticked)
  out.delete(key)
  for (const leaf of leavesOf(under)) out.add(leaf)
  return out
}

/**
 * What the boxes ticked choose.
 *
 * @param {ExportNode[]} nodes
 * @param {Set<string>} ticked
 * @returns {ExportPick}
 */
export function exportPick(nodes, ticked) {
  const projects = (nodes.find(node => node.key === PROJECTS)?.children || []).flatMap(node => {
    const id = /** @type {string} */ (idIn(node.key, 'project'))
    const under = boxesUnder(node)
    if (under.length === 0)
      return ticked.has(node.key) ? [{ id, whole: true, documentIds: [], chatIds: [] }] : []
    const leaves = leavesOf(under).filter(key => ticked.has(key))
    if (leaves.length === 0) return []
    return [
      {
        id,
        whole: leaves.length === leavesOf(under).length,
        documentIds: leaves.flatMap(key => idIn(key, 'document') ?? []),
        chatIds: leaves.flatMap(key => idIn(key, 'chat') ?? []),
      },
    ]
  })
  const all = [...ticked]
  return {
    everything: leavesOf(nodes).every(key => ticked.has(key)),
    projects,
    cardIds: all.flatMap(key => idIn(key, 'card') ?? []),
    settings: new Set(all.flatMap(key => idIn(key, 'setting') ?? [])),
  }
}

/**
 * The documents of a project that go with those picked: each picked, every
 * folder above one, and the root, which carries the project's name.
 *
 * @param {Document[]} documents - The project's whole tree
 * @param {string} storyId
 * @param {Iterable<string>} picked - The ids of those ticked
 * @returns {Document[]} In the order they came
 */
export function documentsWith(documents, storyId, picked) {
  const byId = new Map(documents.map(document => [document.id, document]))
  const kept = new Set([rootIdFor(storyId)])
  for (const id of picked) {
    for (let document = byId.get(id); document && !kept.has(document.id); ) {
      kept.add(document.id)
      document = byId.get(document.parentId)
    }
  }
  return documents.filter(document => kept.has(document.id))
}
