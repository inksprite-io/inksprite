<template>
  <div v-if="api.ready.value" class="h-full w-full flex items-center justify-center">
    <div class="flex flex-col items-center gap-4 text-center px-4">
      <i
        class="text-6xl text-surface-400"
        :class="isEmpty ? 'pi pi-file-edit' : 'pi pi-folder-open'"
      ></i>
      <div>
        <h2 class="text-2xl font-semibold text-surface-700 dark:text-surface-200">
          {{ isEmpty ? 'Nothing to write in yet' : 'Nothing open' }}
        </h2>
        <p class="text-surface-500 dark:text-surface-400 mt-2">
          {{
            isEmpty
              ? 'A project is whatever folders and documents you put in it.'
              : 'Pick a document from the outline, or start a new one.'
          }}
        </p>
      </div>
      <Button label="New document" icon="pi pi-plus" @click="createDocument" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import Button from 'primevue/button'
import { useDocuments } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

/**
 * The editor with nothing in it. For a project with no text document that is
 * the one thing to do; for one whose tabs are all closed it is where to look.
 * Shown only once the tree has loaded, so a project still loading shows
 * nothing rather than this.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 */
const props = defineProps({
  storyId: { type: String, required: true },
})

const api = useDocuments(props.storyId)

const isEmpty = computed(() => !api.firstTextDocument())

/**
 * A document at the root, opened in the editor, with its rename waiting in the
 * tree — the same as the tree's own "New document", from the other side.
 */
const createDocument = () => {
  const created = api.createTextDocument(rootIdFor(props.storyId), '')
  api.requestRename(created.id)
  api.open(created.id)
}
</script>
