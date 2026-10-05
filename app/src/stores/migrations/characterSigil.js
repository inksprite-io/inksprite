/**
 * @module stores/migrations/characterSigil
 * @description Say on the record which command messages are people.
 *
 * A character used to be a `/name` that nothing answered to, so whether a
 * stored record was a person could be worked out by looking: if no command had
 * that name, it was somebody. They are written `@emily` now, and the record
 * says so itself.
 *
 * That is the part worth migrating for. Working it out from the name is only
 * right until the command list changes — add a `/summon` next year and every
 * `@summon` written this year quietly becomes a command record. A record that
 * says what it is cannot be reinterpreted by anything added after it.
 *
 * The commands as of version 10 are named here rather than imported, for the
 * same reason: this transform is a statement about what was true then.
 *
 * Pure, like the migrations before it, so the Dexie upgrade hook and backup
 * restore share one transform.
 */

/** @typedef {import('../../types/models.js').Message} Message */

/** Everything `/` answered to, as of schema 10. */
const COMMANDS = new Set(['compact', 'director', 'interpret', 'oracle', 'roll'])

/**
 * Mark every stored command that was a character as one.
 *
 * Idempotent: a record that already says which it is keeps what it says, so a
 * retried upgrade or a backup taken after this one restores unchanged.
 *
 * @param {Message[]} messages
 * @returns {{messages: Message[], marked: number}}
 */
export function markCharacters(messages) {
  let marked = 0

  const out = (messages || []).map(message => {
    const command = message?.metadata?.command
    if (!command || 'character' in command) return message
    if (COMMANDS.has((command.name || '').toLowerCase())) return message

    marked++
    return {
      ...message,
      metadata: {
        ...message.metadata,
        command: { ...command, character: /** @type {const} */ (true) },
      },
    }
  })

  return { messages: out, marked }
}
