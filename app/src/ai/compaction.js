/**
 * @module ai/compaction
 * @description Compaction: the conversation, minus the part it can afford to
 * remember in summary.
 *
 * A long game outgrows the window it is played in. What it outgrows it with is
 * mostly the middle — forty turns of travel and small talk that matter to the
 * story as a paragraph and cost as much as the scene being played right now.
 * So a summary is written and stands in for them.
 *
 * Nothing is deleted. The summary is a message like any other, and the
 * conversation it replaces stays in the chat where the writer can read it. That
 * is not politeness about their prose: a compaction is a guess about what will
 * matter later, and a guess that throws away its own evidence cannot be
 * revised.
 *
 * **The summary sits where it is read.** Asked for at the end of a chat, it is
 * put above the last few turns rather than below them, because that is where
 * the model reads it: what it stands for came before those turns, so it has to
 * be read before them. Stored there rather than only shown there, so that the
 * order the writer sees, the order the model is sent, and the order a fork or a
 * rewind cuts by are one order.
 *
 * So there is no range to keep track of. What the model reads of a compacted
 * conversation is:
 *
 * - how it opened, word for word. The first message of a roleplay is a
 *   character's greeting, which sets voice, tense, length and formatting by
 *   example, and a summary of it says what happened in it — the one thing about
 *   it that did not matter;
 * - the newest summary;
 * - everything after it.
 *
 * Everything else above the newest summary is what it stands for, the summaries
 * before it included. **Each summary is written over the last.** A long game
 * is compacted many times, and summaries that were each kept would add up: the
 * first session told at the length it was given when it was the whole of the
 * past, and nine more after it, until the account of the past cost what the
 * past had. So a new summary is written from the one before it and the turns
 * since, and its prompt asks it to carry the old one forward — at the length
 * the past is worth now, not the length it was worth then. One account, however
 * many times the chat has been compacted.
 *
 * That is a retelling, and a retelling can lose or bend something. What checks
 * it is the writer: every summary is still in the chat, and one that got the
 * story wrong can be asked for again or put right by hand. And since only the
 * newest is read, deleting it hands the model the one before it and the turns
 * that one stood for — a compaction taken back. Deleting an older one changes
 * nothing the model reads.
 *
 * **A summary is written over the conversation as the model has it.** The
 * opening, the summary before it, and everything since — the turns it will sit
 * above included. Those are kept so the next turn has a scene to continue
 * rather than an account of one, not because the summary leaves them out.
 *
 * This module is the whole idea and none of the plumbing: what a compaction is,
 * and how a history reads once there is one. The skill that writes a summary
 * is ai/skills/compact, running it is ai/commands.js, and the reader that has
 * to obey it is ai/context/build.js — all of which import this, which is why
 * it imports none of them.
 */

/** @typedef {import('../types/models.js').Message} Message */

/** The command that writes one, and the tag its record is stored under. */
export const COMPACT_COMMAND = 'compact'

/**
 * How many turns a compaction sits above by default.
 *
 * None. A compaction folds in everything, and the writer who wants the scene
 * being played to stay verbatim asks for it: `/compact(4)` keeps two exchanges
 * under the summary.
 */
export const DEFAULT_KEEP = 0

/**
 * How much of the top of a conversation no summary stands in for.
 *
 * One message, always, and not the writer's to say yet: how a chat opens is a
 * fact about the chat, and nobody should have to remember to protect a greeting
 * every time they compact.
 */
export const KEPT_OPENING = 1

/**
 * How many turns a compaction was asked to sit above.
 *
 * @param {string|number} [raw] - What the writer typed, if they typed one
 * @returns {number|null} The count, or null if what they typed is not one
 */
export function parseKeep(raw) {
  if (raw === undefined || raw === null || raw === '') return DEFAULT_KEEP

  const keep = Number(raw)
  if (!Number.isInteger(keep) || keep < 0) return null
  return keep
}

/**
 * Whether this message is a summary being written: asked for, or asked for
 * again, and not yet answered or failed.
 *
 * Its record says so rather than its clock, because a summary that failed
 * halfway never finished streaming either.
 *
 * @param {Message} message
 * @returns {boolean}
 */
export function isCompacting(message) {
  const command = message?.metadata?.command
  return Boolean(command && command.name === COMPACT_COMMAND && command.pending)
}

/**
 * Whether this message is a summary that stands in for anything.
 *
 * One that is still being written, or that failed, is not: it has no text to
 * stand in with, and dropping forty turns in favour of an empty block would
 * lose the conversation to a failed request.
 *
 * @param {Message} message
 * @returns {boolean}
 */
export function isCompaction(message) {
  const command = message?.metadata?.command
  return Boolean(command && command.name === COMPACT_COMMAND && command.result)
}

/**
 * Which messages the newest summary in a history stands in for, by where they
 * are.
 *
 * Everything above it that is not the opening — the summaries before it
 * included, which it was written from. By position rather than by id, because
 * what calls this has the history in its hands and wants to mark it, not look
 * things up in it.
 *
 * @param {Message[]} history - The conversation in order
 * @returns {Set<number>} Empty when nothing has been compacted
 */
export function compactionCover(history) {
  /** @type {Set<number>} */
  const covered = new Set()

  let newest = -1
  for (let i = history.length - 1; i >= 0 && newest === -1; i--) {
    if (isCompaction(history[i])) newest = i
  }

  for (let i = KEPT_OPENING; i < newest; i++) covered.add(i)

  return covered
}

/**
 * The conversation as its summaries leave it: what the model is sent.
 *
 * @param {Message[]} history - The conversation in order
 * @returns {Message[]} A new array, or the same one when nothing is compacted
 */
export function applyCompaction(history) {
  const covered = compactionCover(history)
  if (covered.size === 0) return history

  return history.filter((_, at) => !covered.has(at))
}

/**
 * Where a summary asked for from the middle of a chat can sit: the first
 * message it can go above and still have something to stand in for.
 *
 * Below the opening, and below the newest summary with at least one turn
 * between them — a summary sat straight under the last has nothing new to fold
 * in, and one above it would be read as nothing at all, since only the newest
 * is. "Summarize up to here" is `/compact` keeping everything from a message
 * on, so it is offered from here down.
 *
 * @param {Message[]} history - The conversation in order
 * @returns {number} An index; the length of the history or more when there is nowhere
 */
export function firstSummarizable(history) {
  let newest = -1
  for (let i = history.length - 1; i >= 0 && newest === -1; i--) {
    if (isCompaction(history[i])) newest = i
  }

  return Math.max(KEPT_OPENING, newest + 1) + 1
}
