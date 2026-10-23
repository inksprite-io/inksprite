/**
 * @module composables/useProjectSearch
 * @description The writer's search across a project (`editor/projectSearch`):
 * what they look for and how, what it finds in the documents as they are now,
 * and going to one of the matches.
 *
 * What was looked for is kept for each project while the app is open, since
 * the sidebar's list is made again each time it shows. What it finds follows
 * the documents: it is found again once the typing pauses, in the field or in
 * a document.
 *
 * Going to a match is asked here and taken up by the view that shows its
 * document, as a comment is gone to (`useComments`): the editor, a plain
 * document's field and a file of code open their find on the query, on that
 * match; a PDF opens at the page the match is on. The going is made before
 * the document opens, so a view made for it finds it waiting, and is taken
 * once, so a tab come back to later stays where the writer left it.
 *
 * Mod-Shift-F shows the list with the caret in its field, looking for what
 * is selected if that is a few words on one line.
 */

import { computed, onBeforeUnmount, onMounted, readonly, ref, shallowRef, watch } from 'vue'
import { useDocuments } from './useDocuments.js'
import { useEditor } from './useEditor.js'
import { useFocusMode } from './useFocusMode.js'
import { useSidebarTab } from './useSidebarTab.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { searchProject } from '@/editor/projectSearch.js'
import { SIDEBAR_TABS } from '@/components/writer/layout/layout.js'

/**
 * @typedef {import('@/editor/search.js').SearchOptions} SearchOptions
 * @typedef {import('@/editor/projectSearch.js').ProjectFound} ProjectFound
 * @typedef {import('@/types/models.js').Document} Document
 *
 * A match gone to. `seq` counts the goings, so going to the same match again
 * is asked again: the writer has moved since.
 * @typedef {Object} Going
 * @property {string} documentId
 * @property {string} query
 * @property {SearchOptions} options
 * @property {number} index - Which of the document's matches, from 0
 * @property {number} [at] - Where it is in the text, in a document found in
 *   as it is
 * @property {number} seq
 */

/** How long the typing pauses before the search runs, in ms. */
const DELAY = 150

/** @typedef {{query: import('vue').Ref<string>, matchCase: import('vue').Ref<boolean>, wholeWord: import('vue').Ref<boolean>}} Kept */

/** Each project's search, while the app is open. @type {Map<string, Kept>} */
const searches = new Map()

/**
 * @param {string} storyId
 * @returns {Kept}
 */
const keptFor = storyId => {
  let kept = searches.get(storyId)
  if (!kept) {
    kept = { query: ref(''), matchCase: ref(false), wholeWord: ref(false) }
    searches.set(storyId, kept)
  }
  return kept
}

/** @type {import('vue').Ref<Going|null>} */
const going = ref(null)
let goings = 0
/** The going a view has taken up: each is taken once. */
let takenUp = 0

/** The match gone to last, for the views to watch. */
export const goneTo = readonly(going)

/**
 * Go to a match: the view that shows its document takes it up.
 *
 * @param {Omit<Going, 'seq'>} match
 */
export const goToMatch = match => {
  going.value = { ...match, seq: ++goings }
}

/**
 * The match gone to, if it was in this document and no view has taken it up
 * yet. Asked by a view when the going changes and when it is made.
 *
 * @param {string} documentId
 * @returns {Going|null}
 */
export const takeUpMatch = documentId => {
  const now = going.value
  if (!now || now.documentId !== documentId || now.seq === takenUp) return null
  takenUp = now.seq
  return now
}

/** Counts the asks for the search's field, which the list watches. */
const focusing = ref(0)
/** The last ask the list took up. */
let focusTaken = 0

/** The asks for the field, for the list to watch. */
export const focusRequests = readonly(focusing)

/** Ask for the caret in the search's field: from the rail, or Mod-Shift-F. */
export const requestSearchField = () => {
  focusing.value++
}

/**
 * Whether the field was asked for since the list last looked: asked by the
 * list when it is made, and when an ask comes.
 *
 * @returns {boolean}
 */
export const takeSearchField = () => {
  if (focusing.value === focusTaken) return false
  focusTaken = focusing.value
  return true
}

