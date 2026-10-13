<template>
  <Dialog
    :visible="visible"
    modal
    header="Export"
    :style="{ width: '24rem', maxWidth: '95vw' }"
    @update:visible="emit('update:visible', $event)"
    @show="reset"
  >
    <div class="flex flex-col gap-2 pb-3">
      <div class="flex items-center gap-2">
        <RadioButton v-model="kind" input-id="export-everything" value="backup" />
        <label for="export-everything" class="text-sm">Everything</label>
      </div>
      <div class="flex items-center gap-2">
        <RadioButton v-model="kind" input-id="export-settings" value="settings" />
        <label for="export-settings" class="text-sm">Settings</label>
      </div>
    </div>
    <div
      v-if="kind === 'settings'"
      class="max-h-[45vh] overflow-y-auto pl-7 pr-1"
      data-settings-items
    >
      <section v-for="group in groups" :key="group.kind" class="pb-3">
        <h4 class="pb-1 text-xs font-semibold text-surface-700 dark:text-surface-200">
          {{ group.heading }}
        </h4>
        <div
          v-for="item in group.items"
          :key="item.key"
          class="flex items-center gap-2 py-0.5"
          :data-item="item.key"
        >
          <Checkbox
            :model-value="picked.has(item.key)"
            :input-id="`settings-item-${item.key}`"
            binary
            @update:model-value="toggle(item.key, $event)"
          />
          <label :for="`settings-item-${item.key}`" class="text-sm leading-snug">{{
            item.name
          }}</label>
        </div>
      </section>
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
        :disabled="kind === 'settings' && picked.size === 0"
        @click="exportChosen"
      />
    </template>
  </Dialog>
</template>

<script setup>
/**
 * What Export saves: everything, as a backup, or the writer's settings. For
 * settings, their connections, presets, profiles, servers, skills and app
 * settings are listed with a box each, under a heading per kind, and picking
 * an item picks what it is no use without, such as a preset's connection.
 * See `utils/settingsFile.js`.
 */
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import RadioButton from 'primevue/radiobutton'
import { useBackup } from '@/composables/useBackup'
import { useToast } from '@/composables/useToast'
import { KINDS, SETTINGS_TABLES, pickWithNeeds } from '@/utils/settingsFile.js'

/** @typedef {import('@/utils/settingsFile.js').SettingsItem} SettingsItem */

/**
 * What the writer chose to export.
 *
 * @typedef {{kind: 'backup', includeApiKeys: boolean}
 *   | {kind: 'settings', picked: Set<string>, includeApiKeys: boolean}} ExportChoice
 */

defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits({
  'update:visible': (/** @type {boolean} */ visible) => typeof visible === 'boolean',
  export: (/** @type {ExportChoice} */ choice) =>
    choice.kind === 'backup' || choice.kind === 'settings',
})

const backup = useBackup()
const toast = useToast()

/** @type {import('vue').Ref<'backup'|'settings'>} */
const kind = ref('backup')
const includeApiKeys = ref(false)
/** @type {import('vue').Ref<SettingsItem[]|null>} */
const items = ref(null)
/** @type {import('vue').Ref<Set<string>>} */
const picked = ref(new Set())

/** The settings under their headings, in the order the kinds are listed. */
const groups = computed(() =>
  [...SETTINGS_TABLES, /** @type {const} */ ('settings')]
    .map(kind => ({
      kind,
      heading: KINDS[kind].heading,
      items: (items.value || []).filter(item => item.kind === kind),
    }))
    .filter(group => group.items.length > 0)
)

/** As it opens: everything, without keys, the settings to be read again. */
function reset() {
  kind.value = 'backup'
  includeApiKeys.value = false
  items.value = null
}

// The settings are read the first time they are asked for, each item picked
// or not as it starts.
watch(kind, async chosen => {
  if (chosen !== 'settings' || items.value) return
  try {
    const listed = await backup.listSettings()
    items.value = listed
    picked.value = new Set(listed.filter(item => item.picked).map(item => item.key))
  } catch (error) {
    console.error('The settings could not be read:', error)
    toast.error(`The settings couldn't be read: ${error.message}`)
    kind.value = 'backup'
  }
})

/**
 * @param {string} key
 * @param {boolean} on
 */
function toggle(key, on) {
  if (on) {
    picked.value = pickWithNeeds(picked.value, items.value || [], key)
    return
  }
  const next = new Set(picked.value)
  next.delete(key)
  picked.value = next
}

function exportChosen() {
  emit(
    'export',
    kind.value === 'settings'
      ? { kind: 'settings', picked: new Set(picked.value), includeApiKeys: includeApiKeys.value }
      : { kind: 'backup', includeApiKeys: includeApiKeys.value }
  )
  emit('update:visible', false)
}
</script>
