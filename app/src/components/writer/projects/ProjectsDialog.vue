<template>
  <!-- Escape is handled here rather than by the dialog, as in the settings. -->
  <Dialog
    ref="dialog"
    :visible="visible"
    header="Projects"
    modal
    :closable="true"
    :close-on-escape="false"
    :draggable="false"
    :dismissable-mask="true"
    class="w-[min(60rem,95vw)] h-[min(44rem,90vh)]"
    :pt="{
      root: { class: 'overflow-hidden' },
      content: { class: 'flex-1 min-h-0 !p-0 overflow-hidden' },
    }"
    data-projects-dialog
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="flex flex-col h-full min-h-0 bg-surface-0 dark:bg-surface-800">
      <div class="p-3 shrink-0">
        <IconField icon-position="left" class="w-full">
          <InputIcon class="pi pi-search text-surface-300 dark:text-surface-600" />
          <InputText
            v-model="query"
            type="text"
            class="rounded-full! w-full dark:!bg-surface-900"
            size="small"
            placeholder="Search projects…"
            aria-label="Search projects"
            autofocus
            data-project-search
            @keydown="onSearchKey"
          />
        </IconField>
      </div>

      <div ref="scroller" class="flex-1 min-h-0 overflow-y-auto">
        <table class="w-full table-fixed border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                v-for="column in COLUMNS"
                :key="column.key"
                scope="col"
                :aria-sort="ariaSort(column.key)"
                class="sticky top-0 z-10 px-3 py-1.5 text-left font-medium text-xs text-surface-600 dark:text-surface-300 border-y border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-900"
                :class="column.class"
              >
                <button
                  type="button"
                  class="flex items-center gap-1 hover:text-surface-900 dark:hover:text-surface-0"
                  :data-sort="column.key"
                  @click="sortBy(column.key)"
                >
                  {{ column.label }}
                  <i
                    v-if="order.by === column.key"
                    class="pi"
                    :class="order.descending ? 'pi-arrow-down' : 'pi-arrow-up'"
                    style="font-size: 0.625rem"
                  />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.id"
              class="cursor-pointer scroll-mt-8 text-surface-700 dark:text-surface-200"
              :class="{ 'bg-surface-200 dark:bg-surface-700': row.id === chosen?.id }"
              :data-project="row.id"
              @click="pick(row, $event)"
              @mousemove="chosenId = row.id"
              @contextmenu="$emit('project-menu', $event, row.id)"
              @touchstart.passive="pressOn($event, row.id)"
              @touchmove.passive="press.touchmove"
              @touchend="press.touchend"
              @touchcancel="press.touchend"
            >
              <td class="px-3 py-2">
                <button
                  type="button"
                  class="flex items-center gap-1.5 w-full min-w-0 text-left"
                  :aria-current="row.open || undefined"
                >
                  <i
                    class="pi pi-fw shrink-0 text-surface-500"
                    :class="row.away ? 'pi-clone' : row.open && 'pi-check'"
                    style="font-size: 0.75rem"
                  />
                  <span class="truncate" :class="{ 'font-semibold': row.open }">{{
                    row.name
                  }}</span>
                  <span v-if="row.away" class="truncate text-xs text-surface-500">
                    Open in another window
                  </span>
                </button>
              </td>
              <td class="px-3 py-2 truncate text-surface-500 dark:text-surface-400">
                {{ row.edited ? formatRelativeTime(row.edited) : '' }}
              </td>
              <td
                class="hidden sm:table-cell px-3 py-2 truncate text-surface-500 dark:text-surface-400"
              >
                {{ dateOf(row.created) }}
              </td>
            </tr>
          </tbody>
        </table>
        <p
          v-if="rows.length === 0"
          class="p-6 text-center text-sm text-surface-500 dark:text-surface-400"
          data-no-projects
        >
          No projects match.
        </p>
      </div>
    </div>
  </Dialog>
</template>

<script setup>
import { computed, nextTick, ref, toRef, watch } from 'vue'
import Dialog from 'primevue/dialog'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'
import { useApplicationState } from '@/composables/useApplicationState'
import { useLongPress } from '@/composables/useLongPress.js'
import { useProjects } from '@/composables/useProjects'
import { useReactiveTime } from '@/composables/useReactiveTime'
import { useTopmostEscape } from '@/composables/useTopmostEscape.js'
import { projectsNamed, sortProjects } from '@/utils/projectList.js'

/**
 * Every project, in a table to search by name and sort: picking one opens it,
 * and with Command or Ctrl held opens it in a new window. The caret stays in
 * the search, where the arrows and Enter pick from the table. The order
 * chosen is kept for next time. Right-clicked or held under a finger, a
 * project asks for its own menu.
 *
 * @typedef {Object} Props
 * @property {boolean} visible
 * @property {string} storyId - The project open
 */
const props = defineProps({
  visible: { type: Boolean, default: false },
  storyId: { type: String, default: '' },
})

const emit = defineEmits(['update:visible', 'project-menu'])

