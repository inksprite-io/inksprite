/* global TextEncoder */

/**
 * A chat as two files in the project's `.inksprite/chats/`: its row as
 * `<id>.json`, and its messages as `<id>.jsonl`, one to a line, in the order
 * they were made.
 *
 * A chat can run to tens of megabytes, and while a reply streams in it is
 * saved every half second, so the messages are not rewritten whole when
 * only the end of them changed: a new message is added at the end, and the
 * one being written over and over is written again where it starts. Only a
 * change further back, an edit or a summary put above earlier turns,
 * rewrites the file. The row changes on every turn, so it is a file of its
 * own and small.
 */

import { META } from './layout.js'

/** @typedef {import('../types/models.js').Chat} Chat */
/** @typedef {import('../types/models.js').Message} Message */

const encoder = new TextEncoder()

/** @param {string} id */
export const chatPath = id => `${META}/chats/${id}.json`

/** @param {string} id */
export const messagesPath = id => `${META}/chats/${id}.jsonl`

/**
 * @param {Chat} chat
 * @returns {string}
 */
export const chatText = chat => `${JSON.stringify(chat, null, 2)}\n`

/**
 * A chat's row from its file, or null when it cannot be read.
 *
 * @param {string} text
 * @returns {Chat|null}
 */
export function readChat(text) {
  try {
    const chat = JSON.parse(text)
    return chat && typeof chat.id === 'string' ? chat : null
  } catch {
    return null
  }
}

/**
 * Messages in the order a chat file keeps them: as made, and by id where
 * two were made in the same millisecond.
 *
 * @param {Message[]} messages
 * @returns {Message[]}
 */
export function inFileOrder(messages) {
  return messages
    .slice()
    .sort((a, b) => a.created - b.created || (a.id > b.id ? 1 : a.id < b.id ? -1 : 0))
}

/**
 * @param {Message} message
 * @returns {string} Its line, ending with its newline
 */
export const messageLine = message => `${JSON.stringify(message)}\n`

/**
 * What is in a chat's messages file, as far as writing it again goes: whose
 * each line is, when it was made, and how long it is, in bytes.
 *
 * @typedef {Object} MessageLines
 * @property {string[]} ids
 * @property {number[]} created
 * @property {number[]} sizes
 */

/** @returns {MessageLines} */
const noLines = () => ({ ids: [], created: [], sizes: [] })

/**
 * The lines these messages make, in file order.
 *
 * @param {Message[]} messages - In file order
 * @returns {{text: string, lines: MessageLines}}
 */
export function messagesText(messages) {
  const lines = noLines()
  let text = ''
  for (const message of messages) {
    const line = messageLine(message)
    text += line
    lines.ids.push(message.id)
    lines.created.push(message.created)
    lines.sizes.push(encoder.encode(line).length)
  }
  return { text, lines }
}

/**
 * A messages file read: its messages, and its lines for the next write. A
 * line that cannot be read, the end of one a stop cut short, is passed over.
 *
 * @param {string} text
 * @returns {{messages: Message[], lines: MessageLines}}
 */
export function readMessages(text) {
  /** @type {Message[]} */
  const messages = []
  const lines = noLines()
  let start = 0
  while (start < text.length) {
    const end = text.indexOf('\n', start)
    if (end < 0) break
    const line = text.slice(start, end + 1)
    start = end + 1
    try {
      const message = JSON.parse(line)
      if (!message || typeof message.id !== 'string') continue
      messages.push(message)
      lines.ids.push(message.id)
      lines.created.push(message.created)
      lines.sizes.push(encoder.encode(line).length)
    } catch {
      // Not a line of ours.
    }
  }
  return { messages, lines }
}

/** @param {{id: string, created: number}} a @param {{id: string, created: number}} b */
const before = (a, b) => a.created < b.created || (a.created === b.created && a.id < b.id)

/**
 * How to write a chat's messages, from what its file holds and what changed.
 *
 * - `append` - Write `text` from byte `at` on, and end the file there: the
 *   lines before `at` stay as they are. For new messages at the end, and
 *   the last one written again.
 * - `rewrite` - Anything further back: the file is to be read, changed and
 *   written whole (`mergeMessages`).
 *
 * A read passes over a line it cannot read, so a stop partway through an
 * append leaves the lines before it, and a whole write is made whole or not
 * at all.
 *
 * @param {MessageLines|null} previous - What the file holds; null when there is no file
 * @param {Message[]} puts - Messages new or changed
 * @param {Iterable<string>} deleted - Messages gone
 * @returns {{op: 'append', at: number, text: string, lines: MessageLines}|{op: 'rewrite'}|null}
 *   Null when nothing changed
 */
export function planMessages(previous, puts, deleted) {
  const held = previous || noLines()
  const place = new Map(held.ids.map((id, at) => [id, at]))
  const gone = [...deleted].filter(id => place.has(id))
  if (puts.length === 0 && gone.length === 0) return null

  // The first line that changes; every line from there on is written again.
  let first = held.ids.length
  for (const id of gone) first = Math.min(first, /** @type {number} */ (place.get(id)))
  for (const message of puts) {
    if (place.has(message.id))
      first = Math.min(first, /** @type {number} */ (place.get(message.id)))
  }
  if (first < held.ids.length - 1) return { op: 'rewrite' }

  const goneIds = new Set(gone)
  const tail = inFileOrder(puts.filter(message => !goneIds.has(message.id)))
  // What is written must still come after the lines it is written behind.
  if (first > 0 && tail.length > 0) {
    const last = { id: held.ids[first - 1], created: held.created[first - 1] }
    if (!before(last, tail[0])) return { op: 'rewrite' }
  }

  const at = held.sizes.slice(0, first).reduce((sum, size) => sum + size, 0)
  const written = messagesText(tail)
  return {
    op: 'append',
    at,
    text: written.text,
    lines: {
      ids: [...held.ids.slice(0, first), ...written.lines.ids],
      created: [...held.created.slice(0, first), ...written.lines.created],
      sizes: [...held.sizes.slice(0, first), ...written.lines.sizes],
    },
  }
}

/**
 * A chat's messages with these changes made, in file order.
 *
 * @param {Message[]} messages
 * @param {Message[]} puts
 * @param {Iterable<string>} deleted
 * @returns {Message[]}
 */
export function mergeMessages(messages, puts, deleted) {
  const gone = new Set(deleted)
  /** @type {Map<string, Message>} */
  const byId = new Map(messages.map(message => [message.id, message]))
  for (const message of puts) byId.set(message.id, message)
  for (const id of gone) byId.delete(id)
  return inFileOrder([...byId.values()])
}
