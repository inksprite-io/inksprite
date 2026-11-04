<template>
  <Dialog
    :visible="asking !== null"
    :header="asking ? `Block ${asking.person.name}?` : ''"
    :modal="true"
    class="w-full max-w-md"
    data-block-dialog
    @update:visible="open => open || cancel()"
  >
    <div v-if="asking" class="flex flex-col gap-3 text-sm text-surface-700 dark:text-surface-200">
      <p v-if="mine" data-block-mine>They'll be taken out of {{ mine }}.</p>
      <template v-if="theirs">
        <p data-block-theirs>You'll leave {{ theirs }}.</p>
        <label class="flex items-center gap-2 cursor-pointer">
          <Checkbox v-model="deleteTheirs" binary size="small" data-field="block-delete-theirs" />
          <span>Delete their projects</span>
        </label>
      </template>
    </div>
    <template #footer>
      <Button
        label="Cancel"
        severity="secondary"
        outlined
        size="small"
        :disabled="busy"
        data-action="block-cancel"
        @click="cancel"
      />
      <Button
        label="Block"
        severity="danger"
        size="small"
        :loading="busy"
        data-action="block-confirm"
        @click="confirm"
      />
    </template>
  </Dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import { useBlocking } from '@/composables/useBlocking.js'
import { useCloudSync } from '@/composables/useCloudSync.js'
import { useProjects } from '@/composables/useProjects.js'
import { useToast } from '@/composables/useToast.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useStoriesStore } from '@/stores/storiesStore'

/**
 * Asks before blocking someone a project is shared with, either way: they
 * are taken out of this account's projects, and it leaves theirs, which go
 * to the trash if the writer ticks Delete their projects, and otherwise
 * come back out of it as this account's own, kept on this device. See
 * composables/useBlocking.js.
 */
const { asking } = useBlocking()
const cloud = useCloudSync()
const projects = useProjects()
const toast = useToast()
const documentsStore = useDocumentsStore()
const storiesStore = useStoriesStore()

const deleteTheirs = ref(false)
const busy = ref(false)

watch(asking, next => {
  if (!next) return
  deleteTheirs.value = false
  // The projects' names, for those not opened since the app started.
  storiesStore.loadNames().catch(() => {})
})

/**
 * Projects by name, as a sentence's list.
 * @param {string[]} storyIds
 */
function listed(storyIds) {
  const names = storyIds
    .map(storyId => documentsStore.getRoot(storyId)?.title || 'Untitled')
    .sort((a, b) => a.localeCompare(b))
  if (names.length === 0) return ''
  return names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

const mine = computed(() => listed(asking.value?.mine ?? []))
const theirs = computed(() => listed(asking.value?.theirs ?? []))

function cancel() {
  if (!busy.value) asking.value = null
}

async function confirm() {
  const blocking = asking.value
  if (!blocking || busy.value) return
  busy.value = true
  try {
    await cloud.block(blocking.person.account)
    if (!deleteTheirs.value) {
      for (const storyId of blocking.theirs) {
        if (storiesStore.trash.has(storyId)) await projects.restore(storyId)
      }
    }
    asking.value = null
  } catch (error) {
    toast.error(
      `${blocking.person.name} couldn't be blocked. ${/** @type {Error} */ (error).message}`
    )
  } finally {
    busy.value = false
  }
}
</script>
