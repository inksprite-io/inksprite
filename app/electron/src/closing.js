/**
 * A window closed, or the app quit, without losing what the writer did last.
 *
 * The page holds an edit back for a moment before it saves it, in the open
 * document and then in its store, and the window would take it along as it
 * went. So a window about to close asks its page to save first
 * (`useSaveBeforeClosing` in the page), and closes once the page says it
 * has, or once it has had long enough: a page that has stopped answering
 * never keeps the app open.
 *
 * Quitting closes the windows, and a window that waits stops the quit, so
 * once the page has saved, the app is quit again. An update installing
 * closes them too, but the page saved before it asked for the install
 * (`useUpdates`), and nothing is to stop that.
 */

import { app, ipcMain } from 'electron'
import { installingUpdate } from './updates.js'

/** How long a page has to save before its window closes all the same. */
export const SAVE_WAIT_MS = 10_000

/** Sent to the page to ask it to save. */
const SAVE = 'window:save'

/** Sent back by the page once it has. */
const SAVED = 'window:saved'

/** Whether the app is quitting, and is to quit again once the page has saved. */
let quitting = false
app.on('before-quit', () => {
  quitting = true
})

/**
 * Have a window's page save before the window closes.
 *
 * @param {Electron.BrowserWindow} window
 */
export function saveBeforeClosing(window) {
  /** Whether the page has saved, or had its time to, and the window may go. */
  let saved = false
  /** Whether the page has been asked, and the window is waiting on it. */
  let asked = false
  window.on('close', event => {
    if (saved || installingUpdate()) return
    event.preventDefault()
    if (asked) return
    asked = true
    askToSave(window.webContents).then(() => {
      saved = true
      if (quitting) app.quit()
      else if (!window.isDestroyed()) window.close()
    })
  })
}

/**
 * Ask a page to save, and wait until it says it has, or until it has had
 * `SAVE_WAIT_MS`.
 *
 * @param {Electron.WebContents} contents
 * @returns {Promise<void>}
 */
function askToSave(contents) {
  return new Promise(resolve => {
    if (contents.isDestroyed() || contents.isCrashed()) {
      resolve()
      return
    }
    const done = () => {
      clearTimeout(timer)
      ipcMain.removeListener(SAVED, heard)
      resolve()
    }
    /** @param {Electron.IpcMainEvent} event */
    const heard = event => {
      if (event.sender === contents) done()
    }
    const timer = setTimeout(done, SAVE_WAIT_MS)
    ipcMain.on(SAVED, heard)
    contents.send(SAVE)
  })
}
