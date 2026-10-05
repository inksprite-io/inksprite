/**
 * @module stores/migrations/turnSegments
 * @description Fold a turn's messages into the one message it always was.
 *
 * A submission used to be stored as one message per thing it contained — the
 * oracle, the sentence, the direction after it — and both ends put it back
 * together: the UI grouped the run and `mergeAdjacentTurns` joined it before it
 * went to the model. Nothing was gained by the split; a command record needed a
 * row and a message was the row that existed.
 *
 * So a run of the writer's messages becomes one message holding them as
 * segments, and its content becomes what the model was already being sent. A
 * message somebody else spoke is left alone — a consultation is one speaker
 * saying one thing, and has nothing to hold segments for.
 *
 * The tags are rewritten here rather than imported, and the tag `/compact`
 * answers under is named below, because this transform is a statement about
 * what version 11 was. A command added later cannot change what these rows
 * meant when they were written.
 *
 * Pure, like the migrations before it, so the Dexie upgrade hook and backup
 * restore share one transform.
 */

/** @typedef {import('../../types/models.js').Message} Message */

/** The commands whose record renders under a different name, as of schema 11. */
const TAGS = { compact: 'summary' }

/**
 * The block a command was already being sent as. See ai/commands.js.
 *
 * @param {any} command
 * @returns {string}
 */
function renderCommand(command) {
  const body = [command.label, command.result].filter(Boolean).join('\n')
  const tag = (command.character ? null : TAGS[String(command.name).toLowerCase()]) || command.name
  return `<${tag}>\n${body}\n</${tag}>`
}

/**
 * What one old message contributes to the turn it was part of.
 *
 * @param {any} message
 * @returns {any|null}
 */
function segmentOf(message) {
  const command = message.metadata?.command
  if (command) return { type: 'command', command }
  return message.content ? { type: 'text', content: message.content } : null
}

/**
 * Fold each run of the writer's messages into one.
 *
 * Idempotent: a message that already carries segments is a turn that has been
 * folded, and it neither folds again nor joins the run beside it.
 *
 * Deleted messages are left exactly where they are. They are already invisible
 * to everything that reads a chat, and a run either side of one was always
 * being read as a single run anyway.
 *
 * @param {Message[]} messages
 * @returns {{messages: Message[], folded: number}}
 */
export function foldTurns(messages) {
  /** @type {Map<string, Message[]>} */
  const byChat = new Map()
  /** @type {Message[]} */
  const untouched = []

  for (const message of messages || []) {
    // Rows from before v17 may still carry the old soft-delete flag.
    if (!message?.chatId || /** @type {any} */ (message).deleted) {
      untouched.push(message)
      continue
    }
    if (!byChat.has(message.chatId)) byChat.set(message.chatId, [])
    byChat.get(message.chatId).push(message)
  }

  /** @type {Message[]} */
  const out = [...untouched]
  let folded = 0

  for (const chat of byChat.values()) {
    // The order the app reads them in, which is the order they were written.
    const history = [...chat].sort((a, b) => a.created - b.created)

    /** @type {Message[]} */
    let run = []

    const close = () => {
      if (run.length === 0) return

      const segments = run.map(segmentOf).filter(Boolean)
      const [first] = run

      if (run.length > 1 || segments.some(segment => segment.type === 'command')) folded++

      out.push({
        ...first,
        segments,
        // What the run was already being sent as: every message rendered, and
        // joined the way mergeAdjacentTurns joined them.
        content: segments
          .map(segment =>
            segment.type === 'command'
              ? segment.command.label || segment.command.result
                ? renderCommand(segment.command)
                : ''
              : segment.content
          )
          .filter(Boolean)
          .join('\n\n'),
      })
      run = []
    }

    for (const message of history) {
      if (message.role === 'user' && !message.segments) {
        run.push(message)
        continue
      }
      close()
      out.push(message)
    }

    close()
  }

  return { messages: out, folded }
}
