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
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Annotation, EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, insertNewline } from '@codemirror/commands'
import FindBar from '@/components/common/FindBar.vue'
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
 * Text in the plain text editor, to read and to type in, with a find of its
 * own. What the text is — a plain document, a chat's system prompt — is the
 * owner's business: it hands the text in, hears what is typed, and hands
 * back whatever the text becomes, which is shown with the caret kept where it
 * was.
 *
 * The text is in CodeMirror, which draws only the lines on screen, so a text
 * of any length types as fast as a short one; a field, or the editor laying
 * a long document out, has the whole of it to lay out again on every key. For
 * the same reason the browser's own find sees only what is on screen, and
 * the view has a find of its own.
 *
 * Loaded with its owners, the first time one is opened, so that CodeMirror is
 * not in the app until then.
 *
 * @typedef {Object} Scroll
 * @property {number} top - The offset the view was scrolled to
 * @property {unknown} anchor - Where it was, as the view keeps it: a long
 *   text's view guesses at the height of what it has not drawn, so a pixel
 *   offset does not come back to the same line
 *
 * @typedef {Object} Props
 * @property {string} text - The text, as it stands
 * @property {Scroll|null} [startAt] - Where to start, as `scroll()` left it
 */
const props = defineProps({
  text: { type: String, required: true },
  startAt: { type: Object, default: null },
})

const emit = defineEmits(['input', 'blur'])

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)
/** @type {import('vue').Ref<HTMLElement|null>} */
const host = ref(null)
/** @type {EditorView|null} */
let view = null

/**
 * The text the view shows, as it was last handed in or typed: the same
 * string, so that telling the writer's own keystrokes from a change
 * elsewhere costs nothing, however long the text.
 */
let shown = props.text

/** Marks a change that came from elsewhere, which is not the writer's to undo. */
const fromOutside = Annotation.define()

/**
 * Show the text where it differs from what is shown, as the one change
 * between them, so that the caret and the scroll move with the text around
 * them.
 * @param {string} text
 */
const take = text => {
  if (!view || text === shown) return
  const end = Math.min(shown.length, text.length)
  let from = 0
  while (from < end && shown.charCodeAt(from) === text.charCodeAt(from)) from++
  let to = shown.length
  let until = text.length
  while (to > from && until > from && shown.charCodeAt(to - 1) === text.charCodeAt(until - 1)) {
    to--
    until--
  }
  shown = text
  view.dispatch({
    changes: { from, to, insert: text.slice(from, until) },
    annotations: [fromOutside.of(true), Transaction.addToHistory.of(false)],
  })
}

// What was typed here comes back as itself and is already shown; anything
// else is the text changing under the view, and is taken.
watch(() => props.text, take)

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

/**
 * Where the view is scrolled to, for the next view over the same text to
 * start from.
 * @returns {Scroll}
 */
const scroll = () => ({
  top: view?.scrollDOM.scrollTop ?? 0,
  anchor: view?.scrollSnapshot() ?? null,
})

defineExpose({ openFind, scroll })

onMounted(() => {
  if (!host.value) return
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
          emit('input', shown)
        }),
        EditorView.domEventHandlers({ blur: () => emit('blur') }),
        layout,
      ],
    }),
  })
  // The caret comes here, unless the writer is typing somewhere else.
  if (!isTextField()) view.focus()
  // Back where the view was left, by its own anchor where it left one.
  const anchor = /** @type {import('@codemirror/state').StateEffect<unknown>|null} */ (
    props.startAt?.anchor
  )
  if (anchor) view.dispatch({ effects: anchor })
  else if (props.startAt) view.scrollDOM.scrollTop = props.startAt.top
})

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>
