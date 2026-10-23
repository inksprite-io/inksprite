<template>
  <Dialog
    :visible="visible"
    modal
    header="Trash"
    :style="{ width: '30rem', maxWidth: '95vw' }"
    data-trash-dialog
    @update:visible="emit('update:visible', $event)"
  >
    <div class="h-80 overflow-y-auto flex flex-col gap-3">
      <ul v-if="trash.items.value.length > 0" aria-label="In this project" data-trash-items>
        <li
          v-for="item in trash.items.value"
          :key="item.id"
          class="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800"
          :data-trash-item="item.id"
        >
          <i :class="item.icon" class="flex-none text-surface-500" style="font-size: 0.875rem" />
          <span class="min-w-0 flex-1 flex flex-col">
            <span class="truncate">{{ item.title }}</span>
            <span class="truncate text-xs text-surface-500 dark:text-surface-400">
              {{ detailOf(item) }}
            </span>
          </span>
          <button
            v-tooltip.bottom="'Restore'"
            type="button"
            class="flex-none w-7 h-7 rounded flex items-center justify-center text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-surface-0"
            :aria-label="`Restore ${item.title}`"
            data-action="restore"
            @click="restore(item)"
          >
            <i class="pi pi-replay" style="font-size: 0.75rem" />
          </button>
          <button
            v-tooltip.bottom="'Delete now'"
            type="button"
            class="flex-none w-7 h-7 rounded flex items-center justify-center text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-surface-0"
            :aria-label="`Delete ${item.title} now`"
            data-action="delete-now"
            @click="confirmDelete(item)"
          >
            <i class="pi pi-times" style="font-size: 0.75rem" />
          </button>
        </li>
      </ul>

      <section v-if="trash.trashedProjects.value.length > 0" data-trash-projects>
        <h3
          v-if="trash.items.value.length > 0"
          class="px-2 pb-1 text-xs font-medium text-surface-500 dark:text-surface-400"
        >
          Projects
        </h3>
        <ul aria-label="Projects">
          <li
            v-for="project in trash.trashedProjects.value"
            :key="project.id"
            class="flex items-center gap-2 rounded px-2 py-1.5 text-sm text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800"
            :data-trash-project="project.id"
          >
            <i class="pi pi-book flex-none text-surface-500" style="font-size: 0.875rem" />
            <span class="min-w-0 flex-1 flex flex-col">
              <span class="truncate">{{ project.title }}</span>
              <span class="text-xs text-surface-500 dark:text-surface-400">
                {{ formatRelativeTime(project.trashed) }}
              </span>
            </span>
            <button
              v-tooltip.bottom="'Restore'"
              type="button"
              class="flex-none w-7 h-7 rounded flex items-center justify-center text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-surface-0"
              :aria-label="`Restore ${project.title}`"
              data-action="restore"
              @click="restoreProject(project)"
            >
              <i class="pi pi-replay" style="font-size: 0.75rem" />
            </button>
            <button
              v-tooltip.bottom="'Delete now'"
              type="button"
              class="flex-none w-7 h-7 rounded flex items-center justify-center text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-surface-0"
              :aria-label="`Delete ${project.title} now`"
              data-action="delete-now"
              @click="confirmDeleteProject(project)"
            >
              <i class="pi pi-times" style="font-size: 0.75rem" />
            </button>
          </li>
        </ul>
      </section>

      <p
        v-if="trash.count.value === 0"
        class="m-auto text-sm text-surface-500 dark:text-surface-400"
        data-trash-empty
      >
        The trash is empty.
      </p>
    </div>

    <template #footer>
      <div class="w-full flex items-center justify-between gap-2">
        <span class="text-xs text-surface-500 dark:text-surface-400">Kept for 30 days.</span>
        <Button
          label="Empty trash"
          severity="danger"
          text
          size="small"
          :disabled="trash.count.value === 0"
          data-action="empty-trash"
          @click="confirmEmpty"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import { useConfirm } from 'primevue/useconfirm'
import { useTrash } from '@/composables/useTrash.js'
import { useReactiveTime } from '@/composables/useReactiveTime'
import { useToast } from '@/composables/useToast'

/**
 * The trash: what the open project's trash holds of its documents and chats,
 * and the projects in the trash. Each comes back with Restore, or goes for
 * good with Delete now, which asks first, as Empty trash does.
 *
 * @typedef {import('@/composables/useTrash.js').TrashItem} TrashItem
 * @typedef {import('@/composables/useTrash.js').TrashedProject} TrashedProject
 *
 * @typedef {Object} Props
 * @property {boolean} visible
 * @property {string|null} [storyId] - The project open; none shows the projects alone
 */
const props = defineProps({
  visible: { type: Boolean, default: false },
  storyId: { type: String, default: null },
})

const emit = defineEmits(['update:visible'])

const trash = useTrash(props.storyId)
const confirm = useConfirm()
const toast = useToast()
const { formatRelativeTime } = useReactiveTime()

/**
 * Where something was, what went with it, and when.
 * @param {TrashItem} item
 * @returns {string}
 */
const detailOf = item =>
  [
    item.kind === 'chat' ? 'Chat' : item.where,
    item.inside === 1 ? '1 inside' : item.inside > 1 ? `${item.inside} inside` : '',
    formatRelativeTime(item.trashed),
  ]
    .filter(Boolean)
    .join(' · ')

/**
 * Run something the trash does, and say so if it fails.
 * @param {() => Promise<void>} work
 */
const attempt = async work => {
  try {
    await work()
  } catch (error) {
    console.error('The trash could not do that:', error)
    toast.error(error.message)
  }
}

/** @param {TrashItem} item */
const restore = item => attempt(() => trash.restore(item))

/** @param {TrashedProject} project */
const restoreProject = project => attempt(() => trash.restoreProject(project.id))

/**
 * @param {string} message
 * @param {() => Promise<void>} accept
 */
const ask = (message, accept) =>
  confirm.require({
    header: 'Delete for good',
    message,
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: () => attempt(accept),
  })

/** @param {TrashItem} item */
const confirmDelete = item =>
  ask(`Delete "${item.title}" for good? This can’t be undone.`, () => trash.deleteNow(item))

/** @param {TrashedProject} project */
const confirmDeleteProject = project =>
  ask(`Delete "${project.title}" and everything in it for good? This can’t be undone.`, () =>
    trash.deleteProject(project.id)
  )

const confirmEmpty = () =>
  ask('Delete everything in the trash for good? This can’t be undone.', () => trash.empty())
</script>
