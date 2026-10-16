<template>
  <Dialog
    :visible="visible"
    modal
    header="Export"
    :style="{ width: '28rem', maxWidth: '95vw' }"
    @update:visible="emit('update:visible', $event)"
    @show="open"
  >
    <div class="h-[min(22rem,50vh)] overflow-y-auto pb-3" data-export-tree>
      <Tree
        v-if="nodes"
        v-model:expanded-keys="expanded"
        :value="nodes"
        selection-mode="checkbox"
        :selection-keys="keys"
        loading-mode="icon"
        :pt="{
          root: { class: '!p-0 !bg-transparent' },
          node: { class: '!outline-none' },
          nodeContent: { class: '!py-0.5 !px-1' },
          nodeLabel: { class: 'text-sm leading-snug' },
        }"
        @update:selection-keys="tick"
        @node-expand="read"
      >
        <template #default="{ node }">
          <span
            :class="node.selectable === false && 'text-surface-500 dark:text-surface-400'"
            :data-empty="node.selectable === false || undefined"
            >{{ node.label }}</span
          >
        </template>
      </Tree>
    </div>
    <div class="flex items-center gap-2 border-t border-surface-200 pt-3 dark:border-surface-700">
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
      <Button
        label="Export"
        size="small"
        data-action="export"
        :disabled="!nodes || ticked.size === 0"
        @click="exportTicked"
      />
    </template>
  </Dialog>
</template>

<script setup>
/**
 * What Export saves, as a tree of boxes: the projects, each with its
 * documents and chats, the character cards, and the settings, all ticked as
 * it opens. Everything ticked is a whole backup; settings alone, a settings
 * file; anything else, a selection of what was ticked. A project's documents
 * and chats are read when it is opened, and picking a setting picks what it
 * is no use without, such as a preset's connection. See
 * `utils/exportTree.js`.
 */
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import Tree from 'primevue/tree'
import { useBackup } from '@/composables/useBackup'
import { useToast } from '@/composables/useToast'
import {
  afterReading,
  exportPick,
  exportTree,
  leavesOf,
  selectionKeys,
  tickedLeaves,
} from '@/utils/exportTree.js'

/** @typedef {import('@/utils/exportTree.js').Exportable} Exportable */
/** @typedef {import('@/utils/exportTree.js').ExportNode} ExportNode */

/**
 * What the writer chose to export.
 *
 * @typedef {{pick: import('@/utils/exportTree.js').ExportPick, includeApiKeys: boolean}} ExportChoice
 */

defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits({
  'update:visible': (/** @type {boolean} */ visible) => typeof visible === 'boolean',
  export: (/** @type {ExportChoice} */ choice) => Boolean(choice?.pick),
})

const backup = useBackup()
const toast = useToast()

/** @type {import('vue').Ref<Exportable|null>} */
const exportable = ref(null)
/** The leaves ticked. @type {import('vue').Ref<Set<string>>} */
const ticked = ref(new Set())
/** @type {import('vue').Ref<Record<string, boolean>>} */
const expanded = ref({})
/** The projects whose documents and chats are being read. @type {import('vue').Ref<Set<string>>} */
const reading = ref(new Set())
const includeApiKeys = ref(false)

/** The tree, with a project being read showing so. */
const nodes = computed(() => {
  if (!exportable.value) return null
  const tree = exportTree(exportable.value)
  if (reading.value.size === 0) return tree
  return tree.map(top =>
    top.key === 'projects'
      ? {
          ...top,
          children: top.children?.map(node =>
            reading.value.has(node.key) ? { ...node, loading: true } : node
          ),
        }
      : top
  )
})

const keys = computed(() => (nodes.value ? selectionKeys(nodes.value, ticked.value) : {}))

/** As it opens: everything there is, all of it ticked, and no keys. */
async function open() {
  exportable.value = null
  expanded.value = {}
  reading.value = new Set()
  includeApiKeys.value = false
  try {
    exportable.value = await backup.listExportable()
    ticked.value = new Set(leavesOf(/** @type {ExportNode[]} */ (nodes.value)))
  } catch (error) {
    console.error('What there is to export could not be read:', error)
    toast.error(`What there is to export couldn't be read: ${error.message}`)
  }
}

/** @param {import('primevue/tree').TreeSelectionKeys} next */
function tick(next) {
  if (!nodes.value || !exportable.value) return
  ticked.value = tickedLeaves(nodes.value, next, ticked.value, exportable.value.settings)
}

/**
 * Read a project's documents and chats the first time it is opened.
 *
 * @param {import('primevue/treenode').TreeNode} node
 */
async function read(node) {
  const id = node.key.startsWith('project:') ? node.key.slice('project:'.length) : null
  const project = exportable.value?.projects.find(one => one.id === id)
  if (!id || !project || project.contents || reading.value.has(node.key)) return

  reading.value = new Set([...reading.value, node.key])
  try {
    const contents = await backup.readProjectContents(id)
    if (!exportable.value) return
    exportable.value = {
      ...exportable.value,
      projects: exportable.value.projects.map(one => (one.id === id ? { ...one, contents } : one)),
    }
    ticked.value = afterReading(ticked.value, /** @type {ExportNode[]} */ (nodes.value), id)
  } catch (error) {
    console.error(`Project ${id} could not be read:`, error)
    toast.error(`The project couldn't be read: ${error.message}`)
  } finally {
    const still = new Set(reading.value)
    still.delete(node.key)
    reading.value = still
  }
}

function exportTicked() {
  if (!nodes.value) return
  emit('export', {
    pick: exportPick(nodes.value, ticked.value),
    includeApiKeys: includeApiKeys.value,
  })
  emit('update:visible', false)
}
</script>
