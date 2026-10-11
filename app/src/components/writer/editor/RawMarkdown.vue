<template>
  <!-- Escape in the page puts the find away as well, as it does in the bar. -->
  <div ref="root" class="h-full w-full flex flex-col min-w-0" @keydown.esc="finding && closeFind()">
    <!-- Find and replace, over the text rather than in it. See editor/plainSearch. -->
    <FindBar
      v-if="finding"
      ref="findBar"
      class="w-full"
      :query="query"
      :count="search.matches.length"
      :current="search.current"
      refinable
      :match-case="matchCase"
      :whole-word="wholeWord"
      replaceable
      :replacement="replacement"
      @update:query="lookFor"
      @update:match-case="refine({ matchCase: $event })"
      @update:whole-word="refine({ wholeWord: $event })"
      @update:replacement="replacement = $event"
      @next="run(findNext(1))"
      @previous="run(findNext(-1))"
      @replace="run(replaceCurrent(replacement))"
      @replace-all="run(replaceAll(replacement))"
      @close="closeFind"
    />
    <div
      ref="host"
      class="flex-1 min-h-0 w-full font-mono text-sm leading-relaxed text-surface-700 dark:text-surface-300"
      data-raw-markdown
    ></div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Annotation, EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, insertNewline } from '@codemirror/commands'
import FindBar from '@/components/common/FindBar.vue'
import { useDocuments } from '@/composables/useDocuments'
import { useEditor } from '@/composables/useEditor.js'
import { useFindKey } from '@/composables/useFindKey.js'
import {
  find,
  findNext,
  plainSearch,
  replaceAll,
  replaceCurrent,
  reveal,
  searchOf,
} from '@/editor/plainSearch.js'
import { plainMacros } from '@/editor/plainMacros.js'
import { isTextField } from '@/utils/focus.js'

/**
 * A plain document, as the text it is: what the file holds and what the
 * model is shown, to read and to type in. The view is in front of the
 * document's text in the registry the way the editor is in front of a
 * structured document's state: every keystroke goes through, the store hears
 * after a pause, and what the assistant writes shows up as it lands, with
 * the caret kept where it was.
 *
 * The text is in CodeMirror, which draws only the lines on screen, so a
 * document of any length types as fast as a short one; a field, or the
 * editor laying a long document out, has the whole of it to lay out again on
 * every key. For the same reason the browser's own find sees only what is on
 * screen, and the view has a find of its own.
 *
 * Loaded on its own, the first time a plain document is opened, so that
 * CodeMirror is not in the app until then.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} documentId
 */
const props = defineProps({
  storyId: { type: String, required: true },
  documentId: { type: String, required: true },
})

const api = useDocuments(props.storyId)
const editor = useEditor()

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)
/** @type {import('vue').Ref<HTMLElement|null>} */
const host = ref(null)
/** @type {EditorView|null} */
let view = null

// The document's text, which the registry keeps reactive.
const held = computed(() => editor.markdown(props.documentId))

/**
 * The text the view shows, as the registry was last given it or gave it: the
 * same string, so that telling the writer's own keystrokes from a change
 * elsewhere costs nothing, however long the document.
 */
let shown = ''

/** Marks a change that came from elsewhere, which is not the writer's to undo. */
const fromOutside = Annotation.define()

/**
 * Show the document's text where it differs from what is shown, as the one
 * change between them, so that the caret and the scroll move with the text
 * around them.
 * @param {string} markdown
 */
const take = markdown => {
  if (!view || markdown === shown) return
  const end = Math.min(shown.length, markdown.length)
  let from = 0
  while (from < end && shown.charCodeAt(from) === markdown.charCodeAt(from)) from++
  let to = shown.length
  let until = markdown.length
  while (to > from && until > from && shown.charCodeAt(to - 1) === markdown.charCodeAt(until - 1)) {
    to--
    until--
  }
  shown = markdown
  view.dispatch({
    changes: { from, to, insert: markdown.slice(from, until) },
    annotations: [fromOutside.of(true), Transaction.addToHistory.of(false)],
  })
}

// What was typed here comes back as itself and is already shown; anything
// else is the document changing under the view, and is taken.
watch(held, take)

/** Leaving the view is a pause in typing, so the store hears at once. */
const flush = () => editor.flush(props.documentId)

/** The tab going to the background is the last chance to write the text out. */
const onVisibilityChange = () => {
  if (document.hidden) flush()
}

