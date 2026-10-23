/* global Blob */
/**
 * @module cards/library
 * @description A card as the writer's library keeps it: read from a file,
 * described for browsing, and found again by name or tag.
 *
 * The library holds cards as cards, outside any project. What it shows in its
 * grid, searches and sorts by is a lean description made here when a card is
 * added; the card itself is kept beside that as it arrived, for showing in
 * full and for writing into a project the way an imported file is.
 *
 * Pure: nothing here touches a store. Design: `.llm/card_library_design.md`.
 */

import { cardFromPng } from './png.js'
import { readCard, shapeOf, uncomment } from './card.js'
import { fingerprint } from '@/utils/settingsFile.js'
import { safeName } from '@/storage/names.js'

/** @typedef {import('../types/models.js').LibraryCard} LibraryCard */
/** @typedef {import('../types/models.js').CardFile} CardFile */

/** @typedef {'added'|'name'|'used'} CardOrder */

/** How long a card's notes are kept for the hover, in characters. */
const NOTES_LENGTH = 600

/** A PNG might hold a card. */
const PNG = /\.png$/i

/** JSON might be one. */
const JSON_FILE = /\.json$/i

/**
 * The card in a file, and the PNG it came in, or null when the file holds no
 * character card: a PNG with nothing in it, a lorebook, anything else.
 *
 * @param {File} file
 * @returns {Promise<{card: any, image: Blob|null}|null>}
 */
export async function readCardFile(file) {
  const isPng = PNG.test(file.name) || file.type === 'image/png'
  const isJson = JSON_FILE.test(file.name) || file.type === 'application/json'
  /** @type {any} */
  let value = null
  try {
    if (isPng) value = cardFromPng(await file.arrayBuffer())
    else if (isJson) value = JSON.parse(await file.text())
  } catch {
    return null
  }
  if (shapeOf(value) !== 'card') return null
  const image = isPng ? new Blob([file], { type: 'image/png' }) : null
  return { card: value, image }
}

/**
 * What the library knows a card by, made from the card as it arrived.
 *
 * @param {any} value - A V1, V2 or V3 card
 * @returns {Omit<LibraryCard, 'id'|'added'|'used'>}
 */
export function describeCard(value) {
  const card = readCard(value)
  const data = value?.data && typeof value.data === 'object' ? value.data : value || {}
  const notes =
    plainText(typeof data.creator_notes === 'string' ? data.creator_notes : '') ||
    plainText(uncomment(card.description).replace(/\{\{\s*char\s*\}\}/gi, card.name))
  return {
    name: card.name,
    title: card.title,
    creator: card.creator,
    tags: [...new Set(card.tags)],
    notes: shorten(notes, NOTES_LENGTH),
    greetings: card.greetings.length,
    lore: card.lore.length,
    systemPrompt: Boolean(card.systemPrompt),
    hash: fingerprint(value),
  }
}

/**
 * Text written for a web page, as plain text. Creators' notes are HTML or
 * markdown as often as not, with pictures, links and styles in them, and none
 * of that is shown here: only what they say.
 *
 * @param {string} value
 * @returns {string}
 */
export function plainText(value) {
  if (!value) return ''
  return (
    value
      .replace(/<(style|script)\b[\s\S]*?<\/\1\s*>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)\s*>/gi, '\n')
      .replace(/<[^>]*>/g, '')
      // Markdown pictures go, and links keep their words.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&apos;/gi, "'")
      .replace(/&amp;/gi, '&')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  )
}

/**
 * At most `length` characters, cut at a word.
 *
 * @param {string} value
 * @param {number} length
 * @returns {string}
 */
