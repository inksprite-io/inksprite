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
                v-for="column in columns"
                :key="column.key"
                scope="col"
                :aria-sort="ariaSort(column.key)"
                class="sticky top-0 z-10 px-3 py-1.5 text-left font-medium text-xs text-surface-600 dark:text-surface-300 border-y border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-900"
                :class="column.class"
                :data-column="column.key"
              >
                <span v-if="!column.sorts">{{ column.label }}</span>
                <button
                  v-else
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
            <!-- The invitations waiting, first, to answer rather than open. -->
            <tr
              v-for="invitation in invitations"
              :key="invitation.collection"
              class="text-surface-400 dark:text-surface-500"
              :data-invitation="invitation.collection"
              @contextmenu.prevent="showInvitationMenu($event, invitation)"
              @touchstart.passive="pressOnInvitation($event, invitation)"
              @touchmove.passive="invitationPress.touchmove"
              @touchend="invitationPress.touchend"
              @touchcancel="invitationPress.touchend"
            >
              <td class="px-3 py-1">
                <span class="flex items-center gap-1.5 w-full min-w-0">
                  <i class="pi pi-fw pi-inbox shrink-0" style="font-size: 0.75rem" />
                  <span class="truncate flex-1 min-w-0">{{ invitation.title || 'A project' }}</span>
                  <button
                    v-tooltip.bottom="'Accept'"
                    type="button"
                    :class="ICON_BUTTON"
                    aria-label="Accept"
                    data-action="accept-invitation"
                    @click="answer(() => cloud.accept(invitation.collection), ACCEPT_FAILED)"
                  >
                    <i class="pi pi-check" style="font-size: 0.7rem" />
                  </button>
                  <button
                    v-tooltip.bottom="'Reject'"
                    type="button"
                    :class="ICON_BUTTON"
                    aria-label="Reject"
                    data-action="reject-invitation"
                    @click="answer(() => cloud.reject(invitation.collection), REJECT_FAILED)"
                  >
                    <i class="pi pi-times" style="font-size: 0.7rem" />
                  </button>
                </span>
              </td>
              <td class="px-3 py-1 truncate" data-owner>{{ invitation.from.name }}</td>
              <td class="hidden sm:table-cell" />
              <td />
              <td class="hidden sm:table-cell" />
            </tr>
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
              <td
                v-if="showsSharing"
                class="px-3 py-2 truncate text-surface-500 dark:text-surface-400"
                data-owner
              >
                {{ row.owner }}
              </td>
              <td
                v-if="showsSharing"
                class="hidden sm:table-cell px-3 py-2 truncate text-surface-500 dark:text-surface-400"
                data-people
              >
                {{ row.people }}
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
          v-if="rows.length === 0 && invitations.length === 0"
          class="p-6 text-center text-sm text-surface-500 dark:text-surface-400"
          data-no-projects
        >
          No projects match.
        </p>
      </div>
    </div>
    <ContextMenu ref="invitationMenu" :model="invitationItems" />
  </Dialog>
</template>

<script setup>
import { computed, nextTick, ref, toRef, watch } from 'vue'
import ContextMenu from 'primevue/contextmenu'
import Dialog from 'primevue/dialog'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'
import { me, sharing } from '@/cloud/people.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { useBlocking } from '@/composables/useBlocking.js'
import { useCloudSync } from '@/composables/useCloudSync.js'
import { useLongPress } from '@/composables/useLongPress.js'
import { useProjects } from '@/composables/useProjects'
import { useReactiveTime } from '@/composables/useReactiveTime'
import { useToast } from '@/composables/useToast.js'
import { useTopmostEscape } from '@/composables/useTopmostEscape.js'
import { projectsNamed, sortProjects } from '@/utils/projectList.js'

/**
 * Every project, in a table to search by name and sort: picking one opens it,
 * and with Command or Ctrl held opens it in a new window. The caret stays in
 * the search, where the arrows and Enter pick from the table. The order
 * chosen is kept for next time. Right-clicked or held under a finger, a
 * project asks for its own menu. Once any project is shared, each says whose
 * it is and who else is in it; and the invitations waiting come first,
 * greyed, each accepted or rejected on its row, or blocked from its menu.
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
/** @typedef {import('@/utils/projectList.js').ProjectRow & {open: boolean, away: boolean, owner: string, people: string}} Row */
/** @typedef {import('@/cloud/engine.js').Invitation} Invitation */

/**
 * A column: one sorted by is a project list's order; the others aren't sorted by.
 * @typedef {{key: ProjectOrder['by'], label: string, class: string, sorts: true}|{key: string, label: string, class: string, sorts: false}} Column
 */