const layout = EditorView.theme({
  '&': { height: '100%', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: 'inherit' },
  // Room under the text for its last line to come up to the middle of the
  // screen, as in the editor, and no more, so a short one has nothing to scroll.
  '.cm-content': { maxWidth: '50rem', margin: '0 auto', padding: '1rem 0 50vh' },
  // The base theme's caret is black, or white for a dark theme it is told of.
  '&.cm-editor .cm-content': { caretColor: 'currentColor' },
  '.cm-line': { padding: '0 1rem' },
})

const finding = ref(false)
const query = ref('')
const matchCase = ref(false)
const wholeWord = ref(false)
const replacement = ref('')
/** The search the view holds, for the bar to count. */
const search = shallowRef(
  /** @type {import('@/editor/plainSearch.js').Found} */ ({
    query: '',
    options: {},
    matches: [],
    current: -1,
  })
)
/** @type {import('vue').Ref<{ focus: () => void }|null>} */
const findBar = ref(null)

/**
 * Run a search command against the text, then show where it left the writer.
 * @param {(view: EditorView) => boolean} command
 */
const run = command => {
  if (!view) return
  command(view)
  reveal(view)
}

/** @param {string} text */
const lookFor = text => {
  query.value = text
  run(find(text, { matchCase: matchCase.value, wholeWord: wholeWord.value }))
}

/**
 * Look for the same thing another way.
 * @param {{matchCase?: boolean, wholeWord?: boolean}} change
 */
const refine = change => {
  if ('matchCase' in change) matchCase.value = change.matchCase
  if ('wholeWord' in change) wholeWord.value = change.wholeWord
  lookFor(query.value)
}

/**
 * Open the find, or go back to it, looking for what is selected if that is a
 * few words on one line, and otherwise for what was looked for last.
 *
 * @returns {boolean}
 */
const openFind = () => {
  if (!view) return false
  const { from, to } = view.state.selection.main
  const selected = view.state.sliceDoc(from, to)
  if (selected && !selected.includes('\n') && selected.length <= 200) query.value = selected
  finding.value = true
  lookFor(query.value)
  nextTick(() => findBar.value?.focus())
  return true
}

/** Put the find away, with the caret on the match the writer was on. */
const closeFind = () => {
  if (!finding.value) return
  finding.value = false
  if (!view) return
  find('')(view)
  view.focus()
}

useFindKey(() => root.value, openFind)
defineExpose({ openFind })

let alive = true

onMounted(async () => {
  await api.init()
  if (!alive || !host.value) return
  const id = props.documentId
  // Opened, or resumed, as text: the same truth the store would give.
  editor.open(id, api.get(id)?.content || '', true)
  shown = held.value
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: shown,
      extensions: [
        history(),
        // A new line is a new line, as it is in any field: nothing carried down.
        keymap.of([{ key: 'Enter', run: insertNewline }, ...defaultKeymap, ...historyKeymap]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ spellcheck: 'false' }),
        plainSearch,
        plainMacros,
        EditorView.updateListener.of(update => {
          const found = searchOf(update.state)
          if (found !== search.value) search.value = found
          if (!update.docChanged || update.transactions.some(tr => tr.annotation(fromOutside)))
            return
          shown = update.state.doc.toString()
          editor.setText(id, shown)
          // Writing in a preview is keeping it.
          api.keep(id)
        }),
        EditorView.domEventHandlers({ blur: flush }),
        layout,
      ],
    }),
  })
  document.addEventListener('visibilitychange', onVisibilityChange)
  // The caret comes here, unless the writer is typing somewhere else.
  if (!isTextField()) view.focus()
  // Back where the view was left, by its own anchor; after a conversion, by
  // the offset the other kind left.
  const anchor = /** @type {import('@codemirror/state').StateEffect<unknown>|null} */ (
    editor.scrollAnchor(id)
  )
  if (anchor) view.dispatch({ effects: anchor })
  else view.scrollDOM.scrollTop = editor.scrollTop(id)
})

onBeforeUnmount(() => {
  alive = false
  document.removeEventListener('visibilitychange', onVisibilityChange)
  const id = props.documentId
  if (view) editor.rememberScroll(id, view.scrollDOM.scrollTop, view.scrollSnapshot())
  flush()
  view?.destroy()
  view = null
})
</script>
