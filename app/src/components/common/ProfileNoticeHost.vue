<template>
  <Dialog
    :visible="!!pending"
    :header="pending?.header"
    :modal="true"
    :closable="true"
    :draggable="false"
    class="w-full max-w-lg"
    data-profile-notice
    @update:visible="visible => !visible && dismiss()"
  >
    <div class="flex flex-col gap-3 text-sm text-surface-700 dark:text-surface-300">
      <p v-for="(paragraph, index) in paragraphs" :key="index">{{ paragraph }}</p>
    </div>
    <template #footer>
      <Button label="Got it" size="small" autofocus @click="dismiss" />
    </template>
  </Dialog>
</template>

<script setup>
/**
 * Draws a profile's notice when one is waiting: once, mounted beside the app,
 * for every place a profile can be picked. See composables/useProfileNotice.js.
 */
import { computed } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import { useProfileNotice } from '@/composables/useProfileNotice.js'

const { pending, dismiss } = useProfileNotice()

const paragraphs = computed(() =>
  (pending.value?.message || '')
    .split(/\n\s*\n/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
)
</script>
