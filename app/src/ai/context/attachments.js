/**
 * @module ai/context/attachments
 * @description Documents the writer attaches to a message.
 *
 * A link to a document, `[[`, is a reference: the model may read it or not.
 * The same link with an `@` before it, `@[Cast list](</Notes/Cast list>)`,
 * attaches the document: its text goes to the model with the message, without
 * the model asking.
 *
 * The text is copied onto the message when it is sent, and that copy is what
 * every later turn sends. A document that rode along as it stands now would
 * change the conversation behind it each time it was edited, and no prompt
 * cache would cover anything after it; a copy never moves, so it is paid once.
 * It is a record of one moment, as a read is, and counts as one: the project
 * block says when the document has changed since, and `read_document` answers
 * that an unchanged one is above (ai/context/reads.js).
 *
 * The model reads a block for each document ahead of what the writer said, and
 * the mention in their words as the plain link it would be without the `@`,
 * so a sentence written around it still reads and names the block by its path.
 *
 * Nothing here reaches a store: it is handed text and messages, and the copy
 * is taken by `attachedDocuments` in ai/tools/documents.js. See
 * .llm/attached_context_design.md.
 */

/**
 * @typedef {import('../../types/models.js').Message} Message
 *
 * @typedef {Object} Attachment
 * @property {string} id - The document
 * @property {string} path - Its path when it was attached, as the tools give it
 * @property {string} hash - A hash of the text it had then, as a read's
 * @property {string} text - What it said then, as the chat reads it; a line
 *   on why not, for a file with no text
 */

/**
 * A link with an `@` before it: its words, and its path between angle
 * brackets as the picker writes it, or bare where it has no spaces.
 */
const MENTION = /@\[(?:\\.|[^\]\\\n])*\]\((?:<((?:\\.|[^>\\\n])*)>|([^)\s<]+))\)/g

/**
 * The mentions in a text, in order: where each `@` is and the path it names.
 * An `@` at the end of a word is part of the word, an address or a handle.
 *
 * @param {string} text
 * @returns {Array<{at: number, path: string}>}
 */
export function mentionsIn(text) {
  const found = []
  for (const match of (text || '').matchAll(MENTION)) {
    const at = match.index ?? 0
    if (at > 0 && /[\w@]/.test(text[at - 1])) continue
    const path = (match[1] ?? match[2] ?? '').replace(/\\(.)/g, '$1').trim()
    if (path) found.push({ at, path })
  }
  return found
}

/**
 * Whether a text says nothing but its mentions: a turn that only attaches, as
 * a card's chat opens with.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function onlyAttaches(text) {
  const found = mentionsIn(text)
  return found.length > 0 && !(text || '').replace(MENTION, '').trim()
}

/**
 * A mention of a document, as the picker writes one: its words, and its path
 * from the top of the project.
 *
 * @param {string} words
 * @param {string} path - As the tools give it
 * @returns {string}
 */
export function mentionOf(words, path) {
  const target = `/${path.replace(/^\/+/, '')}`
  return `@[${words.replace(/[[\]\\]/g, '\\$&')}](<${target.replace(/[<>\\]/g, '\\$&')}>)`
}

/**
 * A turn of the writer's that says nothing and attaches these documents, a
 * mention to a line: what a chat on a card opens with, ahead of its greeting.
 *
 * @param {Attachment[]} attachments
 * @returns {{content: string, segments: import('../../types/models.js').MessageSegment[]}}
 */
export function attachingTurn(attachments) {
  const content = attachments
    .map(({ path }) => mentionOf(path.split('/').pop() || path, path))
    .join('\n')
  return { content, segments: [{ type: 'text', content, attachments }] }
}

/**
 * A text with each mention as the plain link it is without its `@`.
 *
 * @param {string} text
 * @returns {string}
 */
export function withoutSigils(text) {
  let out = text || ''
  for (const { at } of mentionsIn(out).reverse()) out = out.slice(0, at) + out.slice(at + 1)
  return out
}

/**
 * What a message attached, in the order it did: the copies on the pieces of
 * the writer's turn, each document once.
 *
 * @param {Message|undefined|null} message
 * @returns {Attachment[]}
 */
export function attachmentsOf(message) {
  if (message?.role !== 'user') return []
  /** @type {Map<string, Attachment>} */
  const attached = new Map()
  for (const segment of message.segments || []) {
    if (segment.type !== 'text') continue
    for (const attachment of segment.attachments || []) {
      if (!attached.has(attachment.id)) attached.set(attachment.id, attachment)
    }
  }
  return [...attached.values()]
}

/**
 * The attached documents as the model reads them: a block each, named by the
 * path every tool takes.
 *
 * @param {Attachment[]} attachments
 * @returns {string} Empty for none
 */
export function renderAttachments(attachments) {
  return attachments
    .map(
      ({ path, text }) =>
        `<document path="${path.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">\n${text}\n</document>`
    )
    .join('\n\n')
}

/**
 * A message's words as the model is sent them: its attached documents, then
 * what was said with its mentions as plain links. The same words back for a
 * message that attached nothing.
 *
 * @param {Message} message
 * @returns {{content: string, lead: number}} `lead` is how much of the
 *   content, from its start, is the documents
 */
export function withAttachments(message) {
  const attached = attachmentsOf(message)
  if (attached.length === 0) return { content: message.content, lead: 0 }
  const documents = renderAttachments(attached)
  return {
    content: `${documents}\n\n${withoutSigils(message.content)}`,
    lead: documents.length,
  }
}
