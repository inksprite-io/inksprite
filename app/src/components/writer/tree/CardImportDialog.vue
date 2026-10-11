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
        Overwrites this card's documents. Edits made to them since are lost.
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

      <div v-if="found.systemPrompt" class="flex flex-col gap-1">
        <div class="flex items-center justify-between gap-2">
          <label class="text-xs font-medium text-surface-700 dark:text-surface-200">
            Use the card's system prompt
          </label>
          <ToggleSwitch v-model="useSystemPrompt" class="flex-none" />
        </div>
        <p class="text-xs text-surface-500 dark:text-surface-400">
          Usually a preset's scaffolding rather than anything about the character.
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
 * surprise, and the one thing they may want to decide — whether to take the
 * system prompt — cannot be asked afterwards.
 */
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import ToggleSwitch from 'primevue/toggleswitch'

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** What the file turned out to hold; see `useCardImport`. */
  found: { type: Object, default: null },
})

const emit = defineEmits(['update:visible', 'confirm'])

const useSystemPrompt = ref(false)

// A fresh card is a fresh question, and the answer for the last one is not an
// answer about this one.
watch(
  () => props.found,
  () => (useSystemPrompt.value = false)
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
  emit('confirm', { useSystemPrompt: useSystemPrompt.value })
}
</script>
