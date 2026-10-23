<template>
  <div
    ref="root"
    class="w-full px-1 py-1"
    data-comment-popover
    @mousedown="holdCaret"
    @keydown.esc.stop.prevent="$emit('close', true)"
    @focusout="onFocusOut"
  >
    <CommentThread
      v-if="thread"
      :passage="passage"
      :state="state"
      :posts="posts"
      :people="people"
      :active="editing"
      autofocus
      popover
      @activate="$emit('activate')"
      @resolve="$emit('resolve')"
      @reply="text => $emit('reply', text)"
      @edit="(index, text) => $emit('edit', index, text)"
      @delete="index => $emit('delete', index)"
      @close="$emit('close', true)"
    />

    <form v-else class="flex w-full flex-col" @submit.prevent="save">
      <!-- A new comment: the field, as wide as a comment that runs to the
           full width, and its buttons under it. Escape goes back to the text;
           going anywhere else just puts it away. (No comment between the
           thread and the form: in development it makes a fragment of them,
           which fails to unmount.) -->
      <Textarea
        ref="field"
        v-model="draft"
        rows="1"
        auto-resize
        size="small"
        class="keeps-scrollbar w-full max-h-40 overscroll-contain"
        :class="[
          isMobile ? '!text-base/[1.5rem]' : '!text-[0.9375rem]/[1.375rem]',
          { '!overflow-y-auto': full },
        ]"
        placeholder="Comment"
        aria-label="Comment"
        data-comment-field
        @keydown.enter="onEnter"
      />
      <!-- A pressed button would take the focus from the field, and in Safari
           give it to nothing, which puts the field away before the click. -->
      <div class="flex justify-end" @mousedown.prevent>
        <Button
          type="button"
          icon="pi pi-times"
          text
          rounded
          size="small"
          aria-label="Cancel"
          data-action="cancel-comment"
          @click="$emit('close', true)"
        />
        <Button
          type="submit"
          icon="pi pi-check"
          text
          rounded
          size="small"
          severity="success"
          aria-label="Add comment"
          :disabled="!draft.trim()"
          data-action="save-comment"
        />
      </div>
    </form>
  </div>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import Textarea from 'primevue/textarea'
import CommentThread from '../comments/CommentThread.vue'
import { submitOnEnter } from '@/utils/touch.js'
import { useScreenSize } from '@/composables/useScreenSize.js'

/**
 * On a phone, the comment the caret is in, shown as its thread (see
 * `CommentThread`), or the field for writing a new one on a passage: in a bar
 * at the bottom of the screen, out of the way of the menu iOS keeps beside a
 * selection. On the desktop comments are read and written in the Comments
 * tab instead. No tooltips: a tap shows one and leaves it up, over the field.
 *
 * While the thread is only showing, the caret stays in the passage: a press
 * on it is held off the text, and picking it is asking to answer it, which
 * the editor marks by `editing`. From then on the thread has the focus, and
 * going anywhere outside it puts it away, as the new comment's field does.
 *
 * @typedef {Object} Props
 * @property {boolean} [thread] - A comment on the text, rather than a new one's field
 * @property {string} [passage] - The words it is on
 * @property {'open'|'stale'|'resolved'} [state]
 * @property {Array<{author: string, name?: string, text: string}>} [posts] - What has been said, in order
 * @property {import('@/cloud/people.js').People|null} [people] - Who is who, where the project is shared
 * @property {boolean} [editing] - The thread picked, or the new comment's field
 */
const props = defineProps({
  thread: { type: Boolean, default: false },
  passage: { type: String, default: '' },
  state: { type: String, default: 'open' },
  posts: { type: Array, default: () => [] },
  people: { type: Object, default: null },
  editing: { type: Boolean, default: false },
})

const emit = defineEmits(['activate', 'resolve', 'reply', 'edit', 'delete', 'save', 'close'])

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)
/** @type {import('vue').Ref<{ $el: HTMLTextAreaElement }|null>} */
const field = ref(null)

