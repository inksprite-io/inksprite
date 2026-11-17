<template>
  <Dialog
    :visible="visible"
    modal
    header="Import backup"
    :style="{ width: '28rem', maxWidth: '95vw' }"
    @update:visible="emit('update:visible', $event)"
    @show="open"
  >
    <p class="pb-3 text-sm" data-backup-contents>{{ message }}</p>
    <div class="h-[min(16rem,40vh)] overflow-y-auto pb-3" data-addable-tree>
      <Tree
        v-if="nodes.length > 0"
        v-model:selection-keys="keys"
        v-model:expanded-keys="expanded"
        :value="nodes"
        selection-mode="checkbox"
        :pt="{
          root: { class: '!p-0 !bg-transparent' },
          node: { class: '!outline-none' },
          nodeContent: { class: '!py-0.5 !px-1' },
          nodeLabel: { class: 'text-sm leading-snug' },
        }"
      />
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
        label="Add"
        size="small"
        data-action="add"
        :disabled="picked.projects.length === 0 && picked.cards.length === 0 && !picked.settings"
        @click="add"
      />
    </template>
  </Dialog>
</template>

<script setup>
/**
 * A whole backup taken back in: the projects and character cards ticked of
 * it, added beside what is here, and its settings merged into those here
 * (`useBackup().importSelection`). It opens with what isn't here ticked: the
 * projects this device has none of, the cards, and the settings where they
 * only add. A project that is here comes in as a second one when ticked.
 */
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Tree from 'primevue/tree'
import { projectName } from '@/utils/backup.js'
import { changesAnything } from '@/utils/settingsFile.js'
import { compareNames } from '@/utils/compareNames.js'

/** @typedef {import('@/composables/useBackup.js').BackupAddable} BackupAddable */
/** @typedef {import('@/utils/settingsFile.js').SettingsImport} SettingsImport */

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** What the backup holds, said as the dialog opens. */
  message: { type: String, default: '' },
  /** What of it can be added. @type {import('vue').PropType<BackupAddable|null>} */
  addable: { type: Object, default: null },
  /** The ids of its projects that are here already. @type {import('vue').PropType<string[]>} */
  here: { type: Array, default: () => [] },
  /** What its settings would change here. @type {import('vue').PropType<SettingsImport|null>} */
  plan: { type: Object, default: null },
})

const emit = defineEmits({
  'update:visible': (/** @type {boolean} */ visible) => typeof visible === 'boolean',
  add: (/** @type {BackupAddable & {settings: boolean}} */ taken) => Array.isArray(taken?.projects),
})

/** @type {import('vue').Ref<import('primevue/tree').TreeSelectionKeys>} */
const keys = ref({})
/** @type {import('vue').Ref<Record<string, boolean>>} */
const expanded = ref({})

/** Whether the backup's settings would add or change anything here. */
const settingsOffered = computed(() => {
  const plan = /** @type {SettingsImport|null} */ (props.plan)
  return Boolean(plan) && changesAnything(/** @type {SettingsImport} */ (plan))
})

/** As it opens: what isn't here ticked, and the projects and cards in view. */
function open() {
  const addable = /** @type {BackupAddable|null} */ (props.addable)
  const plan = /** @type {SettingsImport|null} */ (props.plan)
  const here = new Set(/** @type {string[]} */ (props.here))
  const ticked = [
    ...(addable?.projects || [])
      .filter(project => !here.has(project.story.id))
      .map(project => `project:${project.story.id}`),
    ...(addable?.cards.rows || []).map(card => `card:${card.id}`),
    ...(settingsOffered.value && plan?.changed.length === 0 ? ['settings'] : []),
  ]
  keys.value = withGroups(Object.fromEntries(ticked.map(key => [key, { checked: true }])))
  expanded.value = { projects: true, cards: true }
}

/**
 * The ticks with each group's own worked out from its children's, as the
 * tree does on a click: ticked with all of them, half with some.
 * @param {import('primevue/tree').TreeSelectionKeys} ticks
 */
function withGroups(ticks) {
  const all = { ...ticks }
  for (const group of nodes.value) {
    const children = group.children ?? []
    const on = children.filter(child => ticks[child.key]?.checked).length
    if (on > 0)
      all[group.key] = { checked: on === children.length, partialChecked: on < children.length }
  }
  return all
}

/** The projects, then the character cards, each by name. */
const nodes = computed(() => {
  const addable = /** @type {BackupAddable|null} */ (props.addable)
  if (!addable) return []
  const projects = addable.projects
    .map(project => ({ key: `project:${project.story.id}`, label: projectName(project) }))
    .sort((a, b) => compareNames(a.label, b.label))
  const cards = addable.cards.rows
    .map(card => ({ key: `card:${card.id}`, label: card.title || card.name || 'Untitled' }))
    .sort((a, b) => compareNames(a.label, b.label))
  /** @type {Array<{key: string, label: string, children?: Array<{key: string, label: string}>}>} */
  const groups = [
    ...(projects.length > 0 ? [{ key: 'projects', label: 'Projects', children: projects }] : []),
    ...(cards.length > 0 ? [{ key: 'cards', label: 'Character cards', children: cards }] : []),
    ...(settingsOffered.value ? [{ key: 'settings', label: 'Settings' }] : []),
  ]
  return groups
})

/** What is ticked, as the backup has it. */
const picked = computed(() => {
  const addable = /** @type {BackupAddable|null} */ (props.addable)
  const on = (/** @type {string} */ key) => Boolean(keys.value[key]?.checked)
  return {
    projects: (addable?.projects || []).filter(project => on(`project:${project.story.id}`)),
    cards: (addable?.cards.rows || []).filter(card => on(`card:${card.id}`)),
    settings: on('settings'),
  }
})

function add() {
  const addable = /** @type {BackupAddable} */ (props.addable)
  emit('add', {
    projects: picked.value.projects,
    cards: { rows: picked.value.cards, files: addable.cards.files },
    settings: picked.value.settings,
  })
  emit('update:visible', false)
}
</script>
