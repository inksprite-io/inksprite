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
 * asked. Or nothing, for longer than it is waited on.
 * @typedef {{response: object}|{pass: Pass}|{late: true}} PageAnswer
 */

/**
 * How long a page is waited on. Long, since a call may open a project and
 * read or write all of it; a limit at all, since a page that has stopped
 * would otherwise leave the app waiting with nothing said.
 */
export const PATIENCE_MS = 5 * 60_000

/**
 * What a page is told of the connection asking, and of where its app
 * reaches this computer, for a link it is to fetch. Not its token.
 *
 * @param {import('./apps.js').AppConnection} connection
 * @param {string} address
 */
const forPage = ({ id, name, projects, readOnly }, address) => ({
  id,
  name,
  projects,
  readOnly,
  address,
})

/**
 * A way to ask the app's windows.
 *
 * @param {() => Electron.WebContents[]} pages - The windows' pages, the one
 *   in front first
 * @param {Object} [options]
 * @param {number} [options.patience] - How long a page is waited on, in
 *   milliseconds
 */
export function windowAsker(pages, { patience = PATIENCE_MS } = {}) {
  let asked = 0
  /** @type {Map<string, (answer: unknown) => void>} */
  const waiting = new Map()

  /**
   * Ask one page, and wait for its answer, for it to go (closed, reloaded,
   * or its process ended, any of which takes the answer with it), for the
   * app asking to give up, or for as long as a page is waited on.
   *
   * @param {Electron.WebContents} page
   * @param {ReturnType<typeof forPage>} asking - Who asks, as a page is told
   * @param {object} message
   * @param {AbortSignal} signal
   * @returns {Promise<PageAnswer>}
   */
  const askPage = (page, asking, message, signal) =>
    new Promise(resolve => {
      if (page.isDestroyed()) return resolve({ pass: 'gone' })
      const request = ++asked
      const key = `${page.id}:${request}`
      const done = (/** @type {PageAnswer} */ answer) => {
        waiting.delete(key)
        clearTimeout(limit)
        page.off('destroyed', gone)
        page.off('render-process-gone', gone)
        page.off('did-start-navigation', left)
        signal.removeEventListener('abort', stopped)
        resolve(answer)
      }
      // What the page said, read as an answer or as a pass and nothing else.
      const said = (/** @type {any} */ answer) =>
        done(
          answer?.response && typeof answer.response === 'object'
            ? { response: answer.response }
            : { pass: typeof answer?.pass === 'string' ? answer.pass : 'unready' }
        )
      const gone = () => done({ pass: 'gone' })
      // The page is another once its window loads again; a link followed
      // within it (the app's own routes) leaves it the same one.
      const left = (/** @type {{isMainFrame?: boolean, isSameDocument?: boolean}} */ event) => {
        if (event?.isMainFrame && !event.isSameDocument) gone()
      }
      const stop = () => {
        if (!page.isDestroyed()) page.send('apps:cancel', request)
      }
      const stopped = () => {
        stop()
        gone()
      }
      const limit = setTimeout(() => {
        stop()
        done({ late: true })
      }, patience)
      waiting.set(key, said)
      page.once('destroyed', gone)
      page.once('render-process-gone', gone)
      page.on('did-start-navigation', left)
      signal.addEventListener('abort', stopped)
      page.send('apps:call', request, asking, message)
    })

  return {
    /**
     * Have a window answer what an app asked.
     *
     * @param {import('./apps.js').AppConnection} connection
     * @param {object} message - The request, as the app sent it
     * @param {AbortSignal} signal - Aborted when the app gives up on it
     * @param {string} address - Where the app reaches this computer
     * @returns {Promise<object>} The answer, as the app is sent it
     * @throws {Error} When no window could answer, or the one asked took too
     *   long, saying why in words the app's model can read
     */
    async ask(connection, message, signal, address) {
      const open = pages()
      if (open.length === 0) throw new Error('inksprite has no window open.')
      const asking = forPage(connection, address)
      /** @type {Pass[]} */
      const passes = []
      for (const page of open) {
        const answer = await askPage(page, asking, message, signal)
        if (signal.aborted) throw new Error('The request was given up on.')
        if ('response' in answer) return answer.response
        // No other window is asked: this one may have done what was asked.
        if ('late' in answer) {
          throw new Error(
            'inksprite took too long to answer. What was asked may have been done all the same: look before asking again.'
          )
        }
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
