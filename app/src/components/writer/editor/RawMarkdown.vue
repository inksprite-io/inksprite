<template>
  <div class="h-full w-full flex flex-col items-center min-w-0">
    <ScrollPanel
      ref="scrollPanel"
      class="flex-1 w-full min-h-0 min-w-0 overflow-auto overflow-x-hidden"
    >
      <div class="w-full flex flex-col items-center min-w-0">
        <textarea
          ref="field"
          :value="text"
          class="w-full max-w-[50rem] min-w-0 px-4 pt-4 pb-[50rem] font-mono text-sm leading-relaxed bg-transparent border-0 outline-none resize-none overflow-hidden text-surface-700 dark:text-surface-300"
          spellcheck="false"
          data-raw-markdown
          @input="onInput"
          @focus="focused = true"
          @blur="onBlur"
        ></textarea>
      </div>
    </ScrollPanel>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ScrollPanel from 'primevue/scrollpanel'
import { useDocuments } from '@/composables/useDocuments'
import { isTextField } from '@/utils/focus.js'
import { useEditor } from '@/composables/useEditor.js'

/**
 * A plain document, as the text it is: what the file holds and what the
 * model is shown, to read and to type in. The field is in front of the
 * document's text in the registry the way the editor is in front of a
 * structured document's state: every keystroke goes through, the store hears
 * after a pause, and what the assistant writes shows up as it lands, with
 * the caret kept where it was.
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

/** @type {import('vue').Ref<HTMLTextAreaElement|null>} */
const field = ref(null)
/** @type {import('vue').Ref<{ $el: HTMLElement }|null>} */
const scrollPanel = ref(null)
const text = ref('')
const focused = ref(false)

// The document's text, which the registry keeps reactive.
const held = computed(() => editor.markdown(props.documentId))

/** The element that scrolls, inside the scroll panel. */
const scroller = () => scrollPanel.value?.$el?.querySelector?.('.p-scrollpanel-content') ?? null

/**
 * The field grows with its text, so the panel is what scrolls.
 *
 * Measuring means letting the field collapse for a moment, which takes the
 * panel's scroll with it; put back, it leaves the view where the writer had
 * it, and the browser only scrolls if the caret has gone out of sight.
 */
const fit = () => {
  const element = field.value
  if (!element) return
  const panel = scroller()
  const top = panel?.scrollTop ?? 0
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight}px`
  if (panel) panel.scrollTop = top
}

/**
 * Show the document's text, keeping the caret where it was as far as the
 * new text allows.
 * @param {string} markdown
 */
const take = async markdown => {
  const element = field.value
  const caret = element?.selectionStart ?? 0
  text.value = markdown
  await nextTick()
  fit()
  if (element && focused.value) {
    const at = Math.min(caret, markdown.length)
    element.setSelectionRange(at, at)
  }
}

/** @param {Event} event */
const onInput = event => {
  const value = /** @type {HTMLTextAreaElement} */ (event.target).value
  text.value = value
  editor.setText(props.documentId, value)
  // Writing in a preview is keeping it.
  api.keep(props.documentId)
  fit()
}

/** Leaving the field is a pause in typing, so the store hears at once. */
const onBlur = () => {
  focused.value = false
  editor.flush(props.documentId)
}

// What was typed here comes back as itself and is already shown; anything
// else is the document changing under the field, and is taken.
watch(held, markdown => {
  if (markdown !== text.value) take(markdown)
})

/** The tab going to the background is the last chance to write the text out. */
const onVisibilityChange = () => {
  if (document.hidden) editor.flush(props.documentId)
}

onMounted(async () => {
  await api.init()
  const id = props.documentId
  // Opened, or resumed, as text: the same truth the store would give.
  editor.open(id, api.get(id)?.content || '', true)
  await take(held.value)
  document.addEventListener('visibilitychange', onVisibilityChange)
  // The caret comes here, unless the writer is typing somewhere else.
  if (!isTextField()) field.value?.focus()

  const element = scroller()
  if (element) element.scrollTop = editor.scrollTop(id)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChange)
  const id = props.documentId
  const element = scroller()
  if (element) editor.rememberScroll(id, element.scrollTop)
  editor.flush(id)
})
</script>
