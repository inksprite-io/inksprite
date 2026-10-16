/**
 * @module spelling/worker
 * @description The worker Harper runs in, off the page's thread. It takes one
 * message at a time, in the order they were sent, so a change of dictionary
 * is in place before the paragraphs sent after it are checked.
 *
 * Messages in: `{ id, type: 'configure', dialect, words }` and
 * `{ id, type: 'lint', texts }`. Out: `{ id }`, `{ id, results }`, or
 * `{ id, error }`.
 *
 * Harper's own `WorkerLinter` is not used: it starts its worker from a
 * `blob:` address, which the page's Content-Security-Policy refuses. This one
 * is a file of the app's own. Harper's slim build is the one loaded; its full
 * build fetches both of its WebAssembly files.
 */

/* global self */

import { LocalLinter } from 'harper.js'
import { slimBinary } from 'harper.js/slimBinary'
import { configure, lintTexts } from './engine.js'

/** @type {LocalLinter|null} */
let linter = null

/** The hyphenated words it was told, which Harper isn't. */
let hyphenated = new Set()

/** The messages so far, handled one after another. */
let queue = Promise.resolve()

/**
 * @param {{ id: number, type: 'configure'|'lint', dialect?: any, words?: string[], texts?: string[] }} message
 */
async function handle({ id, type, ...rest }) {
  try {
    linter ??= new LocalLinter({ binary: slimBinary })
    if (type === 'configure') {
      hyphenated = await configure(linter, { dialect: rest.dialect, words: rest.words ?? [] })
      self.postMessage({ id })
    } else if (type === 'lint') {
      self.postMessage({ id, results: await lintTexts(linter, rest.texts ?? [], hyphenated) })
    }
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
}

self.onmessage = ({ data }) => {
  queue = queue.then(() => handle(data))
}
