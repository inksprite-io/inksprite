/* global TextEncoder */
/**
 * @module files/exportStamp
 * @description The stamp on a document exported to its project's linked
 * folder: front matter saying where it came from, as generated code says
 * what generated it.
 *
 * ```yaml
 * ---
 * inksprite:
 *   project: Thief
 *   document: Designs/Sync
 *   id: doc_x
 *   hash: 0123456789abcdef
 *   note: Exported from inksprite. Edit the document there and export again; changes made to this file are overwritten.
 * ---
 * ```
 *
 * The note is for whoever opens the file, a model first: it says what to do
 * and what happens otherwise. The id finds the document whatever it is
 * called now. The hash is of the body as it was written, with no date in it,
 * so a file changes only when its text does; and a body that doesn't match
 * its own hash was changed outside inksprite, on whatever branch is checked
 * out, which is how an export tells an older copy of its own from one that
 * was edited.
 *
 * Only a linked export is stamped: one made from the menus is as it would be
 * published. A stamped file brought back in has its stamp taken off, the
 * editor having no front matter to keep it in.
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
 * @property {string} hash - Of the file's body as it was written
 */

/**
 * A short hash of a body: the start of its SHA-256, in hex.
 *
 * @param {string} body
 * @returns {Promise<string>}
 */
export async function bodyHash(body) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return [...new Uint8Array(digest).slice(0, 8)]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * A document's text as it is exported to a linked folder: stamped.
 *
 * @param {{project: string, document: string, id: string}} from
 * @param {string} body
 * @returns {Promise<string>}
 */
export async function stamped({ project, document, id }, body) {
  const stamp = { project, document, id, hash: await bodyHash(body), note: STAMP_NOTE }
  return withFrontmatter({ [STAMP_KEY]: stamp }, body)
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
      hash: String(found.hash ?? ''),
    },
    body,
    others,
  }
}

/**
 * Whether a file is an export as inksprite left it: stamped, its body still
 * the one its stamp was made for. False for one changed since, and for one
 * with no stamp.
 *
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function asExported(text) {
  const { stamp, body } = readStamp(text)
  return Boolean(stamp) && /** @type {Stamp} */ (stamp).hash === (await bodyHash(body))
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
