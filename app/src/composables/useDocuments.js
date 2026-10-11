/**
 * @module composables/useDocuments
 * @description The document tree for one story, shaped for the tree UI.
 *
 * Thin over `documentsStore`: it scopes everything to a story, owns the
 * display-title rule, and keeps the folder-vs-text distinction in one place so
 * components don't each reimplement it.
 *
 * One instance per storyId, so several mount points (sidebar, mobile) share
 * state instead of racing to initialise.
 *
 * It also owns the editor's tabs: which documents are open and which is
 * showing. They are recorded on the story so the project reopens as it was
 * left, and read back checked against the tree, so a document deleted since
 * is not among them. `open` and `closeTab` write them; `remove` drops the
 * tabs of what it deletes, and `keep` makes a preview tab stay. See
 * `utils/tabs.js` for the rules.
 *
 * It also owns the one rule about where a document's content lives: while a
 * document is open in the editor, the editor's state is the truth and a write
 * is a transaction dispatched to it; otherwise the store is. `setContent` and
 * `appendContent` decide, so that no writer has to know.
 *
 * Content written here is stored in the file format's own form, the one the
 * editor serializes. Text from outside — a model's, a file's — may say the
 * same thing with another bullet or escape, and if the store kept that form
 * the document would read differently the moment it was opened: a passage an
 * edit was recorded against would no longer be found, and rewinding would
 * skip it as if the writer had changed it. A plain document is the
 * exception: it is never opened as a document, so it is stored as typed.
 */

import { computed, ref } from 'vue'
import { inRepository, repositoryOf } from '@/source/tree.js'
import { useStoriesStore } from '@/stores/storiesStore'
import { useDocumentsStore } from '@/stores/documentsStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { useEditor } from '@/composables/useEditor.js'
import { appendBlocks, settleMarkdown } from '@/editor/markdown.js'
import { documentPath, documentTitles, freeTitle, namesake } from '@/utils/documentPath.js'
import { applyEdit, reverseEdit } from '@/utils/edits.js'
import {
  closeTab as closed,
  dropTabs,
  keepTab,
  normalizeTabs,
  openTab,
  tabsOf,
  tabsPatch,
} from '@/utils/tabs.js'

/** @typedef {import('@/types/models.js').Document} Document */
/** @typedef {import('@/utils/tabs.js').Tabs} Tabs */

// Singleton instances keyed by storyId
const instances = new Map()

/** Clear all singleton instances (for testing) */
export const clearDocumentInstances = () => {
  instances.clear()
}

/**
 * @param {string} storyId
 */
