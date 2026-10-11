/**
 * Frontmatter: YAML between two lines of three dashes at the top of a
 * markdown file, the way Obsidian and most static site tools read it.
 */

import { dump, load } from 'js-yaml'

/** Frontmatter at the very top, closed by its own line of dashes. */
const FRONTMATTER = /^---[ \t]*\r?\n((?:[\s\S]*?\r?\n)?)---[ \t]*(?:\r?\n|$)/

/**
 * A file of these fields and this body. One blank line comes between them,
 * and nothing after the body: what is read back is what was written.
 *
 * @param {Record<string, unknown>} fields
 * @param {string} body
 * @returns {string}
 */
export function withFrontmatter(fields, body) {
  const yaml = dump(fields, { lineWidth: -1, noRefs: true })
  return `---\n${yaml}---\n${body ? `\n${body}` : ''}`
}

/**
 * A file's fields and its body. A file without frontmatter, or with YAML
 * that cannot be read, has no fields and is all body.
 *
 * @param {string} text
 * @returns {{fields: Record<string, any>|null, body: string}}
 */
export function readFrontmatter(text) {
  const match = FRONTMATTER.exec(text)
  if (!match) return { fields: null, body: text }

  /** @type {unknown} */
  let fields
  try {
    fields = match[1].trim() ? (load(match[1]) ?? {}) : {}
  } catch {
    return { fields: null, body: text }
  }
  if (typeof fields !== 'object' || Array.isArray(fields)) return { fields: null, body: text }

  const rest = text.slice(match[0].length)
  const body = rest.startsWith('\r\n')
    ? rest.slice(2)
    : rest.startsWith('\n')
      ? rest.slice(1)
      : rest
  return { fields: /** @type {Record<string, any>} */ (fields), body }
}