function shorten(value, length) {
  if (value.length <= length) return value
  const cut = value.slice(0, length)
  const space = cut.lastIndexOf(' ')
  return `${(space > length / 2 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/**
 * A tag as it is compared: without case, and with underscores read as the
 * spaces they stand for, as the sites that tag cards write them both ways.
 *
 * @param {string} tag
 * @returns {string}
 */
export function tagKey(tag) {
  return tag.toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * A tag as it is shown: its underscores as spaces.
 *
 * @param {string} tag
 * @returns {string}
 */
export function tagLabel(tag) {
  return tag.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The tags that mark a card not safe to look at everywhere: `nsfw`, as the
 * sites that share cards write it in any case, and `nsfl`.
 */
const NSFW_TAGS = new Set(['nsfw', 'nsfl'])

/**
 * Whether a card is tagged NSFW or NSFL, so its picture may be blurred.
 *
 * @param {Pick<LibraryCard, 'tags'>} card
 * @returns {boolean}
 */
export function isNsfw(card) {
  return card.tags.some(tag => NSFW_TAGS.has(tagKey(tag)))
}

/** A word of the search that names a tag: `tag:female`. */
const TAG_WORD = /^tag:/i

/**
 * A search as typed, in its parts: the words to find, and the tags its
 * `tag:` words name.
 *
 * @param {string} query
 * @returns {{words: string[], tags: string[]}}
 */
export function parseSearch(query) {
  const tokens = query.split(/\s+/).filter(Boolean)
  return {
    words: tokens.filter(token => !TAG_WORD.test(token)).map(token => token.toLowerCase()),
    tags: tokens
      .filter(token => TAG_WORD.test(token))
      .map(token => token.replace(TAG_WORD, ''))
      .filter(Boolean),
  }
}

/**
 * Whether a card is one the writer is looking for: every word of the search
 * somewhere in its names, creator or tags, and every tag chosen, or named in
 * the search with `tag:`, among its tags. None of it cares about case.
 *
 * @param {LibraryCard} card
 * @param {string} query
 * @param {string[]} [tags]
 * @returns {boolean}
 */
export function cardMatches(card, query, tags = []) {
  const search = parseSearch(query)
  const own = new Set(card.tags.map(tagKey))
  if (![...tags, ...search.tags].every(tag => own.has(tagKey(tag)))) return false
  if (search.words.length === 0) return true
  const haystack = [card.name, card.title, card.creator, ...card.tags, ...card.tags.map(tagLabel)]
    .join('\n')
    .toLowerCase()
  return search.words.every(word => haystack.includes(word))
}

/**
 * The library's tags, each once however it was written, with how many cards
 * have it, most used first. Each is shown as it was first written.
 *
 * @param {LibraryCard[]} cards
 * @returns {Array<{tag: string, count: number}>}
 */
export function tagCounts(cards) {
  /** @type {Map<string, {tag: string, count: number}>} */
  const counts = new Map()
  for (const card of cards) {
    for (const key of new Set(card.tags.map(tagKey).filter(Boolean))) {
      const seen = counts.get(key)
      if (seen) seen.count++
      else counts.set(key, { tag: card.tags.find(tag => tagKey(tag) === key) || key, count: 1 })
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/**
 * The tags to offer for a word being typed in the search: those that start
 * with it first, then those that have it anywhere, the most used first in
 * each, leaving out the tags already chosen.
 *
 * @param {LibraryCard[]} cards
 * @param {string} word - What has been typed of it, without `tag:`
 * @param {string[]} chosen
 * @param {number} limit
 * @returns {Array<{tag: string, count: number}>}
 */
export function suggestTags(cards, word, chosen, limit) {
  const typed = tagKey(word)
  const taken = new Set(chosen.map(tagKey))
  const open = tagCounts(cards).filter(entry => !taken.has(tagKey(entry.tag)))
  if (!typed) return open.slice(0, limit)
  const starts = open.filter(entry => tagKey(entry.tag).startsWith(typed))
  const within = open.filter(
    entry => !tagKey(entry.tag).startsWith(typed) && tagKey(entry.tag).includes(typed)
  )
  return [...starts, ...within].slice(0, limit)
}

/**
 * The cards in an order: the newest first, by name, or the most recently used
 * in a project first, with those never used after them, newest first.
 *
 * @param {LibraryCard[]} cards
 * @param {CardOrder} order
 * @returns {LibraryCard[]}
 */
export function sortCards(cards, order) {
  const byName = (/** @type {LibraryCard} */ a, /** @type {LibraryCard} */ b) =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  const sorted = [...cards]
  if (order === 'name') return sorted.sort(byName)
  if (order === 'used') {
    return sorted.sort((a, b) => (b.used || 0) - (a.used || 0) || b.added - a.added)
  }
  return sorted.sort((a, b) => b.added - a.added || byName(a, b))
}

/**
 * The tags the library uses most, most used first.
 *
 * @param {LibraryCard[]} cards
 * @param {number} limit
 * @returns {string[]}
 */
export function commonTags(cards, limit) {
  return tagCounts(cards)
    .slice(0, limit)
    .map(entry => entry.tag)
}

/**
 * The files added to the library that held no card, said plainly: the one
 * part of adding the library shows nowhere else.
 *
 * @param {string[]} skipped - Their names
 * @returns {string}
 */
export function describeSkipped(skipped) {
  if (skipped.length === 1) return `${skipped[0]} has no character card in it.`
  if (skipped.length > 1) return `${skipped.length} files have no character card in them.`
  return ''
}

/**
 * A card as a file to hand back: the PNG it came in, which carries it whole,
 * or its JSON when it came without a picture. Named for what it is known by.
 *
 * @param {LibraryCard} card
 * @param {CardFile} file
 * @returns {{blob: Blob, filename: string}}
 */
export function cardDownload(card, file) {
  const name = safeName(card.title)
  if (file.image) return { blob: file.image, filename: `${name}.png` }
  return {
    blob: new Blob([JSON.stringify(file.card, null, 2)], { type: 'application/json' }),
    filename: `${name}.json`,
  }
}
