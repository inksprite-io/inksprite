<template>
  <Dialog
    :visible="visible"
    header="Add a card from a link"
    modal
    :draggable="false"
    class="w-[min(32rem,95vw)]"
    data-card-link-dialog
    @update:visible="$emit('update:visible', $event)"
    @show="focusField"
  >
    <form class="flex flex-col gap-2" @submit.prevent="add">
      <InputText
        ref="field"
        v-model="link"
        type="url"
        placeholder="https://…"
        aria-label="Link"
        class="w-full"
        :invalid="Boolean(problem)"
        data-card-link
        @input="problem = ''"
      />
      <p class="text-xs text-surface-500 dark:text-surface-400">
        A botbooru or Chub page, or a link to a PNG or JSON card.
      </p>
      <p
        v-if="problem"
        class="text-xs text-red-600 dark:text-red-400"
        role="alert"
        data-link-problem
      >
        {{ problem }}
      </p>
    </form>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="$emit('update:visible', false)" />
      <Button
        label="Add"
        :loading="adding"
        :disabled="!link.trim()"
        data-action="add-link"
        @click="add"
      />
    </template>
  </Dialog>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { useCardLibraryStore } from '@/stores/cardLibraryStore.js'

/**
 * A card added from a link: a botbooru or Chub page, or a card's own
 * address. What goes wrong is said under the field, so the link can be fixed
 * there; what comes in is the library's to report.
 *
 * @typedef {Object} Props
 * @property {boolean} visible
 */
const props = defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['update:visible', 'added'])

const library = useCardLibraryStore()

const link = ref('')
const problem = ref('')
const adding = ref(false)
/** @type {import('vue').Ref<any>} */
const field = ref(null)

// Opened afresh, it starts empty.
watch(
  () => props.visible,
  visible => {
    if (!visible) return
    link.value = ''
    problem.value = ''
  }
)

const focusField = () => nextTick(() => field.value?.$el?.focus())

const add = async () => {
  if (!link.value.trim() || adding.value) return
  adding.value = true
  try {
    const result = await library.addLink(link.value)
    emit('added', result)
    emit('update:visible', false)
  } catch (error) {
    problem.value = error instanceof Error ? error.message : String(error)
  } finally {
    adding.value = false
  }
}
</script>
