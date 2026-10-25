/**
 * @module platform/python
 * @description In the desktop app, Python for the model to run code in: one
 * session for each chat, kept between its runs, where the code can reach
 * nothing of the writer's and nothing on the network. See
 * `app/electron/src/sandbox.js` and `.llm/code_sandbox_design.md`.
 */

import { desktop, isDesktop } from './desktop.js'

/** @typedef {import('./desktop.js').PythonRun} PythonRun */
/** @typedef {import('./desktop.js').PythonProjectEntry} PythonProjectEntry */

/**
 * Whether Python can be run here: in the desktop app, one new enough to have
 * it.
 *
 * @returns {boolean}
 */
export const hasPython = () => isDesktop() && Boolean(desktop().python)

/**
 * Run code in a session's Python, after any of its runs before. A stop of
 * `signal` stops the run, and the session's Python with it, as does its time
 * running out.
 *
 * @param {string} session - The chat's id
 * @param {string} code
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {number|null} [options.timeoutMs] - None unless given
 * @param {PythonProjectEntry[]|null} [options.project] - What the code finds
 *   at `/project`, and can't change
 * @param {string|null} [options.filename] - What its traceback calls the
 *   code, when it was read from a file
 * @param {(id: string) => Promise<string|null>} [options.fetchFile] - Brings a
 *   file of the project still only on the sync server into the library when
 *   the code reads it, and says where it is there
 * @returns {Promise<PythonRun>}
 * @throws {Error} Outside the desktop app, or in one without Python
 */
export async function runPython(
  session,
  code,
  { signal, timeoutMs = null, project = null, filename = null, fetchFile } = {}
) {
  const python = hasPython() ? desktop().python : null
  if (!python) throw new Error('Python runs only in the desktop app.')
  const stop = () => python.stop(session)
  signal?.addEventListener('abort', stop, { once: true })
  try {
    return await python.run(session, code, { timeoutMs, project, filename }, fetchFile)
  } finally {
    signal?.removeEventListener('abort', stop)
  }
}
