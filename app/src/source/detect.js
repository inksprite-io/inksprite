/**
 * @module source/detect
 * @description Whether a folder about to be imported looks like a codebase,
 * and so is worth asking about before it comes in as ordinary files.
 */

import { languageOf } from './language.js'
import { createRules } from './rules.js'

/** What a codebase has at least this many of. */
const MIN_CODE_FILES = 3

/** Languages that are writing or data rather than code. */
const NOT_CODE = new Set(['Text', 'Markdown', 'MDX', 'CSV', 'TSV', 'reStructuredText', 'LaTeX'])

/**
 * Whether a file's name says it is code: a programming language, or the
 * configuration and markup that go with one.
 *
 * @param {string} path
 * @returns {boolean}
 */
const isCode = path => !NOT_CODE.has(languageOf(path.split('/').pop() || '').language)

/**
 * Whether a folder's files look like a codebase. Of what a repository import
 * would take, which leaves out installed packages, build output and version
 * control, more than half is code, and there are a few of them.
 *
 * Going by what is in it rather than by a `.git` folder: a manuscript kept in
 * git is a folder of markdown, and is not asked about.
 *
 * @param {string[]} paths - Each file's path under the folder
 * @returns {boolean}
 */
export function looksLikeCodebase(paths) {
  const rules = createRules()
  const kept = paths.filter(path => rules.check(path) === null)
  const code = kept.filter(isCode).length
  return code >= MIN_CODE_FILES && code * 2 > kept.length
}
