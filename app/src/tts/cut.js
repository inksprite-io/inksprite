/**
 * @module tts/cut
 * @description A paragraph too long for one request, cut into pieces that
 * fit. OpenAI reads at most 4096 characters at a time, and so do some of
 * OpenRouter's models. Each piece is whole sentences where a sentence fits,
 * so the voice ends each piece where a reader would pause anyway; a sentence
 * longer than the limit is cut between words, and a word longer than that
 * where it reaches it.
 */

/**
 * The sentences of a text, each with the space after it.
 *
 * @param {string} text
 * @returns {string[]}
 */
function sentencesOf(text) {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' })
    return Array.from(segmenter.segment(text), part => part.segment)
  }
  return text.match(/[^.!?…]*(?:[.!?…]+["'”’)\]]*\s*|$)/g)?.filter(Boolean) ?? [text]
}

/**
 * A run of text longer than the limit, cut between words, and a word longer
 * than the limit where it reaches it.
 *
 * @param {string} text
 * @param {number} limit
 * @returns {string[]}
 */
function cutBetweenWords(text, limit) {
  /** @type {string[]} */
  const pieces = []
  let piece = ''
  for (const word of text.match(/\S+\s*/g) ?? []) {
    if (piece && (piece + word).trimEnd().length > limit) {
      pieces.push(piece)
      piece = ''
    }
    let rest = word
    while (rest.trimEnd().length > limit) {
      pieces.push(rest.slice(0, limit))
      rest = rest.slice(limit)
    }
    piece += rest
  }
  if (piece) pieces.push(piece)
  return pieces
}

/**
 * The text in pieces of at most `limit` characters, as few as whole
 * sentences allow, each trimmed. A text that fits is one piece, as it is.
 *
 * @param {string} text
 * @param {number} limit - Characters, more than zero
 * @returns {string[]}
 */
export function cutText(text, limit) {
  if (text.length <= limit) return [text]

  /** @type {string[]} */
  const pieces = []
  let piece = ''
  for (const sentence of sentencesOf(text)) {
    if (piece && (piece + sentence).trimEnd().length > limit) {
      pieces.push(piece)
      piece = ''
    }
    if (sentence.trimEnd().length > limit) {
      const words = cutBetweenWords(sentence, limit)
      pieces.push(...words.slice(0, -1))
      piece = words[words.length - 1] ?? ''
    } else {
      piece += sentence
    }
  }
  if (piece) pieces.push(piece)
  return pieces.map(part => part.trim()).filter(Boolean)
}
