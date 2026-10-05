/**
 * @module stores/migrations/projectTree
 * @description Give every story a root node and a default folder structure.
 *
 * Acts sat at the top level of a story, which left nowhere to record that they
 * are a sequence — `ordered` lives on a folder, and the story record is not a
 * folder. A real root node fixes that and gives lore and notes somewhere to
 * live later.
 *
 * Pure, like the parts/scenes transform, so it can be tested without IndexedDB
 * and shared between the Dexie upgrade hook and backup restore.
 */

/** @typedef {import('../../types/models.js').Document} Document */

/** @param {string} storyId */
export const rootIdFor = storyId => `root_${storyId}`
/** @param {string} storyId */
export const manuscriptIdFor = storyId => `manuscript_${storyId}`
/** @param {string} storyId */
export const notesIdFor = storyId => `notes_${storyId}`
/** @param {string} storyId */
export const draftsIdFor = storyId => `drafts_${storyId}`

/**
 * Build one of the fixed structural folders.
 *
 * @param {object} opts
 * @param {string} opts.id
 * @param {string} opts.storyId
 * @param {string} opts.parentId
 * @param {string} opts.title
 * @param {number} opts.order
 * @param {boolean} opts.ordered
 * @param {number} opts.now
 * @returns {Document}
 */
function folder({ id, storyId, parentId, title, order, ordered, now }) {
  return {
    id,
    storyId,
    parentId,
    order,
    type: 'folder',
    ordered,
    title,
    content: '',
    summary: '',
    wordCount: 0,
    version: 1,
    created: now,
    updated: now,
  }
}

/**
 * The one document a project cannot do without.
 *
 * It carries the project's name as its title and the story's overview as its
 * summary, `"/"` resolves to it, and every path is relative to it. A fixed id
 * rather than a generated one, so anything holding a story id can find the
 * root without searching.
 *
 * @param {string} storyId
 * @param {string} [storyTitle] - Copied once; the root node's title is its own from then on
 * @param {number} [now]
 * @returns {Document}
 */
export function rootNode(storyId, storyTitle, now = Date.now()) {
  return folder({
    id: rootIdFor(storyId),
    storyId,
    parentId: storyId,
    title: storyTitle || 'Untitled',
    order: 0,
    ordered: false,
    now,
  })
}

/**
 * The folders the restructure lays down.
 *
 * A migration shape, not a new project's shape: acts move under `manuscript`,
 * so that folder has to exist for a story being restructured, and a story
 * carrying lore needs `notes` for it to land in. A *new* project starts with
 * nothing under its root.
 *
 * @param {string} storyId
 * @param {string} storyTitle - Copied once; the root node's title is its own from then on
 * @param {number} [now]
 * @returns {Document[]} root, manuscript, notes
 */
export function defaultProjectFolders(storyId, storyTitle, now = Date.now()) {
  const root = rootNode(storyId, storyTitle, now)
  return [
    root,
    folder({
      id: manuscriptIdFor(storyId),
      storyId,
      parentId: root.id,
      title: 'manuscript',
      order: 0,
      // A manuscript is a sequence; that is what makes it a manuscript.
      ordered: true,
      now,
    }),
    folder({
      id: notesIdFor(storyId),
      storyId,
      parentId: root.id,
      title: 'notes',
      order: 2,
      ordered: false,
      now,
    }),
  ]
}

/**
 * The title the old outline would have displayed for an untitled act.
 * @param {Document} act
 * @returns {string}
 */
const actTitle = act => act.title?.trim() || `Act ${act.order + 1}`

/**
 * Sort helper matching the store's stable ordering.
 * @param {Document} a
 * @param {Document} b
 */
const byOrder = (a, b) => a.order - b.order || (a.id > b.id ? 1 : a.id < b.id ? -1 : 0)

/**
 * Restructure a flat story into a project tree.
 *
 * Acts move under `manuscript`, drafts becomes an ordinary top-level folder,
 * and anything untitled has the name the old outline computed for it written
 * down. Nothing is invented that a user was not already looking at.
 *
 * Idempotent: a story that already has a root node is returned untouched, so a
 * retried upgrade or a re-imported backup cannot double-nest.
 *
 * @param {Document[]} documents - Every document, across all stories
 * @param {Array<{id: string, title?: string}>} stories
 * @param {number} [now]
 * @returns {{documents: Document[], restructured: string[]}} Full document set, and the stories touched
 */
export function documentsToProjectTree(documents, stories, now = Date.now()) {
  /** @type {Map<string, Document[]>} */
  const byStory = new Map()
  for (const document of documents || []) {
    if (!byStory.has(document.storyId)) byStory.set(document.storyId, [])
    byStory.get(document.storyId).push(document)
  }

  /** @type {Document[]} */
  const out = []
  /** @type {string[]} */
  const restructured = []

  const storyList = stories || []
  const titles = new Map(storyList.map(story => [story.id, story.title]))
  // A story with documents but no record still deserves a tree.
  const storyIds = new Set([...titles.keys(), ...byStory.keys()])

  for (const storyId of storyIds) {
    const own = byStory.get(storyId) || []

    if (own.some(document => document.id === rootIdFor(storyId))) {
      out.push(...own)
      continue
    }

    const [root, manuscript, notes] = defaultProjectFolders(storyId, titles.get(storyId), now)
    out.push(root, manuscript, notes)
    restructured.push(storyId)

    const draftsId = draftsIdFor(storyId)
    const acts = own
      .filter(d => d.parentId === storyId && d.type === 'folder' && d.id !== draftsId)
      .sort(byOrder)

    // "Chapter N" counted across the whole story, which is what the outline
    // showed. Renumbering per act would silently rename chapters someone has
    // been reading for months.
    let chapterNumber = 1
    for (const [index, act] of acts.entries()) {
      out.push({
        ...act,
        parentId: manuscript.id,
        order: index,
        ordered: true,
        title: actTitle(act),
        updated: now,
      })

      const scenes = own.filter(d => d.parentId === act.id && d.type === 'text').sort(byOrder)
      for (const [sceneIndex, scene] of scenes.entries()) {
        out.push({
          ...scene,
          order: sceneIndex,
          title: scene.title?.trim() || `Chapter ${chapterNumber + sceneIndex}`,
          updated: now,
        })
      }
      chapterNumber += scenes.length
    }

    const drafts = own.find(d => d.id === draftsId)
    if (drafts) {
      out.push({
        ...drafts,
        parentId: root.id,
        // Drafts used MAX_SAFE_INTEGER to pin itself last among acts. It sits
        // beside manuscript now, and root sorts by title anyway.
        order: 1,
        ordered: false,
        title: 'drafts',
        updated: now,
      })

      const draftScenes = own
        .filter(d => d.parentId === draftsId && d.type === 'text')
        .sort(byOrder)
      for (const [index, scene] of draftScenes.entries()) {
        out.push({
          ...scene,
          order: index,
          title: scene.title?.trim() || 'Untitled Draft',
          updated: now,
        })
      }
    }

    // Anything already nested deeper, or orphaned, rides along unchanged.
    const handled = new Set(out.map(d => d.id))
    out.push(...own.filter(d => !handled.has(d.id)))
  }

  return { documents: out, restructured }
}
