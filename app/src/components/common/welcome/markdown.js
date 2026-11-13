/**
 * The welcome's words, kept as Markdown beside its sections (`welcome.md`,
 * `getting-started.md`, `feedback.md`, `terms.md`) so they read and change
 * as text, and how they look.
 *
 * A part shown only some of the time sits between `<!-- if name -->` and
 * `<!-- end -->`, around blocks or words, and they nest; the section says
 * which names are true. Any other comment is a note to whoever edits the
 * file and is left out. Links open in a tab of their own. A quote whose
 * first line is `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` or
 * `[!CAUTION]` is an alert, as GitHub has them.
 */
import MarkdownIt from 'markdown-it'

/** A link, or a button that reads as one, as the welcome's footer has. */
export const LINK = 'text-primary-600 dark:text-primary-400 hover:underline cursor-pointer'

/**
 * How a section's Markdown looks: the page's reading size throughout, its
 * headings only bolder, and its links in the primary colour. Typography's
 * `prose-sm` would set its own sizes over these.
 */
export const TEXT = [
  'px-2 pt-2 pb-1 text-base text-surface-700 dark:text-surface-200',
  '[&>:first-child]:mt-0 [&>:last-child]:mb-0',
  '[&_h3]:mt-5 [&_h3]:mb-2 [&_h3]:font-semibold [&_h3]:text-surface-800 dark:[&_h3]:text-surface-100',
  '[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5',
  '[&_ul_ul]:list-[circle]',
  '[&_a]:text-primary-600 dark:[&_a]:text-primary-400 [&_a:hover]:underline',
].join(' ')

/** A quote, or an alert: a bar down its left side, in the alert's colour. */
const QUOTE = 'my-2 border-l-4 py-1 pl-3 [&>:first-child]:mt-0 [&>:last-child]:mb-0'

/**
 * GitHub's alerts, by the word in the first line of their quote: what each
 * is titled, and its icon and colour.
 */
const ALERTS = {
  note: {
    title: 'Note',
    icon: 'pi-info-circle',
    border: 'border-blue-500',
    color: 'text-blue-600 dark:text-blue-400',
  },
  tip: {
    title: 'Tip',
    icon: 'pi-lightbulb',
    border: 'border-green-600',
    color: 'text-green-700 dark:text-green-400',
  },
  important: {
    title: 'Important',
    icon: 'pi-exclamation-circle',
    border: 'border-violet-500',
    color: 'text-violet-600 dark:text-violet-400',
  },
  warning: {
    title: 'Warning',
    icon: 'pi-exclamation-triangle',
    border: 'border-amber-500',
    color: 'text-amber-700 dark:text-amber-400',
  },
  caution: {
    title: 'Caution',
    icon: 'pi-ban',
    border: 'border-red-500',
    color: 'text-red-600 dark:text-red-400',
  },
}

/** The first line of a quote that makes it an alert: the word alone. */
const ALERT = new RegExp(`^\\[!(${Object.keys(ALERTS).join('|')})\\][ \\t]*(?:\\n|$)`, 'i')

/** A comment, which opens or closes a part shown only some of the time, or is a note. */
const COMMENT = /<!--([\s\S]*?)-->/g

/** What a comment that opens or closes a part says. */
const MARKER = /^\s*(?:if\s+([\w-]+)|(end))\s*$/

/**
 * @typedef {Object} RenderOptions
 * @property {Record<string, boolean>} [when] - Whether each part named in the file is shown
 */

const markdown = new MarkdownIt()

// A quote that opens with an alert's word is that alert: the word goes, and
// what follows it in the first paragraph is read again without it.
markdown.core.ruler.after('inline', 'alerts', state => {
  const { tokens } = state
  for (let at = 0; at < tokens.length; at++) {
    const open = tokens[at]
    const inline = tokens[at + 2]
    if (open.type !== 'blockquote_open' || tokens[at + 1]?.type !== 'paragraph_open') continue
    const word = inline.content.match(ALERT)
    if (!word) continue
    const close = tokens.find(
      (token, index) =>
        index > at && token.type === 'blockquote_close' && token.level === open.level
    )
    open.meta = { alert: word[1].toLowerCase() }
    if (close) close.meta = open.meta
    const rest = inline.content.slice(word[0].length)
    if (rest.trim()) {
      inline.content = rest
      inline.children = []
      state.md.inline.parse(rest, state.md, state.env, inline.children)
    } else {
      // The word was the paragraph: the alert's text starts at the next one.
      tokens.splice(at + 1, 3)
    }
  }
})

markdown.renderer.rules.blockquote_open = (tokens, index) => {
  const kind = tokens[index].meta?.alert
  if (!kind) return `<blockquote class="${QUOTE} border-surface-300 dark:border-surface-600">\n`
  const { title, icon, border, color } = ALERTS[kind]
  return (
    `<div class="${QUOTE} ${border}" data-alert="${kind}">\n` +
    `<p class="flex items-center gap-1.5 font-semibold ${color}">` +
    `<i class="pi ${icon}" aria-hidden="true"></i>${title}</p>\n`
  )
}

markdown.renderer.rules.blockquote_close = (tokens, index) =>
  tokens[index].meta?.alert ? '</div>\n' : '</blockquote>\n'

// A link leaves the app for a tab of its own, as every link out of it does.
markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, index, options)
}

/**
 * The file with the parts that aren't shown taken out, and every comment.
 * A comment on a line of its own leaves the line blank, so it stands between
 * blocks, as a Markdown preview has it; inside a paragraph it leaves the
 * paragraph whole.
 *
 * @param {string} source - The Markdown
 * @param {Record<string, boolean>} when - Whether each named part is shown
 * @returns {string}
 */
export function select(source, when) {
  /** Whether each part open here is shown, the file itself first. */
  const shown = [true]
  let text = ''
  let from = 0
  for (const comment of source.matchAll(COMMENT)) {
    if (shown.at(-1)) text += source.slice(from, comment.index)
    from = comment.index + comment[0].length
    const [, name, end] = comment[1].match(MARKER) ?? []
    if (end) {
      if (shown.length === 1) throw new Error('An end comment closes no part.')
      shown.pop()
    } else if (name) {
      if (!(name in when)) throw new Error(`No part is called "${name}".`)
      shown.push(Boolean(shown.at(-1) && when[name]))
    }
  }
  if (shown.length > 1) throw new Error('A part is never closed by an end comment.')
  return text + source.slice(from)
}

/**
 * A section's Markdown as HTML. It's ours, and markdown-it escapes any HTML
 * in it, so it can be put in the page as it comes.
 *
 * @param {string} source - The Markdown
 * @param {RenderOptions} [options]
 * @returns {string}
 */
export function render(source, { when = {} } = {}) {
  return markdown.render(select(source, when))
}
