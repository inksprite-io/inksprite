/**
 * A window whose page has died: a crash, or out of memory. Without this it
 * stays open and white, and nothing says why.
 *
 * What it died of goes in a log (`windows.log` in the app's logs folder:
 * `~/Library/Logs/inksprite` on a Mac), for an installed app has no terminal to
 * say it in. The writer is told it stopped, and can reload it or close it. A
 * page that dies again as it loads, on what it died of the first time, asks
 * again, so closing it is always there.
 */

import { app, dialog } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

/** The log, in the app's logs folder. */
const LOG_FILE = 'windows.log'

/** The answers, in the order the dialog has them. */
const RELOAD = 0
const CLOSE = 1

/** What can be said to the writer of why, by the reason Electron gives. */
const WHY = {
  oom: 'It ran out of memory.',
  'memory-eviction': 'It ran out of memory.',
  killed: 'The system stopped it.',
}

/** Whether the app is quitting, when a page going is what's meant to happen. */
let quitting = false
app.on('before-quit', () => {
  quitting = true
})

/**
 * Say in the log what a page died of. A log that can't be written is no reason
 * to get in the way of the window.
 *
 * @param {string} url - What the window was showing
 * @param {Electron.RenderProcessGoneDetails} details
 * @returns {Promise<void>}
 */
async function logGone(url, { reason, exitCode }) {
  const line = `${new Date().toISOString()} page gone: ${reason}, exit code ${exitCode}, at ${url}`
  console.error(line)
  try {
    const folder = app.getPath('logs')
    await mkdir(folder, { recursive: true })
    await appendFile(path.join(folder, LOG_FILE), `${line}\n`)
  } catch (error) {
    console.error(`The log couldn't be written: ${error.message}`)
  }
}

/**
 * When a window's page dies, log why, and offer to bring it back.
 *
 * @param {Electron.BrowserWindow} window
 */
export function offerReloadWhenGone(window) {
  let asking = false
  window.webContents.on('render-process-gone', async (_, details) => {
    if (details.reason === 'clean-exit' || quitting || window.isDestroyed()) return
    await logGone(window.webContents.getURL(), details)
    if (asking || window.isDestroyed()) return
    asking = true
    // One that died before it was first shown would have nothing to ask over.
    window.show()
    const { response } = await dialog.showMessageBox(window, {
      type: 'error',
      message: 'This window stopped working.',
      detail: [WHY[details.reason], 'Anything from the last few seconds may not be saved.']
        .filter(Boolean)
        .join(' '),
      buttons: ['Reload', 'Close window'],
      defaultId: RELOAD,
      cancelId: CLOSE,
    })
    asking = false
    if (window.isDestroyed()) return
    if (response === RELOAD) window.webContents.reload()
    // Destroyed rather than closed: closing asks the page to save first, and
    // there is no page to answer.
    else window.destroy()
  })
}
