/**
 * @module tts/hints
 * @description Pronunciation hints: words the speech model gets wrong, and
 * how to spell them so that it gets them right. `Aelinor:AY-lin-or`, one to
 * a line. Applied to what the server is sent and nowhere else; the document
 * keeps its spelling.
 */

/** @typedef {{word: string, say: string}} Hint */

/**
 * Read hints from their text: `word:say`, one to a line. Blank lines and
 * lines starting with `#` are skipped, as is anything without both halves.
 *
 * @param {string|null|undefined} text
 * @returns {Hint[]}
 */
export function parseHints(text) {
  /** @type {Hint[]} */
  const hints = []
  for (const line of (text || '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const at = trimmed.indexOf(':')
    if (at < 0) continue
    const word = trimmed.slice(0, at).trim()
    const say = trimmed.slice(at + 1).trim()
    if (word && say) hints.push({ word, say })
  }
  return hints
}

/** @param {string} text */
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * The text with every hinted word respelled. Whole words only, in any case,
 * so `Cal` leaves `Callum` alone; a word is bounded by anything that is not
 * a letter or a digit, in any script.
 *
 * @param {string} text
 * @param {Hint[]} hints
 * @returns {string}
 */
export function applyHints(text, hints) {
  let out = text
  for (const { word, say } of hints) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(word)}(?![\\p{L}\\p{N}])`, 'giu')
    out = out.replace(pattern, () => say)
  }
  return out
}
