/**
 * @module stores/migrations/summariesInPlace
 * @description Move each summary to where it is read.
 *
 * A summary used to be stored where it was asked for, at the end of the chat,
 * carrying a count of the turns before it that it left alone. The reader did
 * the rest: it found the summary, counted back, and hoisted it over the turns
 * it kept. So what the writer saw, what the model was sent, and what a fork or
 * a rewind cut by were three different orders, and the count had to be brought
 * down whenever a message was deleted from among the ones it counted.
 *
 * Now a summary is stored above the turns it kept, and where it sits is what
 * says what it stands for. See ai/compaction.js. This brings what was already
 * stored up to that: each summary is given a time between the last message it
 * stood for and the first it kept.
 *
 * What is read changes in one way, on purpose. Only the newest summary used to
 * apply, and an older one went with everything else above it — so a game
 * compacted twice had lost its first session altogether. Every summary is read
 * now, and the older ones come back.
 *
 * Frozen at what version 15 meant by all of this, like the transforms before
 * it: how the app reads a summary can change later without changing what these
 * rows were.
 */

/** @typedef {import('../../types/models.js').Message} Message */

/**
 * Whether this was a summary that stood in for anything, as of schema 14.
 *
 * @param {Message} message
 * @returns {boolean}
 */
function stoodFor(message) {
  const command = message?.metadata?.command
  return Boolean(
    command && command.name === 'compact' && typeof command.keep === 'number' && command.result
  )
}

/**
 * One chat's messages, with its summaries where they are read.
 *
 * @param {Message[]} history - The chat in order
 * @returns {{rows: Message[], moved: number}}
 */
function placeChat(history) {
  // Where each summary belongs: above the first turn it kept. One that kept
  // more than there was stood for nothing, and goes under the opening, where it
  // still stands for nothing — left at the end it would now stand for the
  // whole chat.
  /** @type {Map<string, number>} */
  const targets = new Map()
  history.forEach((message, at) => {
    if (!stoodFor(message)) return
    const to = Math.max(at - message.metadata.command.keep, 1)
    if (to < at) targets.set(message.id, to)
  })
  if (targets.size === 0) return { rows: history, moved: 0 }

  // Above the first message from there on that is staying where it is. Going by
  // the message rather than the position keeps two summaries in the order they
  // were written when they land in the same place.
  /** @type {Message[]} */
  const order = history.filter(message => !targets.has(message.id))
  /** @type {Set<string>} */
  const moved = new Set()

  for (const [at, message] of history.entries()) {
    const to = targets.get(message.id)
    if (to === undefined) continue

    const anchor = history.slice(to, at).find(other => !targets.has(other.id))
    if (anchor) {
      order.splice(order.indexOf(anchor), 0, message)
      moved.add(message.id)
      continue
    }

    // Nothing between there and here but other summaries on the move, so there
    // is nothing to put it above. It goes back where it was: under whatever
    // was last above it.
    const above = history
      .slice(0, at)
      .reverse()
      .find(other => order.includes(other))
    order.splice(above ? order.indexOf(above) + 1 : 0, 0, message)
  }

  // A time between its new neighbours', shared out evenly where more than one
  // summary landed in the same gap.
  const rows = order.map(message => ({ ...message }))
  for (let at = 0; at < rows.length; at++) {
    if (!moved.has(rows[at].id)) continue

    let end = at
    while (end < rows.length && moved.has(rows[end].id)) end++

    const below = rows[end].created
    const from = rows[at - 1]?.created ?? below - 1
    for (let i = at; i < end; i++) {
      rows[i].created = from + ((below - from) * (i - at + 1)) / (end - at + 1)
    }
    at = end - 1
  }

  return { rows, moved: moved.size }
}

/**
 * Move every summary to where it is read.
 *
 * Deleted messages are left exactly where they are, and are not counted among
 * the turns a summary kept: they were invisible to the reader that did the
 * counting.
 *
 * @param {Message[]} messages - Every message, in any order
 * @returns {{messages: Message[], moved: number}} The rows that changed, and
 *   how many summaries moved
 */
export function summariesIntoPlace(messages) {
  /** @type {Map<string, Message[]>} */
  const chats = new Map()
  for (const message of messages) {
    // Rows from before v17 may still carry the old soft-delete flag.
    if (!message || /** @type {any} */ (message).deleted) continue
    const chat = chats.get(message.chatId) || []
    chat.push(message)
    chats.set(message.chatId, chat)
  }

  /** @type {Message[]} */
  const changed = []
  let moved = 0

  for (const chat of chats.values()) {
    const history = [...chat].sort((a, b) => a.created - b.created)
    const placed = placeChat(history)
    if (placed.moved === 0) continue

    const was = new Map(history.map(message => [message.id, message.created]))
    changed.push(...placed.rows.filter(message => message.created !== was.get(message.id)))
    moved += placed.moved
  }

  return { messages: changed, moved }
}
