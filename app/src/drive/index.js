/**
 * @module drive
 * @description Files brought in from the writer's Google Drive: a Google
 * Doc as markdown, anything else as importing it from disk would make it.
 *
 * The writer picks the files on Google's own page: its sign-in, asked to
 * show its picker, comes back with the picked files' ids and a token that
 * reaches those files and nothing else in their Drive (`drive.file`). In a
 * browser that page is a popup and comes back to `/connect/google`; in the
 * desktop window it is the system browser and comes back to the app's
 * listener on localhost. Nothing of Google's loads in the app's page, and
 * nothing goes to Google until the writer imports. No folders: a picked
 * folder grants nothing inside it.
 *
 * - **config** - The build's Google client for where the app runs, and
 *   whether the import is offered
 * - **signIn** - Google's sign-in with its picker, in a popup or the system
 *   browser, and what it came back with
 * - **fetch** - A picked file looked up and fetched as a `File`: Google's own
 *   types exported, anything else downloaded
 * - **images** - The pictures in a Doc's markdown taken out before the
 *   importer sees it
 * - **errors** - What stops an import, said for the writer
 *
 * The importing itself is `useDriveImport`, the dialog the tree opens is
 * `DriveImportDialog.vue`, and the page the popup comes back to is
 * `GoogleCallback.vue`. Design: `.llm/google_docs_design.md`.
 *
 * @example
 * import { driveConfig } from '@/drive/config.js'
 * import { pickInPopup } from '@/drive/signIn.js'
 * import { describePicked, fetchPicked } from '@/drive/fetch.js'
 *
 * // From a click, in a browser:
 * const picked = await pickInPopup(driveConfig().clientId)
 * for (const id of picked.ids) {
 *   const file = await fetchPicked(await describePicked(id, picked.token), picked.token)
 * }
 */

export { driveConfig, driveAvailable } from './config.js'
export { DriveError, PopupBlockedError, SignInLapsedError } from './errors.js'
export { pickInBrowser, pickInPopup, readReturn, relayReturn } from './signIn.js'
export { describePicked, fetchPicked, requestFor } from './fetch.js'
export { takeImages } from './images.js'
