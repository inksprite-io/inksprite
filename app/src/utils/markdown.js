/**
 * @module utils/markdown
 * @description Markdown to HTML, for text nobody here wrote.
 *
 * What goes through this is a model's output and whatever the writer typed, and
 * it comes out into `v-html`. Neither is trusted: a model repeats what it was
 * shown, and what it was shown includes documents and tool results that came
 * from somewhere else. The app has no backend and keeps provider keys in
 * IndexedDB, so script running in this origin is script running with the keys.
 *
 * So no HTML gets through. Not sanitised — escaped, tags and all, which is both
 * safer and more honest: a writer who types `<oracle>` sees `<oracle>` rather
 * than watching their tags silently disappear into an element the browser does
 * not know. Nothing here needs to write HTML; it is a markdown app.
 *
 * URLs are the other way in, because markdown's own link syntax carries them
 * and `javascript:` is a URL. They are checked against a list of what a link in
 * a story could reasonably be, after being decoded — `java&#09;script:` is the
 * same URL once the browser has read the attribute.
 *
 * An image is a link to it. Shown, it would be fetched the moment it was on the
 * screen, with whatever the model put in its address. The page's
 * Content-Security-Policy (`index.html`) refuses images from elsewhere too.
 *
 * A lone newline is a line break, not CommonMark's soft wrap. What is rendered
 * here is shown where it was typed — a chat message, a model's reply, a
 * document — and a writer who ended a line meant it to end there.
 *
 * Math is TeX, as models write it: `$$…$$` or `\[…\]` for a formula set on
 * its own, `$…$` or `\(…\)` for one in a sentence, typeset by `utils/math.js`.
 * A dollar is money as often as it is math, so a single one opens a formula
 * only as Pandoc has it: something other than a space straight after it, and
 * a closing one with no space before it and no digit after. "$5 and $10" is
 * two prices. Where a formula has nothing to show, it stays as it was written.
 */

import { Marked } from 'marked'
import he from 'he'
import { typesetMath } from './math.js'

/** What a link in a story is allowed to be. Everything else is not a link. */
const SAFE_SCHEMES = new Set(['http', 'https', 'mailto'])

/**
 * @param {string} text
 * @returns {string}
 */
const escapeHtml = text =>
  String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

/**
 * Whether this is somewhere a link may point.
 *
 * Read the way the browser will read it: entities decoded, and whitespace and
 * control characters dropped, because they are ignored in a scheme and are only
 * ever there to hide one. A URL with no scheme at all is relative, and relative
 * is this app.
 *
 * @param {string} href
 * @returns {boolean}
 */
function isSafeUrl(href) {
  const url = he.decode(String(href || '')).replace(/[\s\p{Cc}]/gu, '')
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)
  return !scheme || SAFE_SCHEMES.has(scheme[1].toLowerCase())
}

/** A formula's TeX: anything up to its closing delimiter, but not past a blank line. */
const TEX = String.raw`((?:(?!\n[ \t]*\n)[\s\S])+?)`

/** Display math, in either of its delimiters. */
const DISPLAY = String.raw`\$\$${TEX}\$\$|\\\[${TEX}\\\]`

/** A formula with lines of its own, from the start of one to the end of another. */
const MATH_BLOCK = new RegExp(String.raw` {0,3}(?:${DISPLAY})[ \t]*(?:\n|$)`, 'y')

/**
 * A formula in a sentence, by its delimiters, the display ones first: `$$`
 * would otherwise read as an empty `$…$`. A single dollar keeps to one line.
 *
 * @type {{pattern: RegExp, display: boolean}[]}
 */
const MATH_INLINE = [
  { pattern: new RegExp(`^(?:${DISPLAY})`), display: true },
  { pattern: new RegExp(String.raw`^\\\(${TEX}\\\)`), display: false },
  { pattern: /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<!\s)\$(?!\d)/, display: false },
]

/**
 * A formula token, or nothing when there is no TeX between the delimiters.
 *
 * @param {string} type
 * @param {RegExpExecArray|null} match
 * @param {boolean} display
 */
const mathToken = (type, match, display) => {
  const tex = match?.slice(1).find(group => group !== undefined)
  if (!match || !tex?.trim()) return undefined
  return { type, raw: match[0], tex, display }
}

/**
 * The formulas, as marked extensions: one for those with lines of their own,
 * which stops a paragraph where it starts, and one for those in a sentence.
 *
 * @type {import('marked').TokenizerAndRendererExtension[]}
 */
