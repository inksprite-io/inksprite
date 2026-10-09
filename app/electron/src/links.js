/**
 * Links the app hands to the system: to the browser, or to the mail app.
 *
 * The page shows what models write, so only web and mail links are opened,
 * whatever asks: the page (`src/platform/open.js`), a link that would take
 * the window somewhere else, or a window the page tries to open.
 */

/** The schemes a link may open with. */
const SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/**
 * Whether `url` is a web or mail link.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function openable(url) {
  try {
    return SCHEMES.has(new URL(url).protocol)
  } catch {
    return false
  }
}

/**
 * Whether `url` is a web address: what a sign-in may open.
 *
 * @param {string} url
 * @returns {boolean}
 */
export function webAddress(url) {
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * A URL's origin, as `scheme://host`. `URL.origin` is "null" for a scheme
 * Node doesn't know, the page's own among them.
 *
 * @param {string} url
 * @returns {string|null}
 */
export function originOf(url) {
  try {
    const { protocol, host } = new URL(url)
    return `${protocol}//${host}`
  } catch {
    return null
  }
}
