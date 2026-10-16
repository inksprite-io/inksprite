/**
 * @module spelling
 * @description The editor's spelling and grammar, checked by Harper on the
 * writer's own machine: the same in every browser and in the desktop app,
 * and told the words the project knows.
 *
 * Harper (`harper.js`, Apache-2.0) is Rust compiled to WebAssembly, and runs
 * in a worker of the app's own so the page never waits on it. It checks
 * English only, in five dialects; a writer in another language keeps the
 * browser's checker, as does one who switches the app's off, and a phone,
 * whose keyboard checks as it types.
 * Nothing corrects as the writer types.
 *
 * - **engine** - Harper as the worker runs it: the dialect and the words it
 *   is given, and paragraphs checked into plain data; the hash a lint is
 *   ignored by
 * - **worker** - The worker itself, one message at a time; loaded by the
 *   checker, so not exported here
 * - **checker** - The page's side: the worker started on first use, the
 *   settings it runs on, and what it found, cached by paragraph text
 * - **dialects** - The Language setting's dialects, and what the browser's
 *   language starts the settings on
 *
 * The editor draws what is found and offers the corrections
 * (`editor/spelling`, `EditorMenu.vue`); `composables/useSpelling` sets the
 * checker to the writer's settings and the project's words. Design:
 * `.llm/spelling_design.md`.
 *
 * @example
 * import { spellChecker } from '@/spelling'
 *
 * spellChecker.configure({ dialect: 'british', words: ['Tavrek'], grammar: true, ignored: [] })
 * await spellChecker.lint(['She walkd home.'])
 * spellChecker.cached('She walkd home.') // [{ from: 4, to: 9, kind: 'Spelling', … }]
 */

export {
  SPELLING_KINDS,
  baseWord,
  harperWords,
  hyphenatedIn,
  isHyphenated,
  lintHash,
  wordAround,
} from './engine.js'
export { createChecker, spellChecker } from './checker.js'
export { DIALECTS, checksByDefault, defaultDialect, dialectFor, isDialect } from './dialects.js'
