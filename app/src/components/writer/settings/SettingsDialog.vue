<template>
  <!-- Escape is handled here rather than by the dialog, so that a dialog
       opened over the settings — a provider's configuration, a confirmation —
       is the only one Escape closes. -->
  <Dialog
    ref="dialog"
    :visible="visible"
    header="Settings"
    modal
    :closable="true"
    :close-on-escape="false"
    :draggable="false"
    :dismissable-mask="true"
    class="w-[min(60rem,95vw)] h-[min(44rem,90vh)]"
    :pt="{ content: { class: 'flex-1 min-h-0 !p-0 overflow-hidden' } }"
    @update:visible="$emit('update:visible', $event)"
  >
    <Settings class="h-full" />
  </Dialog>
</template>

<script setup>
import { ref, toRef } from 'vue'
import Dialog from 'primevue/dialog'
import Settings from './Settings.vue'
import { useTopmostEscape } from '@/composables/useTopmostEscape.js'

/**
 * The settings, over the writer rather than beside it. They are app-wide, so
 * they do not belong in a panel scoped to one project.
 *
 * @typedef {Object} Props
 * @property {boolean} visible
 */
const props = defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['update:visible'])

/** @type {import('vue').Ref<{ mask?: HTMLElement }|null>} */
const dialog = ref(null)

useTopmostEscape(
  toRef(props, 'visible'),
  () => dialog.value?.mask,
  () => emit('update:visible', false)
)
</script>
