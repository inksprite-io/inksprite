<template>
  <!-- Escape in the code puts the find away as well, as it does in the bar,
       and goes no further: focus mode, which Escape also leaves, stays. -->
  <div
    ref="root"
    class="h-full w-full min-h-0 flex flex-col"
    data-file-code
    @keydown.esc="finding && ($event.stopPropagation(), closeFind())"
  >
    <!-- Find, over the code rather than in it. Nothing to replace in code
         that is only read. See editor/plainSearch. -->
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
      @update:query="lookFor"
      @update:match-case="refine({ matchCase: $event })"
      @update:whole-word="refine({ wholeWord: $event })"
      @next="run(findNext(1))"
      @previous="run(findNext(-1))"
      @close="closeFind"
    />
    <div ref="host" class="code-view code-tokens flex-1 min-h-0 w-full overflow-hidden"></div>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { syntaxHighlighting } from '@codemirror/language'
import { classHighlighter } from '@lezer/highlight'
import { languageFor } from '@/editor/codeLanguage.js'
import '@/editor/codeTokens.css'
import FindBar from '@/components/common/FindBar.vue'
import { useFindKey } from '@/composables/useFindKey.js'
import { find, findAt, findNext, plainSearch, reveal, searchOf } from '@/editor/plainSearch.js'

/**
 * A file's text as code: read-only, with line numbers, highlighted for the
 * language its name says. CodeMirror draws only what is on screen, so a long
 * file costs what a short one does.
 *
 * The highlighting is classes (`tok-keyword`, `tok-string`, …) coloured
 * for light and dark (`editor/codeTokens.css`), so it follows the app's
 * theme without a second CodeMirror theme to switch. Each language's parser
 * is loaded the first time a file of it is opened.
 *
 * For the same reason a long file costs little, the browser's own find sees
 * only the lines on screen, so the view has a find of its own: the plain
 * text editor's, without the replace.
 *
 * Loaded on its own, the first time a file of text is opened, so the editor
 * and its languages are not in the app until then.
 *
 * @typedef {Object} Props
 * @property {string} content - The text
 * @property {string} filename - Its name, which decides the highlighting
 */
const props = defineProps({
  content: { type: String, default: '' },
  filename: { type: String, default: '' },
})

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)
/** @type {import('vue').Ref<HTMLElement|null>} */
const host = ref(null)
/** @type {EditorView|null} */
let view = null
const language = new Compartment()

const layout = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'transparent' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    lineHeight: '1.55',
  },
  '.cm-content': { padding: '12px 0 50vh' },
  '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--code-rule)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 16px', color: 'var(--code-gutter)' },
  '.cm-line': { padding: '0 16px' },
})

/** Set the highlighting for the current file, if it is still the one shown. */
async function highlight() {
  const asked = props.filename
  const support = await languageFor(asked)
  if (view && props.filename === asked) view.dispatch({ effects: language.reconfigure(support) })
}

const finding = ref(false)
const query = ref('')
const matchCase = ref(false)
const wholeWord = ref(false)
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
 * Run a search command against the code, then show where it left the writer.
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

/** Put the find away, leaving the match the writer was on selected. */
const closeFind = () => {
  if (!finding.value) return
  finding.value = false
  if (view) find('')(view)
}

/**
 * Open the find on a match picked elsewhere, the project's search, by where
 * it comes among the matches. The focus stays where it is. It is brought
 * into view once the find has taken its room above the text.
 *
 * @param {string} text
 * @param {import('@/editor/search.js').SearchOptions} options
 * @param {number} index
 */
const showMatch = (text, options, index) => {
  if (!view) return
  query.value = text
  matchCase.value = !!options.matchCase
  wholeWord.value = !!options.wholeWord
  finding.value = true
  findAt(text, options, index)(view)
  nextTick(() => requestAnimationFrame(() => view && reveal(view)))
}

useFindKey(() => root.value, openFind)
defineExpose({ openFind, showMatch })

onMounted(() => {
  if (!host.value) return
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.content,
      extensions: [
        lineNumbers(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        syntaxHighlighting(classHighlighter),
        language.of([]),
        plainSearch,
        EditorView.updateListener.of(update => {
          const found = searchOf(update.state)
          if (found !== search.value) search.value = found
        }),
        layout,
      ],
    }),
  })
  highlight()
})

watch(
  () => props.content,
  content => {
    if (!view || view.state.doc.toString() === content) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
  }
)

watch(
  () => props.filename,
  () => highlight()
)

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<style>
.code-view {
  --code-rule: #e5e7eb;
  --code-gutter: #8c959f;
  color: #1f2328;
}
.dark .code-view {
  --code-rule: #30363d;
  --code-gutter: #6e7681;
  color: #e6edf3;
}
</style>
