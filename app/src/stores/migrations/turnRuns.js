/**
 * @module stores/migrations/turnRuns
 * @description Fold a run of the writer's messages into the one turn it is.
 *
 * Version 11 folded each submission into one message. A turn could still come
 * to be held in two: one pushed in without a reply and more written under it,
 * or the reply between two of them deleted. Both ends went on putting the run
 * back together — the UI grouped it, `mergeAdjacentTurns` joined it — and the
 * app now keeps the writer's turn one message as it goes (see
 * composables/useChatCommands.js). This brings what was already stored up to
 * that.
 *
 * A summary is honoured the way the reader honours it: a run never spans the
 * point where a summary takes over, and a summary that counted the messages it
 * left alone counts one fewer for each that folded into another among them.
 *
 * Frozen at what version 12 meant by all of this, like the transforms before
 * it: how the app reads a turn or a summary can change later without changing
 * what these rows were.
 */

/** @typedef {import('../../types/models.js').Message} Message */

/**
 * Where the last summary in a chat cuts it, as of schema 12. See
 * ai/compaction.js.
 *
 * @param {Message[]} history - The chat in order
 * @returns {{index: number, cut: number}|null} Where the summary sits, and how
 *   many messages from the start it stands for
 */
function cutOf(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    const command = history[i].metadata?.command
    if (!command || command.name !== 'compact') continue
    if (typeof command.keep !== 'number' || !command.result) continue
    const cut = i - command.keep
    return cut > 0 ? { index: i, cut } : null
  }
  return null
}

/**
 * What a message of the writer's is made of. Every one has carried its pieces
 * since schema 11; one that somehow does not is its content, as one piece.
 *
 * @param {any} message
 * @returns {any[]}
 */
function piecesOf(message) {
  if (Array.isArray(message.segments)) return message.segments
  return message.content ? [{ type: 'text', content: message.content }] : []
}

/**
 * Fold every run of the writer's messages in a chat into one message each.
 *
 * @param {Message[]} history - The chat in order
 * @returns {{rows: Message[], folded: number}} The chat with its runs folded,
 *   and how many were
 */
function foldChat(history) {
  const found = cutOf(history)
  const cut = found?.cut || 0

  /** @type {Message[]} */
  const rows = []
  /** @type {Array<{message: Message, at: number}>} */
  let run = []
  let folded = 0
  // Messages folded away from among those the summary left alone.
  let spent = 0

  const close = () => {
    if (run.length < 2) {
      rows.push(...run.map(({ message }) => message))
      run = []
      return
    }

    const [{ message: first }, ...rest] = run
    rows.push({
      ...first,
      segments: run.flatMap(({ message }) => piecesOf(message)),
      // What the run was already being sent as: each message's content, joined
      // the way mergeAdjacentTurns joined them.
      content: run
        .map(({ message }) => message.content)
        .filter(Boolean)
        .join('\n\n'),
      ...(run.some(({ message }) => message.edited) ? { edited: true } : {}),
    })
    folded++
    if (found) spent += rest.filter(({ at }) => at >= cut && at < found.index).length
    run = []
  }

  history.forEach((message, at) => {
    const theirs = message.role === 'user' && !message.metadata?.command
    // A run never crosses the point where a summary takes over.
    const joins = theirs && run.length > 0 && run[0].at < cut === at < cut
    if (!joins) close()
    if (theirs) run.push({ message, at })
    else rows.push(message)
  })
  close()

  if (spent > 0) {
    const summary = rows.find(message => message.id === history[found.index].id)
    const command = summary.metadata.command
    Object.assign(summary, {
      metadata: { ...summary.metadata, command: { ...command, keep: command.keep - spent } },
    })
  }

  return { rows, folded }
}

/**
 * Fold each run of the writer's messages into one.
 *
 * Deleted messages are left exactly where they are. They are already invisible
 * to everything that reads a chat, and a run either side of one was always
 * being read as a single run anyway.
 *
 * @param {Message[]} messages
 * @returns {{messages: Message[], folded: number}}
 */
export function foldRuns(messages) {
  /** @type {Map<string, Message[]>} */
  const byChat = new Map()
  /** @type {Message[]} */
  const out = []
  let folded = 0

  for (const message of messages || []) {
    // Rows from before v17 may still carry the old soft-delete flag.
    if (!message?.chatId || /** @type {any} */ (message).deleted) {
      out.push(message)
      continue
    }
    if (!byChat.has(message.chatId)) byChat.set(message.chatId, [])
    byChat.get(message.chatId).push(message)
  }

  for (const chat of byChat.values()) {
    // The order the app reads them in, which is the order they were written.
    const { rows, folded: count } = foldChat([...chat].sort((a, b) => a.created - b.created))
    out.push(...rows)
    folded += count
  }

  return { messages: out, folded }
}
