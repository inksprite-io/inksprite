/* global File, Blob */
/**
 * @module scrivener/project
 * @description A Scrivener project opened, then written into a project's tree.
 *
 * Opening reads the binder and the styles and checks that there is a project
 * to import, so that a zip with none in it, or a project too old to read,
 * writes nothing. Writing then goes through the binder in order:
 *
 * - A folder, or any item with items under it, is an ordered folder, since
 *   the binder's order is the writer's. When it has text of its own, that
 *   comes first inside it, as a document of the same name.
 * - A text is a text document, empty or not: an empty scene in the binder is
 *   a plan.
 * - A file, such as a PDF or a picture in Research, is a file document, read
 *   as any import reads it. One that cannot be read comes in with no text
 *   rather than being left out.
 * - An item's synopsis and notes are documents of their own, `<title>
 *   synopsis` and `<title> notes`, right after its text: beside a document,
 *   or inside a folder before the items under it.
 *
 * Labels, statuses, keywords, snapshots, compile settings and the rest of
 * what Scrivener keeps about its items have nowhere to go, and are left.
 */

import { readBinder, readStyles, FOLDER_TYPES } from './binder.js'
import { readRtf } from './rtf.js'
import { markdownOfBlocks, markdownOfText } from './markdown.js'
import { useDocuments } from '@/composables/useDocuments'
import { useDocumentsStore } from '@/stores/documentsStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { writeMarkdown } from '@/cards/write.js'
import { inspectFile, mimeOf } from '@/files/inspect.js'
import { writeFile } from '@/files/write.js'

/** @typedef {import('./binder.js').BinderItem} BinderItem */
/** @typedef {import('./package.js').ScrivenerPackage} ScrivenerPackage */
/** @typedef {import('@/composables/useBulkImport.js').Imported} Imported */

/**
 * A project, opened and ready to write.
 *
 * @typedef {Object} ScrivenerProject
 * @property {string} name
 * @property {BinderItem[]} binder - Without the Trash
 * @property {Map<string, string>} styles - Style names by id
 * @property {Map<string, Blob>} files - By path inside the project
 */

/** An item's own files, beside its file proper, that are not the file. */
const OWN_FILES = /^(content|notes)\.(rtf|styles|comments)$|^synopsis\.txt$/

/**
 * A project's RTF, one character per byte: what is not plain ASCII in it is
 * escaped, and read in the code page it names.
 *
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
const sourceOf = async blob => new TextDecoder('windows-1252').decode(await blob.arrayBuffer())

/**
 * Open a project: find its binder, refuse one in Scrivener 2's format, and read
 * the binder and the styles.
 *
 * @param {ScrivenerPackage} pack
 * @returns {Promise<ScrivenerProject>}
 * @throws {Error} When there is no project, or none this can read
 */
export async function openProject(pack) {
  const paths = [...pack.files.keys()]
  const binder = paths.find(path => !path.includes('/') && /\.scrivx$/i.test(path))
  if (!binder) throw new Error('There is no Scrivener project in it.')
  if (
    !paths.some(path => path.startsWith('Files/Data/')) &&
    paths.some(path => path.startsWith('Files/Docs/'))
  ) {
    throw new Error(
      'This project is from an older Scrivener. Open it in Scrivener 3, then import it again.'
    )
  }

  const scrivx = /** @type {Blob} */ (pack.files.get(binder))
  const stylesFile = pack.files.get('Files/styles.xml')
  /** @type {Map<string, string>} */
  let styles = new Map()
  if (stylesFile) {
    try {
      styles = readStyles(await stylesFile.text())
    } catch {
      // Without the names, styled paragraphs come in as ordinary ones.
    }
  }
  return { name: pack.name, binder: readBinder(await scrivx.text()), styles, files: pack.files }
}

/**
 * Write a project into a project's tree.
 *
 * @param {string} storyId
 * @param {ScrivenerProject} project
 * @param {Object} [options]
 * @param {string} [options.parentId] - Where it goes; the project's top otherwise
 * @param {boolean} [options.asFolder] - In a folder named after the project,
 *   rather than straight into where it goes, which is then kept in order as a
 *   folder made for it would be
 * @returns {Promise<Imported>}
 */
