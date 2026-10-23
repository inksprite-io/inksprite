/**
 * @module composables/useVersions
 * @description A text document's versions, as the Versions dialog shows
 * them: listed, compared with the text now, restored, named, kept and
 * deleted. Taking them is `stores/versionsStore.js`'s.
 *
 * A restore is a change from outside the editor like any other: the text as
 * it stands is kept as a version first, so a restore is undone by restoring
 * that one. See `.llm/versions_design.md`.
 */

import { ref } from 'vue'
import { useDocuments } from './useDocuments.js'
import { useEditor } from './useEditor.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useVersionsStore } from '@/stores/versionsStore'

/** @typedef {import('@/types/models.js').Version} Version */

/**
 * The document whose versions are showing, from anywhere in the writer: the
 * outline's menu, a tab's. One for the app.
 * @type {import('vue').Ref<string|null>}
 */
const showing = ref(null)

/**
 * The version to show first, when the dialog was opened on one: the text
 * that lost a clash. Taken by the dialog once it has the list.
 * @type {import('vue').Ref<string|null>}
 */
const picking = ref(null)

/**
 * Where the Versions dialog is opened from, and closed.
 * @returns {{showing: import('vue').Ref<string|null>, picking: import('vue').Ref<string|null>, open: (documentId: string, versionId?: string) => void, close: () => void}}
 */
export function useVersionsPanel() {
  return {
    showing,
    picking,
    open: (documentId, versionId) => {
      picking.value = versionId ?? null
      showing.value = documentId
    },
    close: () => {
      showing.value = null
    },
  }
}

/**
 * @param {string} storyId
 */
export function useVersions(storyId) {
  const documents = useDocuments(storyId)
  const documentsStore = useDocumentsStore()
  const versionsStore = useVersionsStore()
  const editor = useEditor()

  /**
   * A document's versions, the newest first.
   * @param {string} documentId
   * @returns {Promise<Version[]>}
   */
  const list = documentId => versionsStore.list(documentId)

  /**
   * A document's text now, what was typed in it included.
   * @param {string} documentId
   * @returns {string}
   */
  const current = documentId => documents.currentContent(documentId)

  /**
   * Put a version's text in place of the document's, keeping the text it
   * had as a version first.
   * @param {Version} version
   */
  const restore = version =>
    documents.fromOutside(version.documentId, 'restore', () =>
      documents.setContent(version.documentId, version.content)
    )

  /**
   * Keep the text a document has now, under a name.
   * @param {string} documentId
   * @param {string} name
   * @returns {Promise<Version|null>}
   */
  const keepNamed = async (documentId, name) => {
    editor.flush(documentId)
    const document = documentsStore.getDocument(documentId)
    return document ? versionsStore.keepNamed(document, name) : null
  }

  return {
    list,
    current,
    restore,
    keepNamed,
    rename: versionsStore.rename,
    remove: versionsStore.remove,
  }
}
