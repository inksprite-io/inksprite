<template>
  <Dialog
    :visible="visible"
    modal
    header="Export"
    :style="{ width: '22rem', maxWidth: '95vw' }"
    @update:visible="emit('update:visible', $event)"
    @show="includeApiKeys = false"
  >
    <div class="flex items-center gap-2">
      <Checkbox v-model="includeApiKeys" input-id="export-include-api-keys" binary />
      <label for="export-include-api-keys" class="text-sm">Include API keys</label>
    </div>
    <template #footer>
      <Button
        label="Cancel"
        severity="secondary"
        outlined
        size="small"
        @click="emit('update:visible', false)"
      />
      <Button label="Export" size="small" data-action="export" @click="exportAll" />
    </template>
  </Dialog>
</template>

<script setup>
/**
 * A backup of everything: every project with its chats, trash and versions,
 * the card library, and the settings. The one thing to choose is whether the
 * keys go in it, which starts off.
 */
import { ref } from 'vue'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'

defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits({
  'update:visible': (/** @type {boolean} */ visible) => typeof visible === 'boolean',
  export: (/** @type {{includeApiKeys: boolean}} */ choice) =>
    typeof choice?.includeApiKeys === 'boolean',
})

const includeApiKeys = ref(false)

function exportAll() {
  emit('export', { includeApiKeys: includeApiKeys.value })
  emit('update:visible', false)
}
</script>
