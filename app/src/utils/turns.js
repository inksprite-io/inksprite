/**
 * @module utils/turns
 * @description Fold a chat's messages into the turns they are.
 *
 * A turn is normally one message: the writer's, holding everything they wrote
 * and rolled as its segments; the assistant's, holding what it said. The same
 * side can still speak twice in a row — a reply that failed or was deleted and
 * then more written under it, or a paragraph pushed after a generated one — and
 * `mergeAdjacentTurns` in ai/context/build.js sends that run as one turn,
 * because that is what it is to the model.
 *
 * This is the same fold for the reader. Two boxes in a row under one name say
 * the writer spoke twice; one box holding both says what actually happened, and
 * matches what the model is being told.
 *
 * @typedef {import('../types/models.js').Message} Message
 */

/**
 * @typedef {Object} Turn
 * @property {string} id - The first message's id, which is stable enough to key on
 * @property {'user'|'assistant'} role - Whose turn it is
 * @property {string} [command] - The command that answered, when the turn is one
 *   rather than something anybody said
 * @property {Message[]} messages - What it was taken in, in order
 * @property {boolean} compacted - Whether a summary now stands in for it
 */

/**
 * Which voice a message is in, which is not quite its role.
 *
 * A command that takes a turn of its own — `/compact` — is stored as an
 * assistant message, because that is what it is; but it is not the Game Master,
 * and folding a summary into the narration after it would put one name over two
 * different things. The writer's own commands are the opposite case: an oracle
 * belongs in the turn it was rolled in, beside the sentence it settles, as a
 * piece of that message.
 *
 * @param {Message} message
 * @returns {string|undefined}
 */
function commandOf(message) {
  return message.role === 'assistant' ? message.metadata?.command?.name : undefined
}

/**
 * Group a conversation into turns.
 *
 * A turn is never half replaced by a summary: where what the summaries stand
 * for begins and ends, a turn ends too, so the line drawn there falls between
 * turns and the opening a summary kept is not folded into what came after it.
 *
 * @param {Message[]} messages - The conversation in order
 * @param {Set<number>} [covered] - Which of them a summary stands in for, by
 *   position. See `compactionCover` in ai/compaction.js.
 * @returns {Turn[]}
 */
export function groupTurns(messages, covered = new Set()) {
  /** @type {Turn[]} */
  const turns = []

  ;(messages || []).forEach((message, index) => {
    const compacted = covered.has(index)
    const command = commandOf(message)
    const open = turns[turns.length - 1]

    if (
      open &&
      open.role === message.role &&
      open.command === command &&
      open.compacted === compacted
    ) {
      open.messages.push(message)
      return
    }

    turns.push({ id: message.id, role: message.role, command, compacted, messages: [message] })
  })

  return turns
}

/**
 * Where the lines go that say a summary has taken over, and what each says.
 *
 * One under the run of turns a summary stands in for, which is above the
 * summary that stands in for them. A chat compacted three times still has one:
 * the newest summary stands for everything above it, the two before it
 * included, so they are in the run rather than closing runs of their own.
 *
 * @param {Turn[]} turns
 * @returns {Map<number, number>} For each turn a line goes above, how many
 *   messages were in the run it closes
 */
export function compactedRuns(turns) {
  /** @type {Map<number, number>} */
  const runs = new Map()

  let run = 0
  turns.forEach((turn, at) => {
    if (turn.compacted) {
      run += turn.messages.length
      return
    }
    if (run > 0) runs.set(at, run)
    run = 0
  })

  return runs
}

/**
 * How many lines text takes in a column `perLine` characters wide: each of its
 * lines wrapped, and a line's worth for each break between paragraphs, which
 * is about what the space between them comes to. What a turn's height is
 * guessed from until it has had one; see composables/useNearTurns.js.
 *
 * @param {string} text
 * @param {number} perLine - Characters that fit across the column
 * @returns {number}
 */
export function textLines(text, perLine) {
  let lines = 0
  for (const line of text.split('\n')) {
    if (line.trim()) lines += Math.ceil(line.length / perLine)
  }
  return lines + (text.match(/\n\s*\n/g) || []).length
}
