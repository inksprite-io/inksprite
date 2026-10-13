/**
 * @module platform/closing
 * @description In the desktop app, saving before the window closes or the
 * app quits: the window waits for the page to say it has saved, or for long
 * enough (`app/electron/src/closing.js`). A browser closes a tab without
 * waiting.
 */

import { desktop, isDesktop } from './desktop.js'

/**
 * Have the desktop app wait for `save` before its window closes or it quits.
 * Nothing in a browser.
 *
 * @param {() => Promise<void>} save
 */
export function beforeClosing(save) {
  if (!isDesktop()) return
  // An app opened before the window knew to wait has no way to be asked.
  desktop().beforeClosing?.(save)
}
