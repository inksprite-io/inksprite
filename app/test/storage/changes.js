/**
 * Changes a writer might make to a project, picked at random from a seed,
 * for trying plans on runs of them.
 */

import { countWords } from '@/utils/wordCount.js'
import { ROOT, doc } from './project.js'

/** @typedef {import('@/types/models.js').Document} Document */

/**
 * @param {Document[]} documents
 * @param {string} id
 * @param {Partial<Document>} fields
 */
const change = (documents, id, fields) =>
  documents.map(d => (d.id === id ? { ...d, ...fields } : d))

/** @param {Document[]} documents @param {string[]} ids */
const without = (documents, ids) => documents.filter(d => !ids.includes(d.id))

/** A small seeded random number generator, so a failure can be run again. */
export function random(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const TITLES = [
  'A',
  'a',
  'B',
  'Notes',
  'notes',
  'X/Y',
  'X-Y',
  'Chapter 1',
  'Map',
  '',
  '.dot',
  'CON',
]

/**
 * One change a writer might make, picked at random.
 *
 * @param {Document[]} documents
 * @param {() => number} next
 * @param {number} count - For new ids
 * @returns {Document[]}
 */
export function anyChange(documents, next, count) {
  const pick = (/** @type {any[]} */ list) => list[Math.floor(next() * list.length)]
  const byId = new Map(documents.map(d => [d.id, d]))
  const inRepository = (/** @type {Document} */ d) => {
    for (let at = byId.get(d.parentId); at; at = byId.get(at.parentId)) {
      if (at.kind === 'repository') return true
    }
    return false
  }
  const below = (/** @type {string} */ id) => {
    const out = new Set([id])
    let grew = true
    while (grew) {
      grew = false
      for (const d of documents) {
        if (!out.has(d.id) && out.has(d.parentId)) {
          out.add(d.id)
          grew = true
        }
      }
    }
    return out
  }
  const movable = documents.filter(d => d.id !== ROOT && !inRepository(d))
  const folders = documents.filter(
    d => d.type === 'folder' && d.kind !== 'repository' && !inRepository(d)
  )
  const kind = pick([
    'rename',
    'rename',
    'move',
    'move',
    'delete',
    'create',
    'create',
    'reorder',
    'order',
    'edit',
  ])

  if (kind === 'rename' && movable.length) {
    return change(documents, pick(movable).id, { title: pick(TITLES) })
  }
  if (kind === 'move' && movable.length) {
    const moving = pick(movable)
    const inside = below(moving.id)
    const to = pick(folders.filter(f => !inside.has(f.id)))
    if (to) return change(documents, moving.id, { parentId: to.id, order: Math.floor(next() * 5) })
  }
  if (kind === 'delete' && movable.length) {
    return without(documents, [...below(pick(movable).id)])
  }
  if (kind === 'create') {
    const parent = pick(folders)
    const type = pick(['text', 'text', 'folder', 'file'])
    const id = `new${count}`
    const fields =
      type === 'file'
        ? { type, title: pick(TITLES), mime: 'image/png', content: '' }
        : { type, title: pick(TITLES), content: type === 'text' ? `Text ${count}` : '' }
    return [...documents, doc(id, parent.id, { ...fields, order: Math.floor(next() * 5) })]
  }
  if (kind === 'reorder') {
    const parent = pick(folders)
    return documents.map(d =>
      d.parentId === parent.id ? { ...d, order: Math.floor(next() * 10) } : d
    )
  }
  if (kind === 'order') {
    const parent = pick(folders)
    return change(documents, parent.id, { ordered: !parent.ordered })
  }
  if (kind === 'edit' && movable.length) {
    const target = pick(movable.filter(d => d.type !== 'folder'))
    if (target) {
      const content = `Edited ${count} times over`
      return change(documents, target.id, { content, wordCount: countWords(content) })
    }
  }
  return documents
}
