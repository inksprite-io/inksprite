<template>
  <PlainText
    v-if="ready"
    ref="field"
    :text="held"
    :start-at="startAt"
    :caret="api.takesCaret(documentId)"
    class="h-full w-full"
    @input="type"
    @blur="flush"
  />
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import PlainText from './PlainText.vue'
import { useDocuments } from '@/composables/useDocuments'
import { useEditor } from '@/composables/useEditor.js'
import { goneTo, takeUpMatch } from '@/composables/useProjectSearch.js'

/**
 * A plain document, as the text it is: what the file holds and what the
 * model is shown, to read and to type in. The view is in front of the
 * document's text in the registry the way the editor is in front of a
 * structured document's state: every keystroke goes through, the store hears
 * after a pause, and what the assistant writes shows up as it lands, with
 * the caret kept where it was. The text itself is in `PlainText`.
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

/** Whether the document is open in the registry, and the text can be shown. */
const ready = ref(false)

// The document's text, which the registry keeps reactive.
const held = computed(() => editor.markdown(props.documentId))

/**
 * Where the view starts: by its own anchor where the last view over the text
 * left one, and after a conversion by the offset the other kind left.
 * @type {import('./PlainText.vue').Scroll|null}
 */
let startAt = null

/**
 * @type {import('vue').Ref<{
 *   openFind: () => boolean,
 *   showMatch: (text: string, options: import('@/editor/search.js').SearchOptions, index: number) => void,
 *   scroll: () => import('./PlainText.vue').Scroll,
 * }|null>}
 */
const field = ref(null)

// A match the project's search picked in this document opens the find on it,
// once the field is there to show it.
watch(
  [field, goneTo],
  () => {
    if (!field.value) return
    const match = takeUpMatch(props.documentId)
    if (match) field.value.showMatch(match.query, match.options, match.index)
  },
  { flush: 'post' }
)

/**
 * What was typed, into the document.
 * @param {string} text
 */
const type = text => {
  editor.setText(props.documentId, text)
  // Writing in a preview is keeping it.
  api.keep(props.documentId)
}

/** Leaving the view is a pause in typing, so the store hears at once. */
const flush = () => editor.flush(props.documentId)

/** The tab going to the background is the last chance to write the text out. */
const onVisibilityChange = () => {
  if (document.hidden) flush()
}

defineExpose({ openFind: () => field.value?.openFind() ?? false })

let alive = true

onMounted(async () => {
  await api.init()
  if (!alive) return
  const id = props.documentId
  // Opened, or resumed, as text: the same truth the store would give.
  editor.open(id, api.get(id)?.content || '', true)
  startAt = { top: editor.scrollTop(id), anchor: editor.scrollAnchor(id) }
  ready.value = true
  document.addEventListener('visibilitychange', onVisibilityChange)
})

onBeforeUnmount(() => {
  alive = false
  document.removeEventListener('visibilitychange', onVisibilityChange)
  const at = field.value?.scroll()
  if (at) editor.rememberScroll(props.documentId, at.top, at.anchor)
  flush()
})
</script>
