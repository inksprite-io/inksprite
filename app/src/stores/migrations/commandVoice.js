/**
 * @module stores/migrations/commandVoice
 * @description Give a stored command its answer as its content, and the ones
 * that consulted a model the assistant's voice.
 *
 * A command's message used to hold the tagged block the model reads —
 * `<oracle>` around the question and the answer — which meant the content was
 * wire format rather than anything anybody wrote. Nothing could stream into it,
 * because streaming an answer into it would have shown the tags growing around
 * the words.
 *
 * The tag goes on at the wire now (see ai/context/build.js), so the content is
 * the answer alone. And a command that consulted a model is stored as what it
 * always was — an assistant turn — rather than under the writer's name.
 *
 * The two commands that consulted are named here rather than looked up, because
 * a migration is a statement about what was true at version 9. If a later
 * command starts consulting, this one is still right about the old rows.
 *
 * Pure, like the migrations before it, so the Dexie upgrade hook and backup
 * restore share one transform.
 */

/** @typedef {import('../../types/models.js').Message} Message */

/** The commands that reached a model, as of schema 9. */
const CONSULTED = new Set(['compact', 'interpret'])

/**
 * Unwrap command messages and move the consulting ones into the assistant slot.
 *
 * Idempotent: a message already holding its answer under the right role is left
 * alone, so a retried upgrade or a backup taken after this one restores
 * unchanged. A command that never answered — one still pending when the tab was
 * closed, or one that failed — ends up with no content, which is what an
 * assistant turn that said nothing looks like anyway.
 *
 * @param {Message[]} messages
 * @returns {{messages: Message[], moved: number}}
 */
export function commandsIntoTheirVoice(messages) {
  let moved = 0

  const out = (messages || []).map(message => {
    const command = message?.metadata?.command
    if (!command) return message

    const content = command.result || ''
    const role = CONSULTED.has(command.name) ? 'assistant' : message.role
    if (message.content === content && message.role === role) return message

    moved++
    return { ...message, content, role }
  })

  return { messages: out, moved }
}
