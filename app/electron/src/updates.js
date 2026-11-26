/**
 * Updates from the public repository's latest release.
 *
 * electron-updater reads the release's `latest*.yml` (the address is in
 * `electron-builder.yml`, under `publish`), downloads the update for this
 * platform, and checks it against the hash the file gives. On a Mac, the
 * system checks too that the new app is signed by the same developer as this
 * one; on Windows, the updater checks that the installer is signed under the
 * name this app was built with (`publisherName` in `electron-builder.yml`).
 * On Windows and Linux the app checks the download against a signature of
 * its own too, made as the release was built (`updateSignature.js`), since
 * Linux has no other and Windows had none before, and says in its log how
 * that went. An update
 * no key the app was built with answers for is refused, once the check has
 * been seen to work; until then it is offered all the same (`UPDATE_CHECK` in
 * `updateKeys.js`). The page asks for the download and says when to install
 * it (`src/composables/useUpdates.js`); nothing is installed unasked, not
 * even on quitting. An app run from the checkout never looks.
 */

import { basename } from 'node:path'
import { app, net } from 'electron'
import electronUpdater from 'electron-updater'
import { logLine } from './log.js'
import { UPDATE_CHECK, UPDATE_KEYS } from './updateKeys.js'
import { hashOf, signatureProblem } from './updateSignature.js'

/** Where a release's files are, by its tag: an update's signature among them. */
const RELEASES = 'https://github.com/inksprite-io/inksprite/releases/download'

const { autoUpdater } = electronUpdater
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

/** The version downloaded, ready to install. @type {string|null} */
let downloaded = null

/** The look under way, if any. @type {Promise<string|null>|null} */
let looking = null

/** Whether the app is quitting to install an update. */
let installing = false

/**
 * Look for an update and download it.
 *
 * @returns {Promise<string|null>} The version downloaded, or null when the
 *   app is up to date or not a packaged build
 */
export async function downloadUpdate() {
  if (!app.isPackaged) return null
  if (downloaded) return downloaded
  looking ??= look().finally(() => (looking = null))
  return looking
}

/** @returns {Promise<string|null>} */
async function look() {
  const result = await autoUpdater.checkForUpdates()
  if (!result?.isUpdateAvailable) return null
  const files = await autoUpdater.downloadUpdate()
  const { version } = result.updateInfo
  if (checksSignature()) await checkSigned(version, files)
  downloaded = version
  return downloaded
}

/**
 * Whether an update here has to carry our own signature: on Windows and
 * Linux, in a build that has keys to check one with. A Mac's is checked by
 * the system.
 */
const checksSignature = () => process.platform !== 'darwin' && UPDATE_KEYS.length > 0

/**
 * Check a downloaded update against our signature, and say in the app's log
 * how it went, for whoever wants to know afterwards. Anything that goes
 * wrong in the checking, a signature that can't be fetched or a mistake
 * here, counts as the update not being shown to be ours.
 *
 * @param {string} version - The update's
 * @param {string[]} files - Where the updater put what it downloaded
 * @throws {Error} When it isn't shown to be ours, where such an update is
 *   refused (`UPDATE_CHECK`): it is then never offered, so never installed
 */
async function checkSigned(version, files) {
  const problem = await whyNotOurs(version, files).catch(
    error => `it could not be checked (${error.message})`
  )
  if (!problem) {
    await logLine(`update ${version}: signed as ours`)
    return
  }
  const refused = UPDATE_CHECK === 'refuse'
  const outcome = refused ? 'refused' : 'offered all the same, while the check only warns'
  await logLine(`update ${version}: not signed as ours: ${problem}; ${outcome}`)
  if (refused) throw new Error(`The update is not signed as ours: ${problem}.`)
}

/**
 * What is wrong with a downloaded update's signature, if anything: every
 * file of it has to be one we signed, for the version it says it is. The
 * signature is read from that version's own release, beside the file.
 *
 * @param {string} version
 * @param {string[]} files
 * @returns {Promise<string|null>} Null when it is ours
 */
async function whyNotOurs(version, files) {
  if (!Array.isArray(files) || files.length === 0) return 'the updater named no file'
  for (const file of files) {
    const name = encodeURIComponent(basename(file))
    const response = await net.fetch(`${RELEASES}/v${version}/${name}.sig`)
    if (!response.ok) return `it has no signature (${response.status})`
    const problem = signatureProblem(await response.text(), {
      version,
      file: basename(file),
      sha512: await hashOf(file),
      keys: UPDATE_KEYS,
    })
    if (problem) return problem
  }
  return null
}

/**
 * Install the update downloaded, and restart into it: silently, on Windows,
 * where the installer would otherwise show its pages. The page saves before
 * it asks, so the window is not to wait for it again (`closing.js`).
 */
export function installUpdate() {
  if (!downloaded) throw new Error('No update has been downloaded.')
  installing = true
  autoUpdater.quitAndInstall(true, true)
}

/** Whether the app is quitting to install an update. */
export const installingUpdate = () => installing