/** @type {Array<Column & {sorts: true}>} */
const COLUMNS = [
  { key: 'name', label: 'Name', class: '', sorts: true },
  { key: 'edited', label: 'Last edited', class: 'w-32', sorts: true },
  { key: 'created', label: 'Created', class: 'hidden sm:table-cell w-32', sorts: true },
]

/** Whose a project is, and who else is in it: once anything is shared. @type {Column[]} */
const SHARED_COLUMNS = [
  { key: 'owner', label: 'Owner', class: 'w-28', sorts: false },
  { key: 'people', label: 'People', class: 'hidden sm:table-cell w-40', sorts: false },
]

const ICON_BUTTON =
  'flex-none w-6 h-6 rounded flex items-center justify-center text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-surface-0'

const ACCEPT_FAILED = "The project couldn't be accepted."
const REJECT_FAILED = "The project couldn't be rejected."

/** Where the order chosen is kept, in this copy of the app's settings. */
const ORDER_KEY = 'ui.projectOrder'

const projects = useProjects()
const appState = useApplicationState()
const cloud = useCloudSync()
const toast = useToast()
const { block } = useBlocking()
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

/** Whether the table says whose each project is: once anything is shared, or offered. */
const showsSharing = computed(
  () => Object.keys(sharing.value.projects).length > 0 || sharing.value.invitations.length > 0
)

/** @type {import('vue').ComputedRef<Column[]>} */
const columns = computed(() =>
  showsSharing.value ? [COLUMNS[0], ...SHARED_COLUMNS, ...COLUMNS.slice(1)] : COLUMNS
)

/**
 * Names, as a sentence's list.
 * @param {string[]} names
 */
const listOf = names =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`

/**
 * Whose a project is, and who else is in it, apart from this account and
 * those only invited.
 * @param {string} storyId
 * @returns {{owner: string, people: string}}
 */
function sharedOf(storyId) {
  const shared = sharing.value.projects[storyId]
  const self = me.value ?? sharing.value.me
  const owner = shared?.members.find(member => member.owner)
  const others = (shared?.members ?? []).filter(
    member => !member.owner && !member.invited && member.account !== self
  )
  return {
    owner: !shared || shared.role === 'owner' ? 'You' : owner?.display || 'Someone',
    people: listOf(others.map(member => member.display || 'Someone')),
  }
}

/** @type {import('vue').ComputedRef<Row[]>} */
const rows = computed(() =>
  sortProjects(projectsNamed(projects.rows.value, query.value), order.value).map(row => ({
    ...row,
    ...sharedOf(row.id),
    open: row.id === props.storyId,
    away: projects.elsewhere.value.has(row.id),
  }))
)

/** The invitations waiting, the oldest first, as the search finds them. */
const invitations = computed(() => {
  const words = query.value.trim().toLowerCase()
  return sharing.value.invitations.filter(invitation =>
    (invitation.title || 'A project').toLowerCase().includes(words)
  )
})

/**
 * Answer an invitation, saying so if it couldn't be.
 * @param {() => Promise<void>} work
 * @param {string} failed - What didn't happen
 */
async function answer(work, failed) {
  try {
    await work()
  } catch (error) {
    toast.error(`${failed} ${/** @type {Error} */ (error).message}`)
  }
}

const invitationMenu = ref()
/** @type {import('vue').Ref<Array<Object>>} */
const invitationItems = ref([])

/**
 * An invitation's menu: its answers, and blocking whoever sent it.
 * @param {Event} event
 * @param {Invitation} invitation
 */
function showInvitationMenu(event, invitation) {
  const { collection, from } = invitation
  invitationItems.value = [
    {
      label: 'Accept',
      icon: 'pi pi-check',
      command: () => answer(() => cloud.accept(collection), ACCEPT_FAILED),
    },
    {
      label: 'Reject',
      icon: 'pi pi-times',
      command: () => answer(() => cloud.reject(collection), REJECT_FAILED),
    },
    {
      label: 'Block',
      icon: 'pi pi-ban',
      command: () => answer(() => block(from), `${from.name} couldn't be blocked.`),
    },
  ]
  invitationMenu.value?.show(event)
}

/** The invitation a finger went down on. @type {Invitation|null} */
let pressedInvitation = null

const invitationPress = useLongPress(({ x, y }) => {
  if (!pressedInvitation) return
  showInvitationMenu(
    /** @type {any} */ ({
      pageX: x + window.scrollX,
      pageY: y + window.scrollY,
      stopPropagation() {},
      preventDefault() {},
    }),
    pressedInvitation
  )
})

/**
 * @param {TouchEvent} event
 * @param {Invitation} invitation
 */
const pressOnInvitation = (event, invitation) => {
  pressedInvitation = invitation
  invitationPress.touchstart(event)
}

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
 * @param {string} by
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
