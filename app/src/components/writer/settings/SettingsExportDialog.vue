<template>
  <Dialog
    :visible="visible"
    modal
    header="Export settings"
    :style="{ width: '28rem', maxWidth: '95vw' }"
    @update:visible="emit('update:visible', $event)"
    @show="open"
  >
    <div class="h-[min(22rem,50vh)] overflow-y-auto pb-3" data-export-tree>
      <Tree
        v-if="nodes"
        :value="nodes"
        selection-mode="checkbox"
        :selection-keys="keys"
        :pt="{
          root: { class: '!p-0 !bg-transparent' },
          node: { class: '!outline-none' },
          nodeContent: { class: '!py-0.5 !px-1' },
          nodeLabel: { class: 'text-sm leading-snug' },
        }"
        @update:selection-keys="tick"
      />
    </div>
    <div class="flex items-center gap-2 border-t border-surface-200 pt-3 dark:border-surface-700">
      <Checkbox v-model="includeApiKeys" input-id="settings-export-include-api-keys" binary />
      <label for="settings-export-include-api-keys" class="text-sm">Include API keys</label>
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
 * What a settings file holds, as a tree of boxes: the writer's setup under a
 * heading for each kind, all of it ticked as it opens. Picking a setting
 * picks what it is no use without, such as a preset's connection. See
 * `utils/settingsTree.js`.
 */
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import Tree from 'primevue/tree'
import { useBackup } from '@/composables/useBackup'
import { useToast } from '@/composables/useToast'
import {
  leavesOf,
  pickedSettings,
  selectionKeys,
  settingsTree,
  tickedLeaves,
} from '@/utils/settingsTree.js'

/** @typedef {import('@/utils/settingsFile.js').SettingsItem} SettingsItem */

/**
 * What the writer chose to put in the file.
 *
 * @typedef {{picked: Set<string>, includeApiKeys: boolean}} SettingsExportChoice
 */

defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits({
  'update:visible': (/** @type {boolean} */ visible) => typeof visible === 'boolean',
  export: (/** @type {SettingsExportChoice} */ choice) => choice?.picked instanceof Set,
})

const backup = useBackup()
const toast = useToast()

/** @type {import('vue').Ref<SettingsItem[]|null>} */
const items = ref(null)
/** The settings ticked. @type {import('vue').Ref<Set<string>>} */
const ticked = ref(new Set())
const includeApiKeys = ref(false)

const nodes = computed(() => (items.value ? settingsTree(items.value) : null))
const keys = computed(() => (nodes.value ? selectionKeys(nodes.value, ticked.value) : {}))

/** As it opens: every setting there is, all of it ticked, and no keys. */
async function open() {
  items.value = null
  includeApiKeys.value = false
  try {
    items.value = await backup.listSettings()
    ticked.value = new Set(leavesOf(nodes.value || []))
  } catch (error) {
    console.error('The settings could not be read:', error)
    toast.error(`The settings couldn't be read. ${error.message}`)
  }
}

/** @param {import('primevue/tree').TreeSelectionKeys} next */
function tick(next) {
  if (!nodes.value || !items.value) return
  ticked.value = tickedLeaves(nodes.value, next, ticked.value, items.value)
}

function exportTicked() {
  emit('export', { picked: pickedSettings(ticked.value), includeApiKeys: includeApiKeys.value })
  emit('update:visible', false)
}
</script>