/** @typedef {import('@/utils/projectList.js').ProjectOrder} ProjectOrder */
/** @typedef {import('@/utils/projectList.js').ProjectRow & {open: boolean, away: boolean}} Row */

/** @type {Array<{key: ProjectOrder['by'], label: string, class: string}>} */
const COLUMNS = [
  { key: 'name', label: 'Name', class: '' },
  { key: 'edited', label: 'Last edited', class: 'w-32' },
  { key: 'created', label: 'Created', class: 'hidden sm:table-cell w-32' },
]

/** Where the order chosen is kept, in this copy of the app's settings. */
const ORDER_KEY = 'ui.projectOrder'

const projects = useProjects()
const appState = useApplicationState()
const { formatRelativeTime } = useReactiveTime()

/** @type {import('vue').Ref<{ mask?: HTMLElement }|null>} */
const dialog = ref(null)
/** @type {import('vue').Ref<HTMLElement|null>} */
const scroller = ref(null)
const query = ref('')
/** @type {import('vue').Ref<string|null>} */
const chosenId = ref(null)

/**
 * The order the table is in: as last chosen, or the latest edited first.
 * @type {import('vue').ComputedRef<ProjectOrder>}
 */
const order = computed(() => {
  const kept = appState.getState(ORDER_KEY)
  return COLUMNS.some(column => column.key === kept?.by)
    ? { by: kept.by, descending: Boolean(kept.descending) }
    : { by: 'edited', descending: true }
})

/** @type {import('vue').ComputedRef<Row[]>} */
const rows = computed(() =>
  sortProjects(projectsNamed(projects.rows.value, query.value), order.value).map(row => ({
    ...row,
    open: row.id === props.storyId,
    away: projects.elsewhere.value.has(row.id),
  }))
)

/** The project a finger went down on. */
let pressedOn = ''

const press = useLongPress(({ x, y }) =>
  emit(
    'project-menu',
    {
      pageX: x + window.scrollX,
      pageY: y + window.scrollY,
      stopPropagation() {},
      preventDefault() {},
    },
    pressedOn
  )
)

/**
 * @param {TouchEvent} event
 * @param {string} storyId
 */
const pressOn = (event, storyId) => {
  pressedOn = storyId
  press.touchstart(event)
}

/**
 * The row Enter opens: the one arrowed or pointed to, or else the first that
 * is not open already, the likeliest to be wanted.
 */
const chosen = computed(
  () =>
    rows.value.find(row => row.id === chosenId.value) ??
    rows.value.find(row => !row.open) ??
    rows.value[0]
)

watch([query, order], () => {
  chosenId.value = null
})

// Opened, it starts over, and reads again what other windows may have changed.
watch(
  () => props.visible,
  visible => {
    if (!visible) return
    query.value = ''
    chosenId.value = null
    projects.lookElsewhere()
    projects.refresh()
  }
)

useTopmostEscape(
  toRef(props, 'visible'),
  () => dialog.value?.mask,
  () => emit('update:visible', false)
)

/**
 * @param {ProjectOrder['by']} by
 * @returns {'ascending'|'descending'|undefined}
 */
const ariaSort = by => {
  if (order.value.by !== by) return undefined
  return order.value.descending ? 'descending' : 'ascending'
}

/**
 * Sort by a column, or the other way by the one it is sorted by. Names start
 * from A, and times from the latest.
 * @param {ProjectOrder['by']} by
 */
const sortBy = by => {
  const descending = order.value.by === by ? !order.value.descending : by !== 'name'
  appState.setState(ORDER_KEY, { by, descending })
}

/**
 * @param {number} [time]
 * @returns {string}
 */
const dateOf = time =>
  time
    ? new Date(time).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : ''

/**
 * @param {Row} row
 * @param {Event} event
 */
const pick = (row, event) => {
  emit('update:visible', false)
  if (!row.open) projects.pick(row.id, event)
}

/**
 * Arrow to the next or the last row, keeping it in sight.
 * @param {1|-1} by
 */
const move = by => {
  if (!chosen.value) return
  const at = rows.value.indexOf(chosen.value) + by
  const next = rows.value[Math.max(0, Math.min(at, rows.value.length - 1))]
  chosenId.value = next.id
  nextTick(() =>
    scroller.value?.querySelector(`[data-project="${next.id}"]`)?.scrollIntoView({
      block: 'nearest',
    })
  )
}

/** Put the caret back in the search, where the keys work. */
const focusSearch = () =>
  /** @type {HTMLElement|null|undefined} */ (
    dialog.value?.mask?.querySelector('[data-project-search]')
  )?.focus()

defineExpose({ focusSearch })

/** @param {KeyboardEvent} event */
const onSearchKey = event => {
  if (event.isComposing) return
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    move(event.key === 'ArrowDown' ? 1 : -1)
  } else if (event.key === 'Enter' && chosen.value) {
    event.preventDefault()
    pick(chosen.value, event)
  }
}
</script>
