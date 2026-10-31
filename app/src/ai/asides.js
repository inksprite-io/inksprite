/**
 * @module ai/asides
 * @description A question asked on the side of a chat, and its answer.
 *
 * `/aside What should I do next?` asks the model something outside the
 * conversation: how a scene is going, what a character might do, whether a
 * chapter drags. The model answers it the way it answers any turn, with the
 * same prompt, the same history and the same tools, and the question reaches it
 * as the writer's turn under the command's tag, `<aside>`. Nothing more is said
 * about what an aside is; the writer says what they need in the question.
 *
 * Once it is answered, both go. Every request after it is made as if the aside
 * had never been asked: the next turn, a skill reading the transcript, a
 * summary. So the writer can step out of the story without the story hearing
 * them, and the request after an aside starts the way the one before it did,
 * which keeps the provider's prompt cache, and a local server's, warm across it.
 * For the same reason an aside sees none of the asides before it.
 *
 * The question is a message of its own, never a piece of a turn: a turn half
 * left out would be a turn the model reads wrong. The answer is the assistant
 * message after it. Both say so on their metadata, `aside`, so an answer stays
 * an aside whatever happens to its question.
 *
 * An aside the writer wants to say more about is forked: Fork from here on it
 * makes a chat of the conversation the model read as it answered, with the
 * aside in it rather than on the side. The question still reads as it was
 * asked, under the command's tag, so the answer stepping out of the story is
 * the model doing as it was asked.
 */

/** @typedef {import('../types/models.js').Message} Message */

/**
 * Whether a message is an aside: the question, or its answer.
 *
 * @param {Message|null|undefined} message
 * @returns {boolean}
 */
export function isAside(message) {
  return message?.metadata?.aside === true
}

/**
 * The conversation as the model is to read it: without its asides.
 *
 * The one kept is the aside being answered, which is the last thing in the
 * conversation while it is: its question, and its answer as far as it has got.
 * A reader of the transcript is never answering one, and keeps none.
 *
 * @template {Message} T
 * @param {T[]} messages - In order
 * @param {{answering?: boolean}} [options] - Whether this is for the turn
 *   being answered, which may be an aside's answer
 * @returns {T[]}
 */
export function withoutAsides(messages, { answering = false } = {}) {
  const from = answering ? lastAside(messages) : messages.length

  /** @type {(message: T, at: number) => boolean} */
  const read = (message, at) => at >= from || !isAside(message)
  return messages.every(read) ? messages : messages.filter(read)
}

/**
 * Where the aside the conversation ends in begins: its question, followed by
 * its answer as far as it has got.
 *
 * @param {Message[]} messages - In order
 * @returns {number} The question's place, or the length of the conversation
 *   when it does not end in an aside
 */
export function lastAside(messages) {
  let at = messages.length - 1
  while (at >= 0 && messages[at].role === 'assistant' && isAside(messages[at])) at--
  return at >= 0 && messages[at].role === 'user' && isAside(messages[at]) ? at : messages.length
}

/**
 * A message said on the side, as part of the conversation instead: what a
 * fork does with the aside it was taken at. Every answer the message has had
 * goes in with it, so turning to another doesn't put it back on the side.
 *
 * @template {Message} T
 * @param {T} message
 * @returns {T}
 */
export function intoConversation(message) {
  return {
    ...message,
    metadata: withoutMark(message.metadata),
    ...(message.alternates
      ? {
          alternates: message.alternates.map(answer => ({
            ...answer,
            metadata: withoutMark(answer.metadata),
          })),
        }
      : {}),
  }
}

/**
 * Metadata without the mark that says it was said on the side.
 *
 * @param {Message['metadata']} metadata
 * @returns {Message['metadata']}
 */
function withoutMark(metadata) {
  if (!metadata?.aside) return metadata
  const { aside: _aside, ...rest } = metadata
  return rest
}
