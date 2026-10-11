/**
 * @module platform/persistence
 * @description Whether the browser keeps the writer's work: asking it to,
 * and what to tell the writer about how long it will.
 *
 * Everything the writer makes is in the page's own storage, which a browser
 * may delete:
 *
 * - **Short of disk space**, any browser deletes the data of the sites it
 *   was not asked to keep, the least recently used first. A site that asks
 *   and is granted is kept until the writer clears it themselves. Chrome and
 *   Edge decide by how the site has been used, asking no one, so the page
 *   asks again on each start. Firefox asks the writer and remembers the
 *   answer, so the page asks only once there is a project to keep. In the
 *   desktop window the main process grants it.
 * - **Safari** deletes a site's data after a week of browsing without a
 *   click, tap or key press on it, which asking does not change. A site
 *   added to the Home Screen on an iPhone or iPad is exempt.
 */

/** Whether this page load has asked: once is enough, whatever the answer. */
let asked = false

/**
 * Ask the browser to keep the page's data, once a page load. Never throws.
 *
 * @returns {Promise<boolean>} Whether the data is kept
 */
export async function askToKeepData() {
  const storage = globalThis.navigator?.storage
  if (!storage?.persist) return false
  try {
    if (await storage.persisted()) return true
    if (asked) return false
    asked = true
    return await storage.persist()
  } catch (error) {
    console.error('Failed to ask the browser to keep the data:', error)
    return false
  }
}

/**
 * What the page is in, as far as the advice depends on it.
 *
 * @typedef {Object} BrowserTraits
 * @property {string} userAgent
 * @property {number} maxTouchPoints - An iPad sends a Mac's user agent; only
 *   its touch screen tells the two apart
 * @property {boolean} standalone - Opened from the Home Screen or the Dock,
 *   rather than in a browser tab
 */

/**
 * What the writer is told about keeping their work, beyond that it is in the
 * browser.
 *
 * @typedef {Object} StorageAdvice
 * @property {boolean} clearsAfterAWeek - Safari, which deletes site data after a week of inactivity
 * @property {boolean} homeScreen - Safari in a tab on an iPhone or iPad, where the Home Screen is exempt
 * @property {boolean} desktopApp - A computer, which the desktop app runs on
 */

/**
 * The page's browser, as `storageAdvice` reads it.
 *
 * @returns {BrowserTraits}
 */
export function currentBrowser() {
  const navigator = globalThis.navigator
  const homeScreen = navigator && 'standalone' in navigator && navigator.standalone === true
  return {
    userAgent: navigator?.userAgent || '',
    maxTouchPoints: navigator?.maxTouchPoints || 0,
    standalone: Boolean(
      homeScreen || globalThis.matchMedia?.('(display-mode: standalone)').matches
    ),
  }
}

/**
 * What to tell the writer about keeping their work in this browser.
 *
 * Safari is told apart by the `Version/` every Safari sends and the others
 * on iOS do not, or send beside a name of their own. Only Safari is warned
 * about the week: whether the other browsers on iOS, which run on WebKit,
 * clear data the same way is not documented. A Mac's Dock app is still
 * warned, since its exemption is not documented either.
 *
 * @param {BrowserTraits} [browser]
 * @returns {StorageAdvice}
 */
export function storageAdvice(browser = currentBrowser()) {
  const { userAgent, maxTouchPoints, standalone } = browser
  const ios =
    /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  const safari =
    /Version\/[\d.]+.* Safari\//.test(userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|DuckDuckGo|Chrome\/|Chromium\/|Edg\/|Android/.test(userAgent)
  return {
    clearsAfterAWeek: safari && !(ios && standalone),
    homeScreen: safari && ios && !standalone,
    desktopApp: !ios && !/Android/.test(userAgent),
  }
}
