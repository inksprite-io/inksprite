/**
 * @module utils/webkit
 * @description Whether the page is running in WebKit.
 *
 * Asked only where WebKit does something no feature test can show: its
 * `ImageDecoder` on Linux brings the page down (see `files/pdf`). WebKit is
 * Safari, the desktop app's window on the Mac and on Linux, and every browser
 * on iOS whatever it calls itself: those send `CriOS/` or `EdgiOS/` rather
 * than `Chrome/` or `Edg/`.
 */

/**
 * @param {string} [userAgent]
 * @returns {boolean}
 */
export function isWebKit(userAgent = globalThis.navigator?.userAgent || '') {
  return /AppleWebKit/.test(userAgent) && !/Chrome\/|Chromium\/|Edg\//.test(userAgent)
}
