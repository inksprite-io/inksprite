/* global Element, HTMLAnchorElement */
/**
 * @module platform/open
 * @description Links to other sites, opened outside the app.
 *
 * In a browser a link opens in a new tab, never in the app's own. In the
 * desktop window it opens in the system browser: the window has no tabs, and
 * a link followed there takes the app's place. Only web and mail links open;
 * the page shows what models write, and anything else in an address, a
 * `javascript:` or a `file:`, is not followed. The desktop side refuses those
 * too.
 */

import { isDesktop } from './desktop.js'

/** What a link may open. */
const SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/**
 * The address a link goes to, if it is one that may open.
 *
 * @param {string} href
 * @returns {URL|null}
 */
function openable(href) {
  try {
    const url = new URL(href, globalThis.location?.href)
    return SCHEMES.has(url.protocol) ? url : null
  } catch {
    return null
  }
}

/**
 * Open a link outside the app.
 *
 * @param {string} href
 * @returns {Promise<boolean>} Whether it was one that may open
 */
export async function openUrl(href) {
  const url = openable(href)
  if (!url) return false
  if (isDesktop()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('open_in_browser', { url: url.href })
    return true
  }
  // A link of our own making, so that the browser opens it as it would one
  // that was clicked: a new tab without this page as its opener, or the mail
  // app for mail.
  const anchor = document.createElement('a')
  anchor.href = url.href
  if (url.protocol !== 'mailto:') {
    anchor.target = '_blank'
    anchor.rel = 'noopener noreferrer'
  }
  anchor.click()
  return true
}

/**
 * For a click anywhere in the page: a link to another site opens outside the
 * app. Links in the app itself are the router's, and links in the editor are
 * text being written. A browser already sends a link with a target, a mail
 * link, or a click with a modifier somewhere other than this tab.
 *
 * @param {MouseEvent} event
 */
export function openLinkClicked(event) {
  if (event.defaultPrevented || event.button !== 0) return
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (!(anchor instanceof HTMLAnchorElement) || anchor.isContentEditable) return
  const url = openable(anchor.href)
  if (!url || url.origin === globalThis.location?.origin) return
  const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
  if (!isDesktop() && (anchor.target === '_blank' || url.protocol === 'mailto:' || modified)) {
    return
  }
  event.preventDefault()
  openUrl(url.href)
}
