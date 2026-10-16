import { driveAvailable } from '@/drive/config.js'

/**
 * The ways into a folder, as menu items: files chosen together, a folder whole
 * with the folders inside it, a character card from the library, Google
 * Drive, and a codebase. A folder's Import submenu offers them, and so does
 * the Import button at the top of the outline, for the project's top; one
 * list, so the two can't drift apart.
 *
 * @param {Object} on - What each does
 * @param {() => void} on.files
 * @param {() => void} on.folder
 * @param {(() => void)|null} [on.card] - Left out while the AI is off
 * @param {() => void} on.drive
 * @param {() => void} on.repository
 * @returns {Array<{label: string, icon: string, command: () => void}>}
 */
export const importItems = on => [
  { label: 'Files…', icon: 'pi pi-file', command: () => on.files() },
  { label: 'Folder…', icon: 'pi pi-folder-open', command: () => on.folder() },
  // Picked in the card library, where one not in it yet can be added.
  ...(on.card
    ? [{ label: 'Character card…', icon: 'pi pi-id-card', command: () => on.card?.() }]
    : []),
  // Picked in Google's picker; only where the build has a Google project and
  // the page can sign in to it.
  ...(driveAvailable()
    ? [{ label: 'Google Drive…', icon: 'pi pi-google', command: () => on.drive() }]
    : []),
  // A codebase, to write about: from GitHub or a folder, read-only.
  { label: 'Repository…', icon: 'pi pi-code', command: () => on.repository() },
]