/**
 * The search across one project.
 *
 * @param {string} storyId
 */
export function useProjectSearch(storyId) {
  const api = useDocuments(storyId)
  const editor = useEditor()
  const { query, matchCase, wholeWord } = keptFor(storyId)

  /** The documents with text, in the outline's order. */
  const documents = computed(() => {
    /** @type {Document[]} */
    const listed = []
    const walk = (/** @type {string} */ parentId) => {
      for (const child of api.childrenOf(parentId)) {
        if (child.type === 'folder') walk(child.id)
        else listed.push(child)
      }
    }
    walk(rootIdFor(storyId))
    return listed
  })

  /** @type {import('vue').ComputedRef<SearchOptions>} */
  const options = computed(() => ({ matchCase: matchCase.value, wholeWord: wholeWord.value }))

  /**
   * The documents as the search reads them. One open in the editor is
   * searched as it stands there; one laid out and not open, in its stored
   * markdown.
   *
   * @returns {import('@/editor/projectSearch.js').Searchable[]}
   */
  const searchable = () =>
    documents.value.map(document => {
      const laidOut = document.type === 'text' && !api.isPlain(document.id)
      return {
        id: document.id,
        title: api.displayTitle(document),
        content: laidOut ? document.content || '' : api.currentContent(document.id),
        laidOut,
        doc: laidOut ? editor.stateOf(document.id)?.doc : null,
      }
    })

  /** @type {import('vue').ShallowRef<ProjectFound>} */
  const found = shallowRef(searchProject([], ''))
  /** What the results were found for. */
  const searched = ref('')
  /** @type {SearchOptions} */
  let searchedWith = {}

  const run = () => {
    found.value = searchProject(searchable(), query.value, options.value)
    searched.value = query.value
    searchedWith = options.value
  }

  // Again once the typing pauses, in the field or in a document: every
  // keystroke in the editor is a change to what is searched.
  /** @type {ReturnType<typeof setTimeout>|undefined} */
  let timer
  watch([query, options, searchable], () => {
    clearTimeout(timer)
    timer = setTimeout(run, query.value ? DELAY : 0)
  })
  onBeforeUnmount(() => clearTimeout(timer))
  run()

  /** Whether the results are for what is typed, rather than what was. */
  const current = computed(() => searched.value === query.value)

  /**
   * Go to one of a document's matches.
   *
   * @param {string} documentId
   * @param {{index: number, at?: number}} match
   */
  const goTo = (documentId, { index, at }) =>
    goToMatch({ documentId, query: searched.value, options: searchedWith, index, at })

  return { query, matchCase, wholeWord, found, current, goTo }
}

/**
 * What is selected, if it is a few words on one line: what Mod-Shift-F looks
 * for, as Mod-F does.
 *
 * @returns {string}
 */
const selectedWords = () => {
  const selected = window.getSelection?.()?.toString() ?? ''
  return selected && !selected.includes('\n') && selected.length <= 200 ? selected : ''
}

/**
 * Whether a key is the search's: Shift with the find key.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function isSearchKey(event) {
  if (event.altKey || !event.shiftKey || event.key?.toLowerCase() !== 'f') return false
  const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '')
  return isMac ? !!event.metaKey && !event.ctrlKey : !!event.ctrlKey && !event.metaKey
}

/**
 * Take Mod-Shift-F anywhere in the writer, for as long as the component
 * calling this is mounted: the writer's frame. It shows the search, out of
 * focus mode, with the caret in its field.
 *
 * @param {() => string|null|undefined} storyId - The project open
 */
export function useProjectSearchKey(storyId) {
  const sidebarTab = useSidebarTab()
  const focusMode = useFocusMode()

  /** @param {KeyboardEvent} event */
  const onKeyDown = event => {
    if (event.defaultPrevented || !isSearchKey(event)) return
    const id = storyId()
    if (!id) return
    event.preventDefault()
    const words = selectedWords()
    if (words) keptFor(id).query.value = words
    focusMode.leave()
    sidebarTab.show(SIDEBAR_TABS.SEARCH)
    requestSearchField()
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
}
