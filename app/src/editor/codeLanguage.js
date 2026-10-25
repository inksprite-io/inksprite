/**
 * @module editor/codeLanguage
 * @description The highlighting for a file's text, by its name: the code
 * viewer's, and the plain text editor's for a document named for a language.
 * Each language's parser is loaded the first time a file of it is shown.
 */

import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'

/**
 * The highlighting for a file, by its name, or nothing when no language
 * claims it or its parser will not load.
 *
 * @param {string} filename
 * @returns {Promise<import('@codemirror/state').Extension>}
 */
export async function languageFor(filename) {
  const found = filename ? LanguageDescription.matchFilename(languages, filename) : null
  if (!found) return []
  try {
    return await found.load()
  } catch {
    return []
  }
}
