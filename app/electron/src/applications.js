/**
 * On a Mac, the app offering to move itself into the Applications folder when
 * it was opened from somewhere else: straight from the DMG, or from Downloads.
 * macOS runs an app opened there from a read-only copy, which the updater
 * can't replace, so it would never update.
 *
 * It asks on each start while it's outside Applications, as Mac apps do,
 * until it's moved or the writer ticks Don't ask again, which is kept in the
 * app's data folder. Moving it quits this copy and opens the one in
 * Applications.
 */

import { app, dialog } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { logLine } from './log.js'

/** The answers, in the order the dialog has them. */
const MOVE = 0
const NOT_NOW = 1

/** The file whose being there means Don't ask again was ticked. */
const QUIET = 'never-ask-to-move'

/** Where the answer is kept: the app's data folder, which a move keeps. */
const quietFile = () => path.join(app.getPath('userData'), QUIET)

/**
 * Whether to ask: a packaged app on a Mac, outside Applications, not told
 * Don't ask again.
 *
 * @returns {Promise<boolean>}
 */
export async function shouldOfferMove() {
  if (process.platform !== 'darwin' || !app.isPackaged || app.isInApplicationsFolder()) return false
  return readFile(quietFile()).then(
    () => false,
    () => true
  )
}

/**
 * Ask, and move the app if the writer says so. Resolves to whether the app is
 * moving, in which case this copy quits and nothing else should start.
 *
 * @returns {Promise<boolean>}
 */
export async function offerMoveToApplications() {
  if (!(await shouldOfferMove())) return false
  const { response, checkboxChecked } = await dialog.showMessageBox({
    type: 'question',
    message: 'Move inksprite to the Applications folder?',
    detail: 'It can only update itself from there.',
    buttons: ['Move to Applications', 'Not now'],
    defaultId: MOVE,
    cancelId: NOT_NOW,
    checkboxLabel: "Don't ask again",
  })
  if (response !== MOVE) {
    if (checkboxChecked) await writeFile(quietFile(), '').catch(() => {})
    return false
  }
  try {
    // An older copy already there is replaced: this is the one just opened.
    return app.moveToApplicationsFolder({ conflictHandler: () => true })
  } catch (error) {
    await logLine(`not moved to Applications: ${/** @type {Error} */ (error).message}`)
    await dialog.showMessageBox({
      type: 'error',
      message: "inksprite couldn't be moved to the Applications folder.",
      detail: 'Drag it there from the Finder instead.',
    })
    return false
  }
}