const math = [
  {
    name: 'mathBlock',
    level: 'block',
    // Where a paragraph's text gives way to a formula. Marked hands over the
    // text from its second character, so a formula only starts after a
    // newline, and over the rest of the document, which is only looked into
    // as far as the paragraph could go.
    start(src) {
      const blank = src.search(/\n[ \t]*\n/)
      const paragraph = blank < 0 ? src : src.slice(0, blank)
      for (const line of paragraph.matchAll(/\n(?= {0,3}(?:\$\$|\\\[))/g)) {
        MATH_BLOCK.lastIndex = line.index + 1
        if (MATH_BLOCK.test(src)) return line.index + 1
      }
      return undefined
    },
    tokenizer(src) {
      MATH_BLOCK.lastIndex = 0
      return mathToken('mathBlock', MATH_BLOCK.exec(src), true)
    },
    renderer: token =>
      `${typesetMath(token.tex, true) ?? `<p>${escapeHtml(token.raw.trim())}</p>`}\n`,
  },
  {
    name: 'math',
    level: 'inline',
    start: src => {
      const at = src.search(/\$|\\[[(]/)
      return at < 0 ? undefined : at
    },
    tokenizer(src) {
      for (const { pattern, display } of MATH_INLINE) {
        const token = mathToken('math', pattern.exec(src), display)
        if (token) return token
      }
      return undefined
    },
    renderer: token => typesetMath(token.tex, token.display) ?? escapeHtml(token.raw),
  },
]

/**
 * The one reader everything goes through.
 *
 * A renderer that returns `false` is saying it has nothing special to do, and
 * marked falls back to its own — so the safe cases render exactly as they
 * always did, and only the refused ones are written out here.
 */
const reader = new Marked({
  breaks: true,
  extensions: math,
  renderer: {
    html: ({ text }) => escapeHtml(text),

    link(token) {
      if (isSafeUrl(token.href)) return false
      // The words stay, since they are what was being said. Only the
      // destination goes.
      return this.parser.parseInline(token.tokens)
    },

    // Never shown, only linked to. An image loads as soon as it is on the
    // screen, and a model can be talked into putting the writer's words in its
    // address by a page it read. A link waits for a click, and says where it
    // goes.
    image(token) {
      if (!isSafeUrl(token.href)) return escapeHtml(token.text || '')
      const words = token.text
        ? token.tokens
        : [{ type: 'text', raw: token.href, text: token.href }]
      return this.link({ ...token, type: 'link', tokens: words })
    },
  },
})

/**
 * Render markdown to HTML
 * @param {string} markdown - Markdown text to render
 * @returns {string} Rendered HTML
 */
export function renderMarkdown(markdown) {
  if (!markdown) return ''

  try {
    // @ts-ignore - parse returns string in sync mode
    return reader.parse(markdown)
  } catch (error) {
    console.error('Failed to render markdown:', error)
    // Escaped, because this lands in the same v-html the parsed output does.
    // A fallback that reached for raw text would be a way past everything
    // above it, on the one path where something has already gone wrong.
    return escapeHtml(stripMarkdown(markdown))
  }
}

/**
 * Strip markdown formatting from text for immediate display
 * @param {string} text - Text with markdown formatting
 * @returns {string} Plain text with markdown symbols removed
 */
export function stripMarkdown(text) {
  // Handle bold/italic markers (order matters!)
  text = text.replace(/\*\*\*/g, '') // Bold+italic first
  text = text.replace(/___/g, '') // Alt bold+italic
  text = text.replace(/\*\*/g, '') // Bold
  text = text.replace(/__/g, '') // Alt bold
  text = text.replace(/\*/g, '') // Italic
  text = text.replace(/_/g, '') // Alt italic

  // Handle headers (but keep the text)
  text = text.replace(/^#{1,6}\s+/gm, '')

  // Handle code blocks and inline code
  text = text.replace(/```[^`]*```/g, match => {
    // Extract content from code blocks
    return match.replace(/```[^\n]*\n?/g, '').replace(/```$/g, '')
  })
  text = text.replace(/`([^`]+)`/g, '$1') // Inline code

  // Handle links [text](url) -> text
  text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

  // Handle blockquotes
  text = text.replace(/^>\s+/gm, '')

  // Handle list markers
  text = text.replace(/^[*\-+]\s+/gm, '')
  text = text.replace(/^\d+\.\s+/gm, '')

  return text
}