export async function writeProject(storyId, project, { parentId, asFolder = false } = {}) {
  const api = useDocuments(storyId)
  await api.init()
  const store = useDocumentsStore()
  /** @type {Imported} */
  const result = { documents: 0, folders: 0, cards: 0, scans: 0, skipped: [] }
  const { files, styles } = project

  /** @type {Map<string, string[]>} Each item's own files, by name */
  const owned = new Map()
  for (const path of files.keys()) {
    const [, id, name] = /^Files\/Data\/([^/]+)\/([^/]+)$/.exec(path) || []
    if (!id) continue
    owned.set(id, [...(owned.get(id) ?? []), name])
  }

  /**
   * @param {string} id
   * @param {string} name
   */
  const fileOf = (id, name) => files.get(`Files/Data/${id}/${name}`)

  /**
   * An item's text, or its notes, as markdown, when it has any.
   *
   * @param {string} id
   * @param {'content'|'notes'} which
   * @returns {Promise<string|null>}
   */
  const markdownOf = async (id, which) => {
    const rtf = fileOf(id, `${which}.rtf`)
    if (!rtf) return null
    const used = fileOf(id, `${which}.styles`)
    const names = used
      ? (await used.text()).split(',').map(styleId => styles.get(styleId.trim()) ?? '')
      : []
    return markdownOfBlocks(readRtf(await sourceOf(rtf), names))
  }

  /**
   * @param {string} parent
   * @param {string} title
   */
  const folder = (parent, title) => {
    result.folders++
    return store.createDocument({
      storyId,
      parentId: parent,
      type: 'folder',
      ordered: true,
      title: api.uniqueTitle(parent, title),
    })
  }

  /**
   * @param {string} parent
   * @param {string} title
   * @param {string} markdown
   */
  const text = async (parent, title, markdown) => {
    await writeMarkdown(storyId, title, markdown, { parentId: parent })
    result.documents++
  }

  /**
   * An item's file, when it is a file rather than a text: the one in its
   * folder its metadata names, or the one that is not its text or notes.
   *
   * @param {BinderItem} item
   * @returns {{name: string, blob: Blob}|null}
   */
  const attachmentOf = item => {
    if (item.type === 'Text' || FOLDER_TYPES.has(item.type)) return null
    const names = owned.get(item.id) ?? []
    const name =
      (item.extension && names.find(found => found === `content.${item.extension}`)) ||
      names.find(found => found.startsWith('content.') && !OWN_FILES.test(found))
    const blob = name && fileOf(item.id, name)
    return name && blob ? { name, blob } : null
  }

  /**
   * @param {string} parent
   * @param {string} title
   * @param {{name: string, blob: Blob}} attachment
   */
  const attach = async (parent, title, { name, blob }) => {
    const file = new File([blob], name)
    let found
    try {
      found = await inspectFile(file)
    } catch {
      const mime = mimeOf(name, '')
      found = { title, mime, size: blob.size, text: '', blob: new Blob([blob], { type: mime }) }
    }
    const written = await writeFile(storyId, { ...found, title }, { parentId: parent })
    result.documents += written.documents
    if (found.mime === 'application/pdf' && !found.text) result.scans++
  }

  /**
   * An item's synopsis and notes, after its text.
   *
   * @param {BinderItem} item
   * @param {string} title
   * @param {string} parent
   */
  const asides = async (item, title, parent) => {
    // TODO: a synopsis is what a document's summary is for. Once summaries
    // are shown to the writer, write it there and leave this document out.
    const synopsis = fileOf(item.id, 'synopsis.txt')
    const summary = synopsis ? markdownOfText(await synopsis.text()) : ''
    if (summary) await text(parent, `${title} synopsis`, summary)
    const notes = await markdownOf(item.id, 'notes')
    if (notes) await text(parent, `${title} notes`, notes)
  }

  /**
   * @param {BinderItem} item
   * @param {string} parent
   */
  const write = async (item, parent) => {
    const title = item.title.trim() || 'Untitled'
    const attachment = attachmentOf(item)
    if (item.children.length > 0 || FOLDER_TYPES.has(item.type)) {
      const made = folder(parent, title)
      if (attachment) await attach(made.id, title, attachment)
      else {
        const own = await markdownOf(item.id, 'content')
        if (own) await text(made.id, title, own)
      }
      await asides(item, title, made.id)
      for (const child of item.children) await write(child, made.id)
      return
    }
    if (attachment) await attach(parent, title, attachment)
    else await text(parent, title, (await markdownOf(item.id, 'content')) ?? '')
    await asides(item, title, parent)
  }

  const top = parentId || rootIdFor(storyId)
  const into = asFolder ? folder(top, project.name).id : top
  if (!asFolder) api.setOrdered(into, true)
  for (const item of project.binder) await write(item, into)
  return result
}
