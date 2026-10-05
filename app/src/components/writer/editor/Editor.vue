<template>
  <div class="h-full w-full flex flex-col items-center min-w-0">
    <ScrollPanel
      ref="scrollPanel"
      class="flex-1 w-full min-h-0 min-w-0 overflow-auto overflow-x-hidden"
    >
      <div class="w-full h-full flex flex-col items-center min-w-0">
        <div ref="host" class="flex-1 w-full max-w-[50rem] min-w-0 px-4" />
      </div>
    </ScrollPanel>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, nextTick, computed, ref, watch } from 'vue'
import { Decoration, DecorationSet, EditorView } from 'prosemirror-view'
import 'prosemirror-view/style/prosemirror.css'
import 'prosemirror-gapcursor/style/gapcursor.css'
import ScrollPanel from 'primevue/scrollpanel'

import { useApplicationState } from '@/composables/useApplicationState'
import { useEditor } from '@/composables/useEditor.js'
import { useDocuments } from '@/composables/useDocuments'
import { useNarration } from '@/composables/useNarration'
import { TINT, speakerRanges } from '@/tts/highlight.js'
import { isTextField } from '@/utils/focus.js'

/**
 * @typedef {Object} Props
 * @property {string} storyId - The ID of the current story
 * @property {string} documentId - The ID of the document being shown
 */
const props = defineProps({
  storyId: { type: String, required: true },
  documentId: { type: String, required: true },
})

// The open documents. This component is keyed by document id and mounts a
// view over one of them; the document stays open, in the registry, when the
// view goes — closing is what closing a tab does.
const editor = useEditor()

// The story's document tree
const api = useDocuments(props.storyId)

const currentDocument = computed(() => api.get(props.documentId))

/** Where the view mounts. @type {import('vue').Ref<HTMLElement|null>} */
const host = ref(null)
/** @type {import('vue').Ref<{ $el: HTMLElement }|null>} */
const scrollPanel = ref(null)
/** @type {EditorView|null} */
let view = null

/** The element that scrolls, inside the scroll panel. */
const scroller = () => scrollPanel.value?.$el?.querySelector?.('.p-scrollpanel-content') ?? null

// While the narration is showing beside the editor, each speaker's lines are
// coloured in the text. Decorations, so nothing is written into the document:
// the speakers are an overlay here as they are everywhere.
const narration = useNarration(props.storyId)
const { highlightSpeakers } = useApplicationState()

/** What the colouring is made from, or null while there is none to do. */
const highlight = computed(() => {
  if (narration.watching.value === 0 || !highlightSpeakers.value) return null
  const speakers = currentDocument.value?.speakers
  return speakers?.length ? { speakers, voices: narration.voices.value } : null
})

/** The last colouring, kept while neither the text nor its sources change. */
let drawn = { doc: null, source: null, set: DecorationSet.empty }

/** @param {import('prosemirror-state').EditorState} state */
const decorations = state => {
  const source = highlight.value
  if (!source) return DecorationSet.empty
  if (drawn.doc !== state.doc || drawn.source !== source) {
    const ranges = speakerRanges(state.doc, source.speakers, source.voices)
    drawn = {
      doc: state.doc,
      source,
      set: DecorationSet.create(
        state.doc,
        ranges.map(({ from, to, color, name }) =>
          Decoration.inline(from, to, {
            style: `background-color: ${color}${TINT}; border-radius: 0.2em;`,
            title: name,
            'data-speaker': name,
          })
        )
      ),
    }
  }
  return drawn.set
}

// The colouring changes from outside the editor — a speaker given, a voice
// recoloured, the panel closed — and the view is told to look again.
watch(highlight, () => view?.setProps({ decorations }))

/** The tab going to the background is the last chance to write the document out. */
const onVisibilityChange = () => {
  if (document.hidden) editor.flush(props.documentId)
}

let alive = true

onMounted(async () => {
  // Ensure data is ready first (prevents races)
  await api.init()
  if (!alive || !host.value) return

  const id = props.documentId
  const state = editor.open(id, currentDocument.value?.content || '')
  view = new EditorView(host.value, {
    state,
    decorations,
    dispatchTransaction: tr => {
      editor.dispatch(id, tr)
      // Writing in a preview is keeping it.
      if (tr.docChanged) api.keep(id)
    },
    attributes: {
      class:
        'flex-1 prose font-sans dark:prose-invert sm:prose lg:prose-lg focus:outline-none pt-[1rem] pb-[50rem]',
    },
    handleDOMEvents: {
      blur: () => {
        editor.flush(id)
        return false
      },
    },
  })
  editor.attach(id, view)
  document.addEventListener('visibilitychange', onVisibilityChange)
  // The caret comes here, unless the writer is typing somewhere else — naming
  // this very document in the tree, say — in which case it stays there.
  if (!isTextField()) view.focus()

  // A tab coming back is scrolled to where it was left. The content has to be
  // laid out first for the height to be there to scroll to.
  await nextTick()
  const element = scroller()
  if (element) element.scrollTop = editor.scrollTop(id)
})

onBeforeUnmount(() => {
  alive = false
  document.removeEventListener('visibilitychange', onVisibilityChange)
  const id = props.documentId
  const element = scroller()
  if (element) editor.rememberScroll(id, element.scrollTop)
  editor.flush(id)
  editor.attach(id, null)
  view?.destroy()
  view = null
})
</script>
