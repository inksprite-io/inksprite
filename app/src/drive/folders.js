/**
 * @module drive/folders
 * @description Where a Doc inksprite made is kept in the writer's Drive:
 * in `inksprite-sync`, in a folder for its project, in a folder for each
 * folder its document is in, under the document's title.
 *
 * The folders are inksprite's own, made where they are missing, and found
 * again by the private properties Drive keeps for the app on each (its
 * project's id, or its folder's), not by name: another device finds the
 * same ones, two projects of one name have one each, and a project renamed
 * here keeps its folder, which a sync renames to match. A folder or a Doc
 * moved or renamed here is moved or renamed in Drive at the next sync. The
 * top folder is the writer's to put where they like and call what they
 * like, once it is made. `drive.file` reaches all of it, since the app made
 * it; a folder the writer made is not seen, and nothing in it is touched.
 * Drive keeps no order in a folder, so an ordered folder's order stays here.
 */

import { FILES, ask } from './api.js'

/** A Drive folder's type. */
const FOLDER_TYPE = 'application/vnd.google-apps.folder'

/** The folder they all go in, at the top of My Drive. */
export const TOP = 'inksprite-sync'

/** The property every folder inksprite makes has. */
const MARK = { key: 'inksprite', value: 'folder' }

/** The property that says which a folder is: the top, a project's, or a folder's. */
const KEY = 'inkspriteKey'

/**
 * Where a document is here.
 *
 * @typedef {Object} Place
 * @property {{id: string, title: string}} project
 * @property {Array<{id: string, title: string}>} folders - The folders it is
 *   in, from the project's top down
 * @property {string} title - Its own
 */

/**
 * A Drive folder as listed.
 *
 * @typedef {{id: string, name: string, parents?: string[], appProperties?: Record<string, string>}} DriveFolder
 */

/**
 * The Drive folder a document's Doc goes in: each folder on the way made
 * where it is missing, and renamed or moved where it is not as the project
 * has it.
 *
 * @param {Place} place
 * @param {string} token
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<string>} Its id
 */
export async function folderFor(place, token, { signal } = {}) {
  const made = new Map()
  for (const folder of await listFolders(token, signal)) {
    const key = folder.appProperties?.[KEY]
    if (key && !made.has(key)) made.set(key, folder)
  }
  // The top as the writer left it; the rest as the project has it.
  let parent = (await ensure(made.get('top'), TOP, 'top', undefined, token, signal, false)).id
  const chain = [
    { key: `project:${place.project.id}`, name: place.project.title },
    ...place.folders.map(folder => ({ key: `folder:${folder.id}`, name: folder.title })),
  ]
  for (const { key, name } of chain) {
    parent = (await ensure(made.get(key), name, key, parent, token, signal, true)).id
  }
  return parent
}

/**
 * A Doc inksprite made put where its document is: in its folder, under its
 * title, moved and renamed if it is not.
 *
 * @param {string} docId
 * @param {Place} place
 * @param {string} token
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<void>}
 */
export async function placeDoc(docId, place, token, { signal } = {}) {
  const folder = await folderFor(place, token, { signal })
  /** @type {{name?: string, parents?: string[]}} */
  const doc = await (
    await ask(`${FILES}/${encodeURIComponent(docId)}?fields=name,parents`, token, { signal })
  ).json()
  await move(docId, doc, place.title, folder, token, signal)
}

/**
 * Every folder inksprite made in the writer's Drive, the trash's aside.
 *
 * @param {string} token
 * @param {AbortSignal} [signal]
 * @returns {Promise<DriveFolder[]>}
 */
async function listFolders(token, signal) {
  const q = [
    `mimeType = '${FOLDER_TYPE}'`,
    'trashed = false',
    `appProperties has { key='${MARK.key}' and value='${MARK.value}' }`,
  ].join(' and ')
  /** @type {DriveFolder[]} */
  const out = []
  let pageToken = ''
  do {
    const url =
      `${FILES}?q=${encodeURIComponent(q)}&pageSize=1000` +
      `&fields=${encodeURIComponent('nextPageToken,files(id,name,parents,appProperties)')}` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '')
    /** @type {{files?: DriveFolder[], nextPageToken?: string}} */
    const page = await (await ask(url, token, { signal })).json()
    out.push(...(page.files ?? []))
    pageToken = page.nextPageToken ?? ''
  } while (pageToken)
  return out
}

/**
 * A folder of inksprite's: the one found, renamed or moved as wanted, or
 * one made.
 *
 * @param {DriveFolder|undefined} found
 * @param {string} name
 * @param {string} key
 * @param {string|undefined} parent - Where it goes; the top of My Drive when none
 * @param {string} token
 * @param {AbortSignal|undefined} signal
 * @param {boolean} kept - Whether it is kept as wanted, or left as found
 * @returns {Promise<{id: string}>}
 */
async function ensure(found, name, key, parent, token, signal, kept) {
  if (found) {
    if (kept && parent) await move(found.id, found, name, parent, token, signal)
    return found
  }
  const body = {
    name,
    mimeType: FOLDER_TYPE,
    appProperties: { [MARK.key]: MARK.value, [KEY]: key },
    ...(parent && { parents: [parent] }),
  }
  return (await ask(`${FILES}?fields=id`, token, { signal, body })).json()
}

/**
 * A file renamed and moved into a folder, where it is not already so.
 *
 * @param {string} id
 * @param {{name?: string, parents?: string[]}} now
 * @param {string} name
 * @param {string} parent
 * @param {string} token
 * @param {AbortSignal|undefined} signal
 */
async function move(id, now, name, parent, token, signal) {
  const parents = now.parents ?? []
  const elsewhere = parents.filter(each => each !== parent)
  const add = parents.includes(parent) ? '' : `&addParents=${encodeURIComponent(parent)}`
  const remove = elsewhere.length ? `&removeParents=${encodeURIComponent(elsewhere.join(','))}` : ''
  if (now.name === name && !add && !remove) return
  await ask(`${FILES}/${encodeURIComponent(id)}?fields=id${add}${remove}`, token, {
    signal,
    method: 'PATCH',
    body: { name },
  })
}
