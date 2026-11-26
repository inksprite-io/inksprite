/**
 * The app's log: `inksprite.log` in its logs folder
 * (`~/Library/Logs/inksprite` on a Mac, `%APPDATA%\inksprite\logs` on
 * Windows, `~/.config/inksprite/logs` on Linux). An installed app has no
 * terminal to say things in, so what is worth knowing afterwards goes here:
 * what a page died of (`gone.js`), and whether an update was signed as ours,
 * or why it couldn't be downloaded (`updates.js`).
 *
 * It was `windows.log` while it held only what the app's windows died of,
 * which read as the log for Windows. One from then is left where it is.
 */

import { app } from 'electron'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

/** The log, in the app's logs folder. */
const LOG_FILE = 'inksprite.log'

/**
 * Add a line to the log, dated. A log that can't be written is no reason to
 * get in the way of what was being done.
 *
 * @param {string} said
 * @returns {Promise<void>}
 */
export async function logLine(said) {
  const line = `${new Date().toISOString()} ${said}`
  console.error(line)
  try {
    const folder = app.getPath('logs')
    await mkdir(folder, { recursive: true })
    await appendFile(path.join(folder, LOG_FILE), `${line}\n`)
  } catch (error) {
    console.error(`The log couldn't be written: ${error.message}`)
  }
}
