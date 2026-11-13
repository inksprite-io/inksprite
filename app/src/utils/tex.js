/**
 * @module utils/tex
 * @description Where a formula is in markdown: TeX between the delimiters
 * models write, read the same in the chat (`utils/markdown.js`) and in a
 * document (`editor/markdown.js`).
 *
 * `$$…$$` or `\[…\]` is a formula set on its own, `$…$` or `\(…\)` one in a
 * sentence. A dollar is money as often as it is math, so a single one opens a
 * formula only as Pandoc has it: something other than a space straight after
 * it, and a closing one with no space before it and no digit after, on the
 * same line. "$5 and $10" is two prices. No formula runs past a blank line,
 * and one with nothing between its delimiters is none.
 *
 * A document reads no `\[…\]`: its markdown writes a bracket in the text as
 * `\[`, so every bracket in it would be one.
 */

/** A formula's TeX: anything up to its closing delimiter, but not past a blank line. */
const TEX = String.raw`((?:(?!\n[ \t]*\n)[\s\S])+?)`

/** Display math, in either of its delimiters. */
const DISPLAY = String.raw`\$\$${TEX}\$\$|\\\[${TEX}\\\]`

/**
 * A formula with lines of its own, from the start of one to the end of
 * another. Sticky: set `lastIndex` to where to look.
 */
export const MATH_BLOCK = new RegExp(String.raw` {0,3}(?:${DISPLAY})[ \t]*(?:\n|$)`, 'y')

/** A single dollar's formula, as Pandoc reads one. */
const SINGLE = String.raw`\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)`

/**
 * A formula in a sentence, by its delimiters, the display ones first: `$$`
 * would otherwise read as an empty `$…$`. A single dollar keeps to one line.
 *
 * @type {{pattern: RegExp, display: boolean, bracket?: boolean}[]}
 */
const MATH_INLINE = [
  { pattern: new RegExp(String.raw`^\$\$${TEX}\$\$`), display: true },
  { pattern: new RegExp(String.raw`^\\\[${TEX}\\\]`), display: true, bracket: true },
  { pattern: new RegExp(String.raw`^\\\(${TEX}\\\)`), display: false },
  { pattern: new RegExp(`^${SINGLE}`), display: false },
]

/**
 * A formula found: what was written, its TeX, and whether it is set on its
 * own.
 *
 * @typedef {Object} Found
 * @property {string} raw - The formula as written, delimiters and all
 * @property {string} tex - What is between them
 * @property {boolean} display - Written as a formula set on its own
 */

/**
 * A formula's TeX without the space around it, which TeX does without, but
 * for the space after a backslash, which is TeX's own.
 *
 * @param {string} tex
 * @returns {string}
 */
export const trimTex = tex => tex.replace(/^\s+/, '').replace(/(?<!\\)\s+$/, '')

/**
 * The formula a match is, or none when there is no TeX between its delimiters.
 *
 * @param {RegExpExecArray|null} match
 * @param {boolean} display
 * @returns {Found|null}
 */
export function foundIn(match, display) {
  const tex = match?.slice(1).find(group => group !== undefined)
  if (!match || !tex?.trim()) return null
  return { raw: match[0], tex, display }
}

/**
 * The formula that starts a piece of text, if one does.
 *
 * @param {string} src
 * @param {boolean} [brackets] - Whether `\[…\]` is one, as it is but in a
 *   document
 * @returns {Found|null}
 */
export function formulaAt(src, brackets = true) {
  const first = src.charCodeAt(0)
  // `$`, or the backslash of `\(` and `\[`.
  if (first !== 0x24 && first !== 0x5c) return null
  for (const { pattern, display, bracket } of MATH_INLINE) {
    if (bracket && !brackets) continue
    const found = foundIn(pattern.exec(src), display)
    if (found) return found
  }
  return null
}

/**
 * Whether a document's markdown may have a formula in it, or a dollar escaped
 * so as not to be one. Quick, and sure never to miss one; it finds some that
 * are not, a pair of dollars in code, say.
 *
 * @param {string|null|undefined} markdown
 * @returns {boolean}
 */
export function mayHoldFormula(markdown) {
  if (!markdown || !/[$\\]/.test(markdown)) return false
  return (
    /\\[$(]/.test(markdown) ||
    new RegExp(String.raw`\$\$${TEX}\$\$`).test(markdown) ||
    new RegExp(SINGLE).test(markdown)
  )
}

/**
 * A document's markdown with each formula in it put another way, for what
 * reads it as words. Escapes are passed over, as markdown reads them; code is
 * not, and a formula's delimiters in it are read as one, which a count of
 * words can bear.
 *
 * @param {string} markdown
 * @param {(found: Found) => string} put - What a formula is put as
 * @returns {string}
 */
export function replaceFormulas(markdown, put) {
  if (!/[$\\]/.test(markdown)) return markdown
  let out = ''
  let from = 0
  for (let at = 0; at < markdown.length; at++) {
    const char = markdown[at]
    if (char !== '$' && char !== '\\') continue
    const found = formulaAt(markdown.slice(at), false)
    if (found) {
      out += markdown.slice(from, at) + put(found)
      at += found.raw.length - 1
      from = at + 1
    } else if (char === '\\') at++
  }
  return out + markdown.slice(from)
}