const draft = ref('')

// iOS zooms the page in on a field whose text is smaller than 16px, and does
// not zoom back out, so on a phone the field keeps the full size.
const { isMobile } = useScreenSize()

/**
 * The field grown as tall as it may, so that what is written scrolls in it.
 * Only then does it get a scrollbar: PrimeVue sizes it to its text less its
 * border, so it is always that much short and would show one for a line.
 */
const full = ref(false)

/**
 * Whether an element's text would make it taller than it may be.
 *
 * @param {HTMLElement} element
 * @returns {boolean}
 */
const pastMaxHeight = element => {
  const border = element.offsetHeight - element.clientHeight
  return element.scrollHeight + border > parseFloat(window.getComputedStyle(element).maxHeight)
}

const fit = async () => {
  await nextTick()
  if (!props.thread) {
    const text = field.value?.$el
    full.value = !!text && pastMaxHeight(text)
  }
}

/**
 * The new comment's field opens with the focus. The editor's selection is let
 * go first: iOS keeps its menu (Copy, Paste) over a selection the editor still
 * holds, and the menu covers the field. The passage stays tinted, and the
 * editor puts its selection back when the field closes.
 */
const focusField = async () => {
  await nextTick()
  const element = field.value?.$el
  if (!element) return
  window.getSelection()?.removeAllRanges()
  element.focus()
}

onMounted(() => {
  fit()
  if (props.editing && !props.thread) focusField()
})

watch(
  () => [props.thread, props.editing, props.posts],
  () => {
    fit()
    if (props.editing && !props.thread) {
      draft.value = ''
      focusField()
    }
  }
)

watch(draft, fit)

/**
 * A press on the thread while it is only showing leaves the caret where it
 * is, in the passage: taking the focus from the text would put the thread
 * away before the press is a click. Picking it hands it the focus.
 *
 * @param {MouseEvent} event
 */
const holdCaret = event => {
  if (props.thread && !props.editing) event.preventDefault()
}

const save = () => {
  if (draft.value.trim()) emit('save', draft.value.trim())
}

/**
 * Enter saves and Shift-Enter starts a new line, as in the chat; on a touch
 * screen Enter starts one, and the button saves. Enter that ends a word being
 * composed is the composing's.
 *
 * @param {KeyboardEvent} event
 */
const onEnter = event => {
  if (event.isComposing || event.shiftKey) return
  submitOnEnter(event, save)
}

/** @param {FocusEvent} event */
const onFocusOut = event => {
  if (!props.editing) return
  const next = /** @type {Node|null} */ (event.relatedTarget)
  if (!next || !root.value?.contains(next)) emit('close', false)
}

/**
 * A press anywhere else puts it away too, as the focus leaving does: a post
 * deleted from under the focus leaves it on nothing, and nothing would
 * leave.
 *
 * @param {Event} event
 */
const pressedElsewhere = event => {
  if (!root.value?.contains(/** @type {Node} */ (event.target))) emit('close', false)
}

watch(
  () => props.editing,
  editing => {
    if (editing) document.addEventListener('pointerdown', pressedElsewhere, true)
    else document.removeEventListener('pointerdown', pressedElsewhere, true)
  },
  { immediate: true }
)

onBeforeUnmount(() => document.removeEventListener('pointerdown', pressedElsewhere, true))
</script>

<style scoped>
/* What is written is on the box's own ground, so a scrollbar shown only while
   it scrolls would give no sign that there is more of it: the thumb stays, on
   no track. Safari and Chrome keep a scrollbar they are given a style for. */
.keeps-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.keeps-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.keeps-scrollbar::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: rgb(128 128 128 / 0.45);
}
@supports not selector(::-webkit-scrollbar) {
  .keeps-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgb(128 128 128 / 0.45) transparent;
  }
}
</style>
