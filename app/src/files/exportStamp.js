/**
 * @module files/exportStamp
 * @description The stamp on a document exported for another app
 * (`apps/exports.js`): front matter saying where it came from, as generated
 * code says what generated it.
 *
 * ```yaml
 * ---
 * inksprite:
 *   project: Thief
 *   document: Designs/Sync
 *   id: doc_x
 *   note: Exported from inksprite. Edit the document there and export again; changes made to this file are overwritten.
 * ---
 * ```
 *
 * The note is for whoever opens the file, a model first: it says what to do
 * and what happens otherwise. The id finds the document whatever it is
 * called now. There is no date in it, so a file changes only when its text
 * does.
 *
 * Only an export made for an app is stamped: one made from the menus is as
 * it would be published. A stamped file brought back in has its stamp taken
 * off, the editor having no front matter to keep it in. It is taken off as
 * text: an imported file is somebody else's, and its front matter is neither
 * loaded as YAML nor written out again, which a file made to grow on the way
 * (aliases within aliases) would be.
 *
 * Design: `.llm/mcp_server_design.md`, "The stamp".
 */

import { withFrontmatter } from '@/storage/frontmatter.js'

/** The key the stamp is under, in a file's front matter. */
const STAMP_KEY = 'inksprite'

/** What the stamp tells whoever opens the file. */
export const STAMP_NOTE =
  'Exported from inksprite. Edit the document there and export again; changes made to this file are overwritten.'

/**
 * A document's text as it is exported for another app: stamped.
 *
 * @param {{project: string, document: string, id: string}} from
 * @param {string} body
 * @returns {string}
 */
export function stamped({ project, document, id }, body) {
  return withFrontmatter({ [STAMP_KEY]: { project, document, id, note: STAMP_NOTE } }, body)
}

/**
 * A file's front matter as `storage/frontmatter.js` finds it, in its three
 * parts: the line of dashes that opens it, the YAML, and the line that
 * closes it.
 */
const FRONT = /^(---[ \t]*\r?\n)((?:[\s\S]*?\r?\n)?)(---[ \t]*(?:\r?\n|$))/

/** The line a stamp starts on: its key at the left edge, with its fields under it. */
const OPENS = /^inksprite:[ \t]*(?:#.*)?$/

/**
 * A line without the break that ends it.
 * @param {string} line
 */
const bare = line => line.replace(/\r?\n$/, '')

/**
 * A file's text without its stamp, for one brought back in. The stamp's
 * lines alone go, and whatever else its front matter held stays as it was
 * written, to the byte; front matter that held only the stamp goes whole. A
 * file with no stamp is as it came.
 *
 * A stamp is the `inksprite:` key with fields indented under it, an `id`
 * among them, as `stamped` writes it.
 *
 * @param {string} text
 * @returns {string}
 */
export function withoutStamp(text) {
  const front = FRONT.exec(text)
  if (!front) return text
  const [whole, opening, yaml, closing] = front
  const lines = yaml.match(/[^\n]*\n/g) ?? []
  const start = lines.findIndex(line => OPENS.test(bare(line)))
  if (start < 0) return text

  // Its fields: the indented lines under the key, and any blank ones among them.
  let end = start + 1
  for (let at = start + 1; at < lines.length; at++) {
    const line = bare(lines[at])
    if (/^[ \t]+\S/.test(line)) end = at + 1
    else if (line.trim()) break
  }
  const fields = lines.slice(start + 1, end).map(bare)
  const indent = /^[ \t]+/.exec(fields[0] ?? '')?.[0] ?? ''
  const named = fields.some(
    line => line.startsWith(`${indent}id:`) && /^[ \t]+\S/.test(line.slice(indent.length + 3))
  )
  if (!indent || !named) return text

  const rest = [...lines.slice(0, start), ...lines.slice(end)]
  const after = text.slice(whole.length)
  // Nothing else in it: the block goes, and the blank line `stamped` put under it.
  if (rest.every(line => !line.trim())) return after.replace(/^\r?\n/, '')
  return `${opening}${rest.join('')}${closing}${after}`
}
