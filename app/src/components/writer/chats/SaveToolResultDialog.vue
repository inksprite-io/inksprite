<template>
  <Dialog
    :visible="visible"
    modal
    header="Save to project"
    :style="{ width: '28rem', maxWidth: 'calc(100vw - 2rem)' }"
    data-save-result
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-3">
      <p class="text-xs text-surface-500 dark:text-surface-400 m-0">
        {{ server }}’s answer to <span class="font-mono">{{ tool }}</span
        >.
      </p>
      <label class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300">
        Title
        <InputText v-model="title" size="small" data-field="title" @keydown.enter="save" />
      </label>
      <label class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300">
        Folder
        <Select
          v-model="folderId"
          :options="folders"
          option-label="label"
          option-value="id"
          size="small"
          class="w-full"
          data-field="folder"
        />
      </label>
    </div>
    <template #footer>
      <Button
        label="Cancel"
        text
        severity="secondary"
        size="small"
        @click="$emit('update:visible', false)"
      />
      <Button
        label="Save"
        size="small"
        :disabled="!title.trim()"
        data-action="save-result"
        @click="save"
      />
    </template>
  </Dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Button from 'primevue/button'
import { useDocuments } from '@/composables/useDocuments.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { localStorage } from '@/utils/localStorage.js'
import { savedContent, savedTitle } from '@/mcp/saved.js'

/**
 * Keep a server's tool result in the project: a title, a folder, and the
 * result as a document. See mcp/saved.js.
 */

const props = defineProps({
  visible: { type: Boolean, default: false },
  storyId: { type: String, required: true },
  /** The server's name, as the writer gave it */
  server: { type: String, required: true },
  /** The tool, as its server names it */
  tool: { type: String, required: true },
  /** What it was asked, parsed */
  args: { type: null, default: undefined },
  /** What it answered, as the model read it */
  result: { type: String, required: true },
})

const emit = defineEmits(['update:visible', 'saved'])

const documents = useDocuments(props.storyId)
const rootId = rootIdFor(props.storyId)

/** Where the last result in this project was saved, to offer it again. */
const lastFolderKey = `ui.save-result.folder.${props.storyId}`

/**
 * Every folder in the project, by path, the project itself first.
 *
 * @returns {Array<{id: string, label: string}>}
 */
const folders = computed(() => {
  const out = [{ id: rootId, label: documents.root.value?.title || 'Project' }]
  /**
   * @param {string} parentId
   * @param {string} path
   */
  const walk = (parentId, path) => {
    for (const child of documents.childrenOf(parentId)) {
      if (child.type !== 'folder') continue
      const here = path ? `${path} / ${child.title}` : child.title
      out.push({ id: child.id, label: here })
      walk(child.id, here)
    }
  }
  walk(rootId, '')
  return out
})

const title = ref('')
const folderId = ref(rootId)

watch(
  () => props.visible,
  open => {
    if (!open) return
    title.value = savedTitle(props.result, `${props.server} ${props.tool}`)
    const last = localStorage.get(lastFolderKey, null)
    folderId.value = folders.value.some(folder => folder.id === last) ? last : rootId
  },
  { immediate: true }
)

function save() {
  if (!title.value.trim()) return
  const parentId = folderId.value || rootId
  const document = documents.createTextDocument(
    parentId,
    documents.uniqueTitle(parentId, title.value.trim()),
    savedContent({ result: props.result, server: props.server, tool: props.tool, args: props.args })
  )
  localStorage.set(lastFolderKey, parentId)
  emit('saved', document)
  emit('update:visible', false)
}
</script>
