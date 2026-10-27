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
    <p class="border-t border-surface-200 pt-3 text-sm dark:border-surface-700">
      Replace deletes everything in inksprite now.
    </p>
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
        severity="secondary"
        data-action="add"
        :disabled="picked.projects.length === 0 && picked.cards.length === 0"
        @click="add"
      />
      <Button
        label="Replace"
        size="small"
        severity="danger"
        data-action="replace"
        @click="replace"
      />
    </template>
  </Dialog>
</template>

<script setup>
/**
 * A whole backup taken back in: in place of everything here, or only the
 * projects and character cards ticked of it, added beside what is here
 * (`useBackup().addFromBackup`). Nothing is ticked as it opens, since adding
 * is the lesser of the two and the writer picks what they came for.
 */
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Tree from 'primevue/tree'
import { projectName } from '@/utils/backup.js'
import { compareNames } from '@/utils/compareNames.js'

/** @typedef {import('@/composables/useBackup.js').BackupAddable} BackupAddable */

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** What the backup holds, said as the dialog opens. */
  message: { type: String, default: '' },
  /** What of it can be added. @type {import('vue').PropType<BackupAddable|null>} */
  addable: { type: Object, default: null },
})

const emit = defineEmits({
  'update:visible': (/** @type {boolean} */ visible) => typeof visible === 'boolean',
  replace: () => true,
  add: (/** @type {BackupAddable} */ taken) => Array.isArray(taken?.projects),
})

/** @type {import('vue').Ref<import('primevue/tree').TreeSelectionKeys>} */
const keys = ref({})
/** @type {import('vue').Ref<Record<string, boolean>>} */
const expanded = ref({})

/** As it opens: nothing ticked, and the projects and cards in view. */
function open() {
  keys.value = {}
  expanded.value = { projects: true, cards: true }
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
  return [
    ...(projects.length > 0 ? [{ key: 'projects', label: 'Projects', children: projects }] : []),
    ...(cards.length > 0 ? [{ key: 'cards', label: 'Character cards', children: cards }] : []),
  ]
})

/** What is ticked, as the backup has it. */
const picked = computed(() => {
  const addable = /** @type {BackupAddable|null} */ (props.addable)
  const on = (/** @type {string} */ key) => Boolean(keys.value[key]?.checked)
  return {
    projects: (addable?.projects || []).filter(project => on(`project:${project.story.id}`)),
    cards: (addable?.cards.rows || []).filter(card => on(`card:${card.id}`)),
  }
})

function add() {
  const addable = /** @type {BackupAddable} */ (props.addable)
  emit('add', {
    projects: picked.value.projects,
    cards: { rows: picked.value.cards, files: addable.cards.files },
  })
  emit('update:visible', false)
}

function replace() {
  emit('replace')
  emit('update:visible', false)
}
</script>
