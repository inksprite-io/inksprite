<template>
  <Dialog
    :visible="sync.askedToUpdate.value"
    header="Update inksprite"
    :modal="true"
    class="w-full max-w-md"
    data-sync-update-dialog
    @update:visible="open => open || sync.putOffUpdate()"
  >
    <p class="text-sm text-surface-700 dark:text-surface-200">
      Some changes can't sync until inksprite is updated.
    </p>
    <template #footer>
      <Button
        label="Later"
        severity="secondary"
        outlined
        size="small"
        data-action="sync-update-later"
        @click="sync.putOffUpdate()"
      />
      <Button
        v-if="updateReady"
        label="Update"
        size="small"
        data-action="sync-update-now"
        @click="update"
      />
    </template>
  </Dialog>
</template>

<script setup>
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import { useCloudSync } from '@/composables/useCloudSync.js'
import { updateReady } from '@/composables/useUpdates.js'

/**
 * Said once as sync begins to wait for an update: a newer app's changes
 * hold back what comes in, or the server takes nothing from this build.
 * Update shows once the update is ready, which the app looks for at once.
 * Settings › Sync and sharing says it too, for as long as it waits. See
 * composables/useCloudSync.js.
 */
const sync = useCloudSync()

async function update() {
  const ready = updateReady.value
  sync.putOffUpdate()
  await ready?.apply()
}
</script>
