/**
 * @module cloud/onDemand
 * @description Files' bytes that sync leaves on the server until they are
 * wanted, as the app asks for them.
 *
 * A device syncing a project takes its files' records at once, and their
 * text is already their documents' content, which the tree, search and the
 * model read. The bytes, a rulebook's two hundred megabytes, stay on the
 * server until something wants the file itself: the viewer, a conversion, a
 * download, a backup. Then they are fetched and kept.
 *
 * Sync provides the fetching while the device is signed in
 * (`composables/useCloudSync`); with no account, there is nothing elsewhere.
 * Kept apart from sync so that the files store can ask without importing
 * it, which imports the files store.
 *
 * Design: `.llm/sync_design.md`, "Files".
 */

/**
 * @typedef {Object} FileSource
 * @property {(id: string) => Promise<boolean>} has - Whether a file's bytes
 *   are on the server and not here
 * @property {(id: string, progress?: Progress) => Promise<Blob|null>} fetch -
 *   Fetch them now, and keep them here
 * @property {(storyIds?: string[]) => Promise<number>} fetchProjects - Fetch
 *   every file of these projects still on the server alone; resolves to how
 *   many are left
 */

/**
 * Told how far a download has got, in parts.
 * @typedef {(done: number, total: number) => void} Progress
 */

/** @type {FileSource|null} */
let source = null

/**
 * Fetch files from here on, until the returned call stops it.
 *
 * @param {FileSource} next
 * @returns {() => void}
 */
export function provideFiles(next) {
  source = next
  return () => {
    if (source === next) source = null
  }
}

/**
 * Whether a file's bytes are on the sync server and not on this device.
 *
 * @param {string} id - The file document's id
 * @returns {Promise<boolean>}
 */
export async function fileElsewhere(id) {
  try {
    return (await source?.has(id)) ?? false
  } catch {
    return false
  }
}

/**
 * A file's bytes from the sync server, kept here once fetched.
 *
 * @param {string} id
 * @param {Progress} [progress]
 * @returns {Promise<Blob|null>} Null when they are nowhere else
 * @throws {Error} When they are there and can't be fetched now
 */
export function fetchElsewhere(id, progress) {
  return source ? source.fetch(id, progress) : Promise.resolve(null)
}

/**
 * Have every file of these projects here, as a backup of them wants.
 *
 * @param {string[]} [storyIds] - Every project when absent
 * @throws {Error} When some can't be fetched now
 */
export async function fetchProjectFiles(storyIds) {
  const left = source ? await source.fetchProjects(storyIds) : 0
  if (left > 0) {
    throw new Error(
      left === 1
        ? "A file isn't on this device yet, and couldn't be downloaded. Connect and try again."
        : `${left} files aren't on this device yet, and couldn't be downloaded. Connect and try again.`
    )
  }
}
