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
 * off, the editor having no front matter to keep it in.
 *
 * Design: `.llm/mcp_server_design.md`, "The stamp".
 */

import { readFrontmatter, withFrontmatter } from '@/storage/frontmatter.js'

/** The key the stamp is under, in a file's front matter. */
export const STAMP_KEY = 'inksprite'

/** What the stamp tells whoever opens the file. */
export const STAMP_NOTE =
  'Exported from inksprite. Edit the document there and export again; changes made to this file are overwritten.'

/**
 * Where an exported file came from.
 *
 * @typedef {Object} Stamp
 * @property {string} project - Its project's name
 * @property {string} document - Its path there
 * @property {string} id - The document's id
 */

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
 * The stamp a file carries, and the file without it.
 *
 * @param {string} text
 * @returns {{stamp: Stamp|null, body: string, others: Record<string, any>}}
 *   `others` is what else its front matter held
 */
export function readStamp(text) {
  const { fields, body } = readFrontmatter(text)
  const found = fields?.[STAMP_KEY]
  if (!fields || !found || typeof found !== 'object' || typeof found.id !== 'string') {
    return { stamp: null, body: text, others: {} }
  }
  const { [STAMP_KEY]: _stamp, ...others } = fields
  return {
    stamp: {
      project: String(found.project ?? ''),
      document: String(found.document ?? ''),
      id: found.id,
    },
    body,
    others,
  }
}

/**
 * A file's text without its stamp, for one brought back in: its body, under
 * whatever else its front matter held. A file with no stamp is as it was.
 *
 * @param {string} text
 * @returns {string}
 */
export function withoutStamp(text) {
  const { stamp, body, others } = readStamp(text)
  if (!stamp) return text
  return Object.keys(others).length > 0 ? withFrontmatter(others, body) : body
}
