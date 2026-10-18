/**
 * @module drive/export
 * @description What Google's markdown export of a Doc gets wrong, put right
 * before the importer reads it.
 *
 * Checked against a real Doc on 16 Oct 2026 (`.llm/google_docs_design.md`,
 * part 1, Testing). A horizontal line is written as `---` straight under the
 * paragraph before it, after a hard break, and markdown reads a `---` under
 * text as that text's underline: the paragraph would become a heading and
 * the line be lost. Google writes its headings with `#`, never underlined,
 * so a `---` under text from Google is always a line.
 */

/** A line of text with a line of `---` under it, the text's hard break and all. */
const UNDERLINED = /^(.*\S)[ \t]*\n(?=-{3,}[ \t]*$)/gm

/**
 * A Doc's markdown, as Google meant it.
 *
 * @param {string} markdown - Google's export of a Doc
 * @returns {string}
 */
export function mendExport(markdown) {
  return markdown.replace(UNDERLINED, '$1\n\n')
}
