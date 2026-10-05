<template>
  <Dialog
    :visible="visible"
    header="Which opening?"
    :modal="true"
    :closable="true"
    class="w-full max-w-2xl"
    @update:visible="$emit('update:visible', $event)"
  >
    <p class="text-xs text-surface-500 dark:text-surface-400 mb-3">
      The card offers more than one way in. Whichever you pick opens the chat as its first message,
      and you can edit it afterwards like any other.
    </p>

    <div class="flex flex-col gap-2 max-h-[26rem] overflow-y-auto">
      <button
        v-for="(greeting, at) in greetings"
        :key="greeting.id"
        type="button"
        class="text-left p-3 rounded-lg border transition-colors"
        :class="
          at === chosen
            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
            : 'border-surface-200 dark:border-surface-700 hover:bg-surface-100 dark:hover:bg-surface-700/40'
        "
        @click="chosen = at"
      >
        <span class="block text-xs font-medium text-surface-500 dark:text-surface-400 mb-1">
          {{ greeting.title }}
        </span>
        <span class="block text-sm text-surface-700 dark:text-surface-200 whitespace-pre-wrap">
          {{ preview(greeting.content) }}
        </span>
      </button>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="$emit('update:visible', false)" />
      <Button label="Start chat" @click="$emit('confirm', chosen)" />
    </template>
  </Dialog>
</template>

<script setup>
/**
 * Which greeting opens the chat.
 *
 * Only here, and only before anything has been said: once the writer has taken
 * a turn, the greeting is a message in a conversation that answered it, and
 * swapping it out from under the reply is not a thing to offer.
 */
import { ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** @type {import('vue').PropType<import('@/cards/chat.js').Greeting[]>} */
  greetings: { type: Array, default: () => [] },
})

defineEmits(['update:visible', 'confirm'])

const chosen = ref(0)

// A different card is a different question, and the answer to the last one is
// not an answer to this.
watch(
  () => props.greetings,
  () => (chosen.value = 0)
)

/** Enough to tell them apart without making the dialog a reading exercise. */
const preview = content => {
  const text = (content || '').trim()
  return text.length > 320 ? `${text.slice(0, 320).trimEnd()}…` : text
}
</script>
