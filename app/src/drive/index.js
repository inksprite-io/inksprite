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
 * - **fetch** - A picked file looked up and fetched as a `File`: a Doc read
 *   through the Docs API and converted, Google's other types exported,
 *   anything else downloaded; and the link a Doc's document keeps to it
 * - **convert** - A Doc's structure, as the Docs API gives it, read into a
 *   document, with where each part of the document is in the Doc
 * - **write** - A document written back to its Doc: the Docs API requests
 *   that change only what differs, and what they cannot send yet
 * - **shape** - The writing's first pass: the Doc's tables made the
 *   document's shape, rows and columns put in and taken out, tables put in
 *   and deleted
 * - **merge** - A document and its Doc merged three ways against the base,
 *   the Doc as the two last agreed, with where both changed the same words
 * - **sync** - A linked document and its Doc made one: read, merged,
 *   written and read again, the document's words standing where both changed them
 * - **apply** - The Docs API's requests applied as Docs applies them: what
 *   a sync expects its write to leave
 * - **comments** - A document's comment threads and its Doc's made one at
 *   each sync: new ones, replies, edits, resolves and reopens both ways
 * - **suggestions** - The Doc's suggested edits as the document's own
 *   suggestions, laid in again at each sync, who made each, and accepting
 *   and rejecting both ways
 * - **folders** - Where a Doc inksprite made is kept in Drive:
 *   `inksprite-sync`, the project, its folders, made, renamed and moved to
 *   match the project
 * - **session** - The sign-in a sync works with, kept between syncs: a
 *   token for the hour, and a refresh token in the desktop app
 * - **api** - Asking Google with the token: a Doc read, edits written
 *   against a revision, whose Drive it is, and refusals said for the writer
 * - **docsTypes** - The parts of a Doc the converter reads, as types
 * - **export** - What Google's markdown export of a Doc gets wrong, put
 *   right, for a Doc the converter is not given
 * - **errors** - What stops an import, said for the writer
 *
 * A Doc's document stays linked to it, and **Sync**, on its menu or over it
 * in the editor, makes the two one through the Docs API: what each side
 * changed since they last agreed goes into the Doc, edited in place so its
 * comments and pictures stay, and what the Doc then holds comes back into
 * the document as edits.
 *
 * The importing itself is `useDriveImport`, the dialog the tree opens is
 * `DriveImportDialog.vue`, and the page the popup comes back to is
 * `GoogleCallback.vue`. Syncing is `useDriveSync`. Design:
 * `.llm/google_docs_design.md`.
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
export {
  DriveError,
  NotGrantedError,
  PopupBlockedError,
  SignInLapsedError,
  StaleRevisionError,
} from './errors.js'
export {
  pickInBrowser,
  pickInPopup,
  readReturn,
  refreshSession,
  relayReturn,
  signInInBrowser,
  signInInPopup,
} from './signIn.js'
export {
  convertPicked,
  describePicked,
  fetchDocPictures,
  fetchPicked,
  linkFor,
  requestFor,
} from './fetch.js'
export { accountOf, readDocument, writeDocument } from './api.js'
export { readDoc, tabsOf } from './convert.js'
export { writeDoc } from './write.js'
export { mergeDocs, sameDocs, settle } from './merge.js'
export { applyRequests } from './apply.js'
export { syncDoc } from './sync.js'
export { laySuggestions, settlesToSend, suggestionThreads } from './suggestions.js'
export { forgetSession, keepSession, signInFor } from './session.js'
export { mendExport } from './export.js'