export const useDocuments = storyId => {
  if (instances.has(storyId)) return instances.get(storyId)

  const storiesStore = useStoriesStore()
  const documentsStore = useDocumentsStore()
  const editor = useEditor()

  const ready = ref(false)

  /**
   * A freshly created document, waiting for its node to mount and open an
   * inline rename. A new node has no name, and an "Untitled" the user has to
   * hunt for is worse than a focused input.
   * @type {import('vue').Ref<string|null>}
   */
  const pendingRenameId = ref(null)
  /** @type {import('vue').Ref<Error|null>} */
  const error = ref(null)
  /** @type {Promise<void>|null} */
  let initPromise = null

  /**
   * Load the story's tree and make sure it has a root to hang from.
   * @returns {Promise<void>}
   */
  async function init() {
    if (initPromise) return initPromise
    initPromise = (async () => {
      try {
        await documentsStore.loadStory(storyId)
        documentsStore.ensureRoot(storyId, storiesStore.getStory(storyId)?.title)
        ready.value = true
      } catch (e) {
        error.value = e
        throw e
      }
    })()
    return initPromise
  }

  /** The story's root node — the project itself. */
  const root = computed(() => documentsStore.getDocument(rootIdFor(storyId)))

  /**
   * The editor's tabs, as the story remembers them and the tree allows: only
   * a document still in the tree with something to show — text, or a file —
   * can be open, so anything else has been dropped by the time they are
   * read. Before the tree is loaded they are taken as stored.
   * @type {import('vue').ComputedRef<Tabs>}
   */
  const tabs = computed(() => {
    const stored = tabsOf(storiesStore.getStory(storyId))
    if (!ready.value) return stored
    return normalizeTabs(stored, id => {
      const type = documentsStore.getDocument(id)?.type
      return type === 'text' || type === 'file'
    })
  })

  /**
   * The document the writer is in: the tab showing, or '' with none.
   * @type {import('vue').ComputedRef<string>}
   */
  const activeDocumentId = computed(() => tabs.value.active ?? '')

  /**
   * Record the tabs on the story, so the project reopens as it was left.
   * @param {Tabs} next
   */
  const writeTabs = next => {
    storiesStore.updateStory(storyId, tabsPatch(next))
  }

  /**
   * Open a document: make it the one the writer is in, in a tab of its own
   * if it was not open already. A preview takes the preview tab's place, and
   * the document that was there is written out and let go of, as a close
   * would.
   * @param {string} documentId
   * @param {{ preview?: boolean }} [options]
   */
  const open = (documentId, options) => {
    const before = tabs.value
    const after = openTab(before, documentId, options)
    for (const id of before.open) if (!after.open.includes(id)) editor.close(id)
    writeTabs(after)
  }

  /**
   * Keep a preview tab, so the next preview opens beside it rather than in
   * its place. For when the writer types in it or double-clicks it.
   * @param {string} documentId
   */
  const keep = documentId => {
    const after = keepTab(tabs.value, documentId)
    if (after !== tabs.value) writeTabs(after)
  }

  /**
   * Put the caret in the editor, when the document is the one showing. For
   * after something else has had the focus — a rename, a dialog — and the
   * writer's next keystroke belongs in the document.
   * @param {string} documentId
   */
  const focus = documentId => {
    if (tabs.value.active === documentId) editor.focus(documentId)
  }

  /**
   * Close a tab. The document is written out and let go of, and the
   * neighbour comes forward. Closing the last leaves nothing open, which the
   * story remembers too.
   * @param {string} documentId
   */
  const closeTab = documentId => {
    editor.close(documentId)
    writeTabs(closed(tabs.value, documentId))
  }

  /**
   * Write out and let go of every open tab's editor state, keeping the tabs.
   * For leaving the project: what is open stays recorded on the story, and
   * comes back from the store rather than from memory.
   */
  const releaseTabs = () => {
    for (const id of tabs.value.open) editor.close(id)
  }

  /**
   * @param {string} documentId
   * @returns {Document|null}
   */
  const get = documentId => documentsStore.getDocument(documentId)

  /**
   * Children of a folder, in display order.
   * @param {string} parentId
   * @returns {Document[]}
   */
  const childrenOf = parentId => documentsStore.getChildrenOrdered(parentId)

  /**
   * @param {Document|null} document
   * @returns {boolean}
   */
  const isFolder = document => document?.type === 'folder'

  /**
   * Whether a folder sequences its children, which decides both the sort and
   * whether dragging to a position within it means anything.
   * @param {string} documentId
   * @returns {boolean}
   */
  const isOrdered = documentId => !!documentsStore.getDocument(documentId)?.ordered

  /**
   * Whether a document is kept from the model. Its own flag only: a document
   * under a hidden folder is hidden with it, but that is the folder's flag,
   * and the folder is where it is switched off again.
   * @param {string} documentId
   * @returns {boolean}
   */
  const isHidden = documentId => !!documentsStore.getDocument(documentId)?.hidden

  /**
   * What the tree shows for a document. Titles are stored, never computed —
   * position in an ordered folder is the tree's own business, so the only
   * thing display adds is a stand-in for a document nobody has named yet.
   *
   * @param {Document|null} document
   * @returns {string}
   */
  const displayTitle = document => (document ? document.title?.trim() || 'Untitled' : '')

  /**
   * Where a document is, spelled the way the model addresses it: the titles
   * from the root down joined with "/", and "/" for the root itself. The
   * one address a document has, so a path the writer copies is a path a
   * tool takes. See `utils/documentPath.js`.
   * @param {string} documentId
   * @returns {string} The path, or '' for a document not in the tree
   */
  const pathOf = documentId =>
    documentPath(documentsStore.getDocument, documentsStore.getDocument(documentId))

  /**
   * The titles `pathOf` joins, for a caller that needs them one by one.
   * @param {string} documentId
   * @returns {string[]}
   */
  const titlesOf = documentId =>
    documentTitles(documentsStore.getDocument, documentsStore.getDocument(documentId))

  /**
   * The first text document in the tree.
   *
   * Only a fallback: a project normally reopens on the document its writer
   * last had open. This is what a project with no history gets, and root
   * children sort by title, so the default structure lands in `manuscript`
   * without the code having to know that folder exists.
   *
   * @returns {Document|null}
   */
  const firstTextDocument = () => {
    /** @param {string} parentId */
    const walk = parentId => {
      for (const child of childrenOf(parentId)) {
        if (child.type === 'text') return child
        const found = walk(child.id)
        if (found) return found
      }
      return null
    }

    const rootId = root.value?.id
    return rootId ? walk(rootId) : null
  }

  /**
   * A folder, under a name nothing else in `parentId` has: `title`, or
   * `Title (2)` when that is taken. See `uniqueTitle`.
   * @param {string} parentId
   * @param {string} title
   * @returns {Document}
   */
  const createFolder = (parentId, title) =>
    documentsStore.createDocument({
      storyId,
      parentId,
      type: 'folder',
      title: uniqueTitle(parentId, title),
    })

  /**
   * A text document, under a name nothing else in `parentId` has. See
   * `uniqueTitle`.
   * @param {string} parentId
   * @param {string} title
   * @param {string} [content] - Markdown, for callers creating a document with a body
   * @returns {Document}
   */
  const createTextDocument = (parentId, title, content = '') =>
    documentsStore.createDocument({
      storyId,
      parentId,
      type: 'text',
      title: uniqueTitle(parentId, title),
      content: settleMarkdown(content),
    })

  /**
   * A title nothing else in this folder already has: `title`, or the first
   * free one of `Title (2)`, `Title (3)`…
   *
   * Two rows with one name is a tree the writer cannot read and a path the
   * model cannot use, so whatever puts a document in a folder without the
   * writer naming it there — making one, importing one, moving one — takes
   * the next free name. Importing the same thing twice is a thing people do,
   * a newer version of it or the same one by accident, and `Elara (2)` says
   * which came later without pretending to know what changed. A name the
   * writer types is theirs, and is refused rather than changed: `rename`.
   *
   * @param {string} parentId
   * @param {string} title
   * @param {string} [exceptId] - A document moving in, which is not in its own way
   * @returns {string}
   */
  const uniqueTitle = (parentId, title, exceptId) =>
    freeTitle(childrenOf(parentId), title, exceptId)

  /**
   * The document in `parentId` that already goes by `title`, other than
   * `exceptId`. Names are compared as the model's paths are: see
   * `utils/documentPath.js`.
   * @param {string} parentId
   * @param {string} title
   * @param {string} [exceptId] - The document being named
   * @returns {Document|null}
   */
  const namesakeOf = (parentId, title, exceptId) => namesake(childrenOf(parentId), title, exceptId)

  /**
   * Give a document a name, unless something beside it already has that name.
   * The root's name is the project's, and one another project has is numbered
   * instead: see `freeName`.
   * @param {string} documentId
   * @param {string} title
   * @returns {boolean} Whether it was renamed
   */
  const rename = (documentId, title) => {
    const document = documentsStore.getDocument(documentId)
    if (!document) return false
    if (documentId === rootIdFor(storyId)) {
      documentsStore.updateDocument(documentId, {
        title: storiesStore.freeName(title, storyId),
      })
      return true
    }
    if (document.parentId && namesakeOf(document.parentId, title, documentId)) return false
    documentsStore.updateDocument(documentId, { title })
    return true
  }

  /**
   * Whether a document is edited as plain text and stored as typed.
   * @param {string|null|undefined} documentId
   * @returns {boolean}
   */
  const isPlain = documentId => !!documentsStore.getDocument(documentId)?.plain

  /**
   * A body as the store should hold it: as written for a plain document,
   * settled for a structured one, so that it reads the same when opened.
   * @param {string} documentId
   * @param {string} content
   * @returns {string}
   */
  const stored = (documentId, content) => (isPlain(documentId) ? content : settleMarkdown(content))

  /**
   * Replace a document's body. Word count follows from it.
   * @param {string} documentId
   * @param {string} content - Markdown
   */
  const setContent = (documentId, content) => {
    if (editor.holds(documentId)) editor.replaceContent(documentId, content)
    else documentsStore.updateDocument(documentId, { content: stored(documentId, content) })
  }

  /**
   * A document's body as it stands: the editor's, when the editor holds the
   * document, since the store hears about typing only after a pause.
   * @param {string} documentId
   * @returns {string}
   */
  const currentContent = documentId =>
    editor.holds(documentId)
      ? editor.markdown(documentId)
      : documentsStore.getDocument(documentId)?.content || ''

  /**
   * Replace one passage of a document's body. Applied only when `old` is
   * found exactly once; otherwise nothing changes and the count says why.
   * @param {string} documentId
   * @param {string} old - The passage, exactly as the body has it
   * @param {string} replacement
   * @returns {{applied: boolean, count: number}}
   */
  const replaceText = (documentId, old, replacement) => {
    const content = currentContent(documentId)
    const count = old ? content.split(old).length - 1 : 0
    if (count !== 1) return { applied: false, count }
    // The function form, so a `$` in the replacement is a dollar sign.
    setContent(
      documentId,
      content.replace(old, () => replacement)
    )
    return { applied: true, count }
  }

  /**
   * Add to the end of a document's body, as blocks of its own.
   * @param {string} documentId
   * @param {string} markdown
   */
  const appendContent = (documentId, markdown) => {
    if (editor.holds(documentId)) editor.appendContent(documentId, markdown)
    else {
      const content = appendBlocks(documentsStore.getDocument(documentId)?.content, markdown)
      documentsStore.updateDocument(documentId, { content: stored(documentId, content) })
    }
  }

  /**
   * Whether making a document structured would change its text: something in
   * it is not what the editor would write. Worth asking about first.
   * @param {string} documentId
   * @returns {boolean}
   */
  const wouldSettle = documentId => {
    const content = currentContent(documentId)
    return settleMarkdown(content) !== content
  }

  /**
   * Make a document plain — edited as text, stored as typed — or structured
   * again. A plain document made structured is settled: anything the editor
   * cannot show becomes the nearest thing it can, and the original is not
   * kept. One that is open is turned in place, keeping what was typed.
   * @param {string} documentId
   * @param {boolean} plain
   */
  const setPlain = (documentId, plain) => {
    const document = documentsStore.getDocument(documentId)
    if (!document || document.type !== 'text' || !!document.plain === plain) return
    if (editor.holds(documentId)) {
      documentsStore.updateDocument(documentId, { plain })
      editor.convert(documentId, plain)
    } else {
      const content = plain ? document.content : settleMarkdown(document.content)
      documentsStore.updateDocument(documentId, { plain, content })
    }
  }

  /**
   * Undo a change a tool made, if the document still says what the tool
   * left. A created document is removed if its body is still what was
   * created. Otherwise the writer has been there since, and their version
   * stands.
   *
   * @param {import('@/types/models.js').DocumentEdit} edit
   * @returns {boolean} Whether it was undone
   */
  const revertEdit = edit => {
    const document = documentsStore.getDocument(edit.documentId)
    if (!document) return false
    const content = currentContent(edit.documentId)
    if (edit.tool === 'create_document') {
      if (content !== edit.new) return false
      remove(edit.documentId)
      return true
    }
    const reverted = reverseEdit(content, edit)
    if (reverted === null) return false
    setContent(edit.documentId, reverted)
    return true
  }

  /**
   * Make a change a tool made once more, where the document still reads as
   * it did before the change. A created document that was undone is made
   * again from the record of it — the same id, the body and summary it was
   * given, at the path it had, or at the top of the project when that
   * folder is gone; one still there is left as the writer has it. The other
   * half of `revertEdit`, for an answer switched back to.
   *
   * @param {import('@/types/models.js').DocumentEdit} edit
   * @returns {Promise<boolean>} Whether it was made
   */
  const reapplyEdit = async edit => {
    if (edit.tool === 'create_document') {
      if (documentsStore.getDocument(edit.documentId)) {
        return currentContent(edit.documentId) === edit.new
      }
      const segments = (edit.path || '').split('/').filter(Boolean)
      const title = segments.pop() || 'Untitled'
      let parentId = rootIdFor(storyId)
      for (const name of segments) {
        const folder = childrenOf(parentId).find(
          child => child.type === 'folder' && child.title === name
        )
        if (!folder) break
        parentId = folder.id
      }
      documentsStore.createDocument({
        id: edit.documentId,
        storyId,
        parentId,
        type: 'text',
        title: uniqueTitle(parentId, title),
        content: settleMarkdown(edit.new),
        ...(edit.summary ? { summary: edit.summary } : {}),
      })
      return true
    }
    if (!documentsStore.getDocument(edit.documentId)) return false
    const applied = applyEdit(currentContent(edit.documentId), edit)
    if (applied === null) return false
    setContent(edit.documentId, applied)
    return true
  }

  /**
   * The name currently in the rename input for a document.
   * @param {string} documentId
   * @returns {string}
   */
  const editableTitle = documentId => documentsStore.getDocument(documentId)?.title || ''

  /**
   * A copy of a text document, beside it and named as the next of it:
   * `Title (2)`, and a copy of `Title (2)` is `Title (3)` rather than
   * `Title (2) (2)`. It has the text as it stands, edits not yet written out
   * included, and what the document is apart from its place — plain or laid
   * out, its summary, hidden or not. In a folder kept in order it goes
   * straight after the original; anywhere else the name places it.
   * @param {string} documentId
   * @returns {Document|null} The copy, or null for anything but a text document
   */
  const duplicate = documentId => {
    const document = get(documentId)
    if (document?.type !== 'text' || !document.parentId) return null
    const { parentId } = document
    const name = displayTitle(document)
    const base = name.replace(/\s*\(\d+\)$/, '') || name
    let at = 2
    while (namesakeOf(parentId, `${base} (${at})`)) at++
    const copy = documentsStore.createDocument({
      storyId,
      parentId,
      type: 'text',
      title: `${base} (${at})`,
      content: currentContent(documentId),
      ...(document.plain ? { plain: true } : {}),
      ...(document.summary ? { summary: document.summary } : {}),
      ...(document.hidden ? { hidden: true } : {}),
    })
    if (isOrdered(parentId)) {
      const ids = childrenOf(parentId)
        .map(child => child.id)
        .filter(id => id !== copy.id)
      ids.splice(ids.indexOf(documentId) + 1, 0, copy.id)
      documentsStore.reorderChildren(parentId, ids)
    }
    return copy
  }

  /**
   * Delete a document and everything under it. A deleted document's editor
   * state has nowhere to go and its tab nothing to show, so both go with it.
   * @param {string} documentId
   * @returns {number} How many documents were removed
   */
  const remove = documentId => {
    const before = tabs.value
    /** @type {string[]} */
    const removed = []
    const walk = (/** @type {string} */ id) => {
      for (const child of documentsStore.getChildren(id)) walk(child.id)
      documentsStore.deleteDocument(id)
      removed.push(id)
    }
    walk(documentId)

    for (const id of removed) editor.discard(id)
    const after = dropTabs(before, removed)
    if (after !== before) writeTabs(after)

    return removed.length
  }

  /**
   * Commit a drag: reparents anything that moved and renumbers the folder.
   * Something moved in beside a document of its name comes in as `Name (2)`.
   * A move `canDropInto` refuses changes nothing, whatever let it through.
   * @param {string} parentId
   * @param {string[]} documentIds - Children in their new order
   * @returns {Document[]} The folder's children, as they now stand
   */
  const reorder = (parentId, documentIds) => {
    const arriving = documentIds.filter(id => documentsStore.getDocument(id)?.parentId !== parentId)
    if (arriving.some(id => !canDropInto(parentId, id))) return childrenOf(parentId)
    for (const id of documentIds) {
      const document = documentsStore.getDocument(id)
      if (!document || document.parentId === parentId) continue
      const title = uniqueTitle(parentId, document.title, id)
      documentsStore.updateDocument(
        id,
        title === document.title ? { parentId } : { parentId, title }
      )
    }
    return documentsStore.reorderChildren(parentId, documentIds)
  }

  /**
   * Move a document into a folder: at its end, where the folder is kept in
   * order. One already there stays where it is. Takes a name of its own
   * there, and refuses what `canDropInto` refuses, as a drag does.
   * @param {string} folderId
   * @param {string} documentId
   * @returns {Document[]} The folder's children, as they now stand
   */
  const moveInto = (folderId, documentId) => {
    if (get(documentId)?.parentId === folderId) return childrenOf(folderId)
    return reorder(folderId, [...childrenOf(folderId).map(child => child.id), documentId])
  }

  /**
   * Switch a folder between keeping its children in order and sorting them
   * by name. Turned on, the order it starts from is the one showing: the
   * writer asked to keep what they were looking at, not to go back to the
   * sequence things were made in.
   * @param {string} documentId
   * @param {boolean} ordered
   */
  const setOrdered = (documentId, ordered) => {
    if (ordered && !isOrdered(documentId)) {
      documentsStore.reorderChildren(
        documentId,
        childrenOf(documentId).map(child => child.id)
      )
    }
    documentsStore.updateDocument(documentId, { ordered })
  }

  /**
   * @param {string} documentId
   * @param {boolean} hidden
   */
  const setHidden = (documentId, hidden) => documentsStore.updateDocument(documentId, { hidden })

  /**
   * Whether a document can be dropped into a folder. Nothing goes into a
   * repository, and what it is made of doesn't come out: it is settled
   * against where it came from, by path, and a refresh would undo the move.
   * A text document is never the repository's own, so one in there can leave.
   * @param {string} folderId
   * @param {string} documentId
   * @returns {boolean}
   */
  const canDropInto = (folderId, documentId) => {
    const document = get(documentId)
    return (
      !documentsStore.containsDocument(documentId, folderId) &&
      !repositoryOf(get, get(folderId)) &&
      (document?.type === 'text' || !inRepository(get, document))
    )
  }

  /**
   * Ask the node for `documentId` to start renaming as soon as it mounts.
   * @param {string} documentId
   */
  const requestRename = documentId => {
    pendingRenameId.value = documentId
  }

  /** @param {string} documentId */
  const claimRename = documentId => {
    if (pendingRenameId.value !== documentId) return false
    pendingRenameId.value = null
    return true
  }

  const api = {
    ready,
    error,
    init,
    pendingRenameId,
    requestRename,
    claimRename,
    root,
    tabs,
    activeDocumentId,
    open,
    keep,
    focus,
    closeTab,
    releaseTabs,
    get,
    editableTitle,
    childrenOf,
    firstTextDocument,
    isFolder,
    isOrdered,
    isHidden,
    displayTitle,
    pathOf,
    titlesOf,
    createFolder,
    createTextDocument,
    uniqueTitle,
    namesakeOf,
    rename,
    isPlain,
    wouldSettle,
    setPlain,
    setContent,
    currentContent,
    replaceText,
    appendContent,
    revertEdit,
    reapplyEdit,
    duplicate,
    remove,
    reorder,
    moveInto,
    setOrdered,
    setHidden,
    canDropInto,
  }

  instances.set(storyId, api)
  return api
}
