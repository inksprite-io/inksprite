/**
 * @module stores/migrations/commandInput
 * @description Give a stored slash command its input back as a sentence.
 *
 * Commands used to be typed as quoted words — `/oracle "Is the door locked?"
 * likely` — and a run kept what it was given as the token list it arrived as.
 * They are typed as a line now, with the second thing in parentheses, so a
 * record holds `input` and `param` instead of `args`.
 *
 * Every command that ever shipped took its arguments in that order, question
 * first, so the transform is the same one for all of them: the first token is
 * what was asked, the second is the setting it was asked under.
 *
 * Pure, like the migrations before it, so the Dexie upgrade hook and backup
 * restore share one transform.
 */

/** @typedef {import('../../types/models.js').Message} Message */
/**
 * A command as it may still be stored: the token list is gone from the type,
 * but not from anybody's database.
 *
 * @typedef {Omit<import('../../types/models.js').ChatCommand, 'input'> & {input?: string, args?: string[]}} StoredCommand
 */

/**
 * Rewrite `metadata.command.args` as `input` and `param`.
 *
 * Idempotent: a command that already carries `input` is left as it is, so a
 * retried upgrade or a backup taken after this one restores unchanged. So is a
 * message that never held a command, which is nearly all of them.
 *
 * @param {Message[]} messages
 * @returns {{messages: Message[], converted: number}}
 */
export function commandArgsToInput(messages) {
  let converted = 0

  const out = (messages || []).map(message => {
    const command = /** @type {StoredCommand|undefined} */ (message?.metadata?.command)
    if (!command || !Array.isArray(command.args) || 'input' in command) return message

    const { args, ...rest } = command
    const [input, param] = args
    converted++

    return {
      ...message,
      metadata: {
        ...message.metadata,
        command: {
          ...rest,
          input: input == null ? '' : String(input),
          ...(param == null || param === '' ? {} : { param: String(param) }),
        },
      },
    }
  })

  return { messages: out, converted }
}
