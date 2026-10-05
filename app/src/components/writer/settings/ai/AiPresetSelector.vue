<template>
  <div class="flex flex-col gap-1">
    <label class="text-xs font-medium text-surface-700 dark:text-surface-200">Preset</label>
    <div class="flex gap-1">
      <InputText
        v-if="renaming"
        ref="renameInput"
        v-model="draftName"
        placeholder="Preset name"
        size="small"
        class="flex-1 min-w-0 dark:!bg-surface-900"
        aria-label="Preset name"
        @keyup.enter="commitRename"
        @keyup.escape="renaming = false"
        @blur="commitRename"
      />
      <Select
        v-else
        :model-value="activePresetId"
        :options="presets"
        option-label="name"
        option-value="id"
        placeholder="Select a preset"
        class="flex-1 min-w-0 dark:!bg-surface-900"
        size="small"
        @update:model-value="aiConfig.setActiveAIPreset($event)"
      />
      <Button
        v-tooltip.top="'Preset actions'"
        icon="pi pi-ellipsis-v"
        severity="secondary"
        text
        rounded
        size="small"
        aria-label="Preset actions"
        aria-haspopup="true"
        aria-controls="ai_preset_menu"
        @click="menu?.toggle($event)"
      />
      <Menu id="ai_preset_menu" ref="menu" :model="menuItems" :popup="true" />
    </div>
  </div>
</template>

<script setup>
/**
 * Which AI preset is in use, and the three things you can do to one.
 *
 * A dropdown and a menu rather than a row of buttons: naming a preset is rare
 * enough that a text box standing open for it is a text box in the way, and
 * three icons the writer has to hover to identify are three icons.
 */
import { ref, computed, nextTick } from 'vue'
import Select from 'primevue/select'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Menu from 'primevue/menu'
import { useAIConfig } from '@/composables/useAIConfig'

const aiConfig = useAIConfig()

const presets = computed(() => aiConfig.presets.value)
const activePreset = computed(() => aiConfig.activeAIPreset.value)
const activePresetId = computed(() => activePreset.value?.id || null)

/** @type {import('vue').Ref<any>} */
const menu = ref(null)
/** @type {import('vue').Ref<any>} */
const renameInput = ref(null)
const renaming = ref(false)
const draftName = ref('')

// The default preset is undeletable in the store, and the last one standing
// would leave nothing to switch to.
const canDelete = computed(
  () => !!activePreset.value && !activePreset.value.isDefault && presets.value.length > 1
)

const startRename = async () => {
  draftName.value = activePreset.value?.name || ''
  renaming.value = true
  await nextTick()
  renameInput.value?.$el?.focus?.()
  renameInput.value?.$el?.select?.()
}

/** Blur and Enter both land here, so a name is never committed twice. */
const commitRename = () => {
  if (!renaming.value) return
  renaming.value = false
  const name = draftName.value.trim()
  if (!activePreset.value || !name || name === activePreset.value.name) return
  aiConfig.updatePreset(activePreset.value.id, { name })
}

const menuItems = computed(() => [
  {
    label: 'New preset',
    icon: 'pi pi-plus',
    // A copy of the one in use rather than a blank: the usual reason for a new
    // preset is the same setup pointed at another model.
    command: () => aiConfig.createPreset(`${activePreset.value?.name || 'Preset'} copy`),
  },
  { label: 'Rename preset', icon: 'pi pi-pencil', command: startRename },
  {
    label: 'Delete preset',
    icon: 'pi pi-trash',
    disabled: !canDelete.value,
    command: () => canDelete.value && aiConfig.deletePreset(activePresetId.value),
  },
])
</script>
