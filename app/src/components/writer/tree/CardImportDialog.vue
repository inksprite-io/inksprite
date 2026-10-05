<template>
  <Dialog
    :visible="visible"
    :header="header"
    :modal="true"
    :closable="true"
    class="w-full max-w-xl"
    @update:visible="$emit('update:visible', $event)"
  >
    <div v-if="found" class="flex flex-col gap-4">
      <!-- What it is, before anything is written. A card is somebody else's
           work and the writer should see what is about to land in their tree. -->
      <div class="flex flex-col gap-1">
        <h3 class="text-base font-semibold text-surface-800 dark:text-surface-100">
          {{ found.title }}
        </h3>
        <p v-if="subtitle" class="text-xs text-surface-500 dark:text-surface-400">
          {{ subtitle }}
        </p>
      </div>

      <p
        v-if="found.replaces"
        class="text-xs text-surface-600 dark:text-surface-300"
        data-replaces-note
      >
        Everything in this card's folder is written again from the card it arrived as. Edits made to
        those documents since are lost.
      </p>

      <div class="flex flex-wrap gap-1.5">
        <span
          v-for="part in parts"
          :key="part"
          class="px-2 py-0.5 rounded-full text-xs bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-200"
        >
          {{ part }}
        </span>
      </div>

      <div v-if="found.shape === 'card'" class="flex flex-col gap-1">
        <label
          for="card-user-name"
          class="text-xs font-medium text-surface-700 dark:text-surface-200"
        >
          Your name in this card
        </label>
        <InputText
          id="card-user-name"
          v-model="userName"
          placeholder="You"
          class="w-full"
          autofocus
        />
        <p class="text-xs text-surface-500 dark:text-surface-400">
          Cards write <code>{{ USER_MACRO }}</code> where they mean whoever is reading. It is put in
          once, here, so the documents are ordinary text afterwards.
        </p>
      </div>

      <div v-if="found.systemPrompt" class="flex flex-col gap-1">
        <div class="flex items-center justify-between gap-2">
          <label class="text-xs font-medium text-surface-700 dark:text-surface-200">
            Use the card's system prompt
          </label>
          <ToggleSwitch v-model="useSystemPrompt" class="flex-none" />
        </div>
        <p class="text-xs text-surface-500 dark:text-surface-400">
          This card carries one. Most that do are carrying a preset's scaffolding rather than
          anything about the character, so it is off unless you say otherwise.
        </p>
      </div>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="$emit('update:visible', false)" />
      <Button
        :label="`${found?.replaces ? 'Re-import' : 'Import'} ${countLabel}`"
        :disabled="!found"
        @click="confirm"
      />
    </template>
  </Dialog>
</template>

<script setup>
/**
 * What the importer found, shown before it writes anything.
 *
 * A card is somebody else's work and arrives with more in it than its name —
 * a book of several hundred entries, a dozen greetings, a prompt override.
 * Writing all of that into the writer's tree without saying so first is a
 * surprise, and the two things they may want to decide — what `{{user}}`
 * becomes, and whether to take the system prompt — cannot be asked afterwards.
 */
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'

/** Written out rather than inline: a template cannot hold its own delimiters. */
const USER_MACRO = ['{{', 'user', '}}'].join('')

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** What the file turned out to hold; see `useCardImport`. */
  found: { type: Object, default: null },
})

const emit = defineEmits(['update:visible', 'confirm'])

const userName = ref('')
const useSystemPrompt = ref(false)

// A fresh card is a fresh set of answers, and a name typed for the last one is
// not an answer about this one.
watch(
  () => props.found,
  () => {
    userName.value = ''
    useSystemPrompt.value = false
  }
)

const header = computed(() => {
  if (props.found?.shape === 'lorebook') return 'Import a lorebook'
  return props.found?.replaces ? 'Re-import a character card' : 'Import a character card'
})

const subtitle = computed(() => {
  const card = props.found
  if (!card) return ''
  const bits = []
  // The character's own name, when the card is filed under something else.
  if (card.shape === 'card' && card.name && card.name !== card.title) bits.push(card.name)
  if (card.creator) bits.push(`by ${card.creator}`)
  return bits.join(' · ')
})

/** What is in it, in the order somebody would want to know. */
const parts = computed(() => {
  const card = props.found
  if (!card) return []

  if (card.shape === 'lorebook') return [entries(card.lore)]

  const found = []
  if (card.description) found.push('description')
  if (card.personality) found.push('personality')
  if (card.scenario) found.push('scenario')
  if (card.examples) found.push('example dialogue')
  if (card.greetings > 0)
    found.push(card.greetings === 1 ? '1 greeting' : `${card.greetings} greetings`)
  if (card.lore > 0) found.push(entries(card.lore))
  if (card.rules) found.push("an author's note")
  return found
})

const countLabel = computed(() => {
  // The system prompt is one more document when it is taken.
  const total = (props.found?.documents ?? 0) + (useSystemPrompt.value ? 1 : 0)
  return total === 1 ? '1 document' : `${total} documents`
})

/** @param {number} count */
const entries = count => (count === 1 ? '1 lore entry' : `${count} lore entries`)

const confirm = () => {
  emit('confirm', {
    userName: userName.value.trim() || 'You',
    useSystemPrompt: useSystemPrompt.value,
  })
}
</script>
