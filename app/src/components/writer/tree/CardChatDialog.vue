<template>
  <Dialog
    :visible="visible"
    :header="card ? `Chat with ${card.title}` : 'Chat'"
    :modal="true"
    :closable="true"
    :class="['w-full', greetings.length > 1 ? 'max-w-2xl' : 'max-w-md']"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <label
          for="card-chat-user-name"
          class="text-xs font-medium text-surface-700 dark:text-surface-200"
        >
          Your name
        </label>
        <InputText
          id="card-chat-user-name"
          v-model="userName"
          class="w-full"
          autofocus
          data-user-name
          @keydown.enter.prevent="confirm"
        />
      </div>

      <div v-if="greetings.length > 1" class="flex flex-col gap-1">
        <span class="text-xs font-medium text-surface-700 dark:text-surface-200">Opening</span>
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
      </div>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="$emit('update:visible', false)" />
      <Button label="Start chat" :disabled="!userName.trim()" @click="confirm" />
    </template>
  </Dialog>
</template>

<script setup>
/**
 * Starting a chat on a card: the writer's name in it, and which greeting
 * opens it.
 *
 * The name is what `{{user}}` becomes in everything the chat's model reads,
 * and there is no good guess at it, so it is asked every time and the chat
 * does not start without one. It starts as the one given last.
 *
 * The greeting is asked only when the card has more than one, and only here,
 * before anything has been said: once the writer has taken a turn, the
 * greeting is a message in a conversation that answered it, and swapping it
 * out from under the reply is not a thing to offer.
 */
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** @type {import('vue').PropType<import('@/cards/chat.js').CardChat|null>} */
  card: { type: Object, default: null },
  /** The name given last, to start from. */
  lastUserName: { type: String, default: '' },
})

const emit = defineEmits(['update:visible', 'confirm'])

const userName = ref('')
const chosen = ref(0)

const greetings = computed(() => props.card?.greetings || [])

// A different card is a different question, and the answer to the last one is
// not an answer to this.
watch(
  () => props.card,
  () => {
    userName.value = props.lastUserName
    chosen.value = 0
  },
  { immediate: true }
)

/** Enough to tell them apart without making the dialog a reading exercise. */
const preview = content => {
  const text = (content || '').trim()
  return text.length > 320 ? `${text.slice(0, 320).trimEnd()}…` : text
}

const confirm = () => {
  const name = userName.value.trim()
  if (!name) return
  emit('confirm', { userName: name, greeting: chosen.value })
}
</script>
