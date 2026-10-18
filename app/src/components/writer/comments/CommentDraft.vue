<template>
  <div class="flex flex-col gap-3" data-comment-draft>
    <!-- The passage, edged as the highlight it will have. -->
    <p
      class="border-l-2 border-yellow-500 pl-2 text-xs text-surface-500 dark:text-surface-400 line-clamp-2 break-words"
      data-comment-passage
    >
      {{ passage }}
    </p>
    <form class="flex flex-col" @submit.prevent="add">
      <!-- Enter adds it, Shift-Enter starts a line, Escape drops it; the
           buttons under the field, so that it has the width. -->
      <Textarea
        ref="field"
        v-model="text"
        rows="1"
        auto-resize
        size="small"
        class="w-full max-h-40"
        :class="isMobile ? '!text-base/[1.5rem]' : '!text-sm'"
        placeholder="Comment"
        aria-label="Comment"
        data-draft-field
        @keydown.enter="onEnter"
        @keydown.esc.stop.prevent="$emit('cancel')"
      />
      <div class="flex justify-end">
        <Button
          v-tooltip.bottom="'Cancel'"
          type="button"
          icon="pi pi-times"
          text
          rounded
          size="small"
          aria-label="Cancel"
          data-action="cancel-comment"
          @click="$emit('cancel')"
        />
        <Button
          v-tooltip.bottom="'Add comment'"
          type="submit"
          icon="pi pi-check"
          text
          rounded
          size="small"
          severity="success"
          aria-label="Add comment"
          :disabled="!text.trim()"
          data-action="add-comment"
        />
      </div>
    </form>
  </div>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import Textarea from 'primevue/textarea'
import { submitOnEnter } from '@/utils/touch.js'
import { useScreenSize } from '@/composables/useScreenSize.js'

/**
 * A new comment being written in the Comments tab: the passage it will be
 * on, tinted meanwhile in the text, and the field for what to say. Its field
 * takes the focus as it shows, and again for a new passage.
 *
 * @typedef {Object} Props
 * @property {string} passage - The words it will be on
 */
const props = defineProps({
  passage: { type: String, required: true },
})

const emit = defineEmits(['add', 'cancel'])

const { isMobile } = useScreenSize()

const text = ref('')
/** @type {import('vue').Ref<{ $el: HTMLTextAreaElement }|null>} */
const field = ref(null)

const focus = async () => {
  await nextTick()
  field.value?.$el?.focus()
}

onMounted(focus)
watch(
  () => props.passage,
  () => {
    text.value = ''
    focus()
  }
)

const add = () => {
  if (text.value.trim()) emit('add', text.value.trim())
}

/**
 * Enter adds it and Shift-Enter starts a new line, as in the chat; on a touch
 * screen Enter starts one, and the button adds it. Enter that ends a word
 * being composed is the composing's.
 *
 * @param {KeyboardEvent} event
 */
const onEnter = event => {
  if (event.isComposing || event.shiftKey) return
  submitOnEnter(event, add)
}
</script>
