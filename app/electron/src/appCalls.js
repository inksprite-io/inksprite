/**
 * What an app asks (`appServer.js`), handed to a window to answer. The tools
 * run in a page, and a project is in one window at a time
 * (`src/platform/windows.js` in the page), so the windows are asked in turn,
 * the one in front first: the page that has the project, or can take it for
 * the call, answers, and one that can't passes, saying why. The page's end is
 * `src/apps/` behind `src/platform/apps.js`.
 */

/**
 * Why a page passed a request on: the project is in another window; this
 * window is behind on it; its page isn't ready to answer; or it closed.
 * @typedef {'elsewhere'|'behind'|'unready'|'gone'} Pass
 */

/**
 * What a page says to a request: its answer, or that another window is to be
 * asked.
 * @typedef {{response: object}|{pass: Pass}} PageAnswer
 */

/**
 * What a page is told of the connection asking. Not its token.
 *
 * @param {import('./apps.js').AppConnection} connection
 */
const forPage = ({ id, name, projects, edit, comment }) => ({ id, name, projects, edit, comment })

/**
 * A way to ask the app's windows.
 *
 * @param {() => Electron.WebContents[]} pages - The windows' pages, the one
 *   in front first
 */
export function windowAsker(pages) {
  let asked = 0
  /** @type {Map<string, (answer: unknown) => void>} */
  const waiting = new Map()

  /**
   * Ask one page, and wait for its answer, for it to close, or for the app
   * asking to give up.
   *
   * @param {Electron.WebContents} page
   * @param {import('./apps.js').AppConnection} connection
   * @param {object} message
   * @param {AbortSignal} signal
   * @returns {Promise<PageAnswer>}
   */
  const askPage = (page, connection, message, signal) =>
    new Promise(resolve => {
      if (page.isDestroyed()) return resolve({ pass: 'gone' })
      const request = ++asked
      const key = `${page.id}:${request}`
      const done = (/** @type {unknown} */ answer) => {
        waiting.delete(key)
        page.off('destroyed', gone)
        signal.removeEventListener('abort', stopped)
        const said = /** @type {any} */ (answer)
        resolve(
          said?.response && typeof said.response === 'object'
            ? { response: said.response }
            : { pass: typeof said?.pass === 'string' ? said.pass : 'unready' }
        )
      }
      const gone = () => done({ pass: 'gone' })
      const stopped = () => {
        if (!page.isDestroyed()) page.send('apps:cancel', request)
        done({ pass: 'gone' })
      }
      waiting.set(key, done)
      page.once('destroyed', gone)
      signal.addEventListener('abort', stopped)
      page.send('apps:call', request, forPage(connection), message)
    })

  return {
    /**
     * Have a window answer what an app asked.
     *
     * @param {import('./apps.js').AppConnection} connection
     * @param {object} message - The request, as the app sent it
     * @param {AbortSignal} signal - Aborted when the app gives up on it
     * @returns {Promise<object>} The answer, as the app is sent it
     * @throws {Error} When no window could answer, saying why in words the
     *   app's model can read
     */
    async ask(connection, message, signal) {
      const open = pages()
      if (open.length === 0) throw new Error('inksprite has no window open.')
      /** @type {Pass[]} */
      const passes = []
      for (const page of open) {
        const answer = await askPage(page, connection, message, signal)
        if (signal.aborted) throw new Error('The request was given up on.')
        if ('response' in answer) return answer.response
        passes.push(answer.pass)
      }
      throw new Error(
        passes.some(pass => pass === 'elsewhere' || pass === 'behind')
          ? 'The project couldn’t be opened. Open it in inksprite and try again.'
          : 'inksprite isn’t ready. Try again in a moment.'
      )
    },

    /**
     * A page's answer to what it was asked.
     *
     * @param {number} pageId - The page it came from
     * @param {unknown} request - The number it was asked under
     * @param {unknown} answer
     */
    answered(pageId, request, answer) {
      waiting.get(`${pageId}:${String(request)}`)?.(answer)
    },
  }
}
