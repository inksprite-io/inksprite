<template>
  <div ref="root" class="flex flex-col gap-2" data-connected-apps>
    <Teleport defer :to="heading" :disabled="!heading">
      <HeaderButton icon="pi pi-plus" label="Add an app" data-action="add-app" @click="add" />
    </Teleport>

    <!-- The server every app comes in by: whether it runs, and where an app
         reaches it while it does. -->
    <CardList v-if="state" data-apps-server>
      <div class="flex items-center gap-2 pl-3 pr-1.5 min-h-10 text-sm">
        <span class="flex-1 min-w-0 truncate" data-apps-status>
          <span class="text-surface-500 dark:text-surface-400">Status: </span>
          <span
            :class="
              state.problem
                ? 'text-red-600 dark:text-red-400'
                : 'text-surface-800 dark:text-surface-100'
            "
            >{{ status }}</span
          >
        </span>
        <ToggleSwitch
          :key="redrawn"
          :model-value="enabled"
          :dt="SMALL_SWITCH"
          class="flex-none"
          aria-label="MCP server"
          data-apps-enabled
          @update:model-value="switchServer"
        />
        <HeaderButton
          icon="pi pi-cog"
          label="Port"
          aria-haspopup="true"
          data-action="apps-port"
          @click="portPanel?.toggle($event)"
        />
      </div>
      <div
        v-if="reachable"
        class="flex items-center gap-2 pl-3 pr-1.5 min-h-10 text-sm border-t border-surface-200 dark:border-surface-700"
        data-apps-address
      >
        <span class="flex-1 min-w-0 truncate">
          <span class="text-surface-500 dark:text-surface-400">Reachable at </span>
          <code class="text-xs text-surface-900 dark:text-surface-0 select-all">{{ address }}</code>
        </span>
        <button
          v-tooltip.bottom="copied === ADDRESS ? 'Copied' : 'Copy'"
          type="button"
          class="flex-none w-7 h-7 rounded flex items-center justify-center text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-surface-0"
          aria-label="Copy address"
          data-action="copy-address"
          @click="copyText(ADDRESS, address)"
        >
          <i :class="copied === ADDRESS ? 'pi pi-check' : 'pi pi-copy'" style="font-size: 0.7rem" />
        </button>
      </div>
    </CardList>

    <!-- The port, behind the cog on the server's card. -->
    <Popover ref="portPanel" data-apps-port @show="alignPortPanel">
      <div class="flex items-center justify-between gap-3 text-sm">
        <label
          :for="`${id}-port`"
          class="text-xs font-medium text-surface-700 dark:text-surface-200"
          >Port</label
        >
        <InputText
          :id="`${id}-port`"
          v-model="portDraft"
          size="small"
          class="w-24 dark:!bg-surface-900"
          inputmode="numeric"
          :disabled="!enabled"
          data-field="apps-port"
          @blur="savePort"
          @keydown.enter="savePort"
          @keydown.esc="showPort"
        />
      </div>
    </Popover>

    <CardList v-if="connections.length > 0" data-list="apps">
      <CardItem
        v-for="one in connections"
        :key="one.id"
        :title="one.name"
        :subtitle="projectsLine(one)"
        :open="open === one.id"
        :data-app="one.id"
        @toggle="toggle(one)"
      >
        <template v-if="state?.called[one.id]" #meta>
          {{ formatRelativeTime(state.called[one.id]) }}
        </template>

        <label class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300">
          Name
          <InputText
            v-model="nameDrafts[one.id]"
            size="small"
            data-field="app-rename"
            @blur="saveName(one)"
            @keydown.enter="saveName(one)"
          />
        </label>

        <div v-if="projects.rows.value.length > 0" class="flex flex-col gap-1" data-app-projects>
          <span class="text-xs font-medium text-surface-700 dark:text-surface-200">Projects</span>
          <IconField icon-position="left" class="w-full">
            <InputIcon class="pi pi-search text-surface-300 dark:text-surface-600" />
            <InputText
              v-model="projectQuery"
              type="text"
              class="rounded-full! w-full dark:!bg-surface-900"
              size="small"
              placeholder="Search projects…"
              aria-label="Search projects"
              data-field="app-project-search"
            />
          </IconField>
          <div class="flex flex-col gap-1 max-h-48 overflow-y-auto pt-1">
            <label
              v-for="project in projectsShown"
              :key="project.id"
              class="flex items-center gap-2 text-sm cursor-pointer"
              :data-app-project="project.id"
            >
              <Checkbox
                :key="redrawn"
                :model-value="one.projects.includes(project.id)"
                binary
                size="small"
                @update:model-value="ticked => tick(one, project.id, ticked)"
              />
              <span class="truncate">{{ project.name }}</span>
            </label>
          </div>
        </div>

        <div class="flex items-center justify-between gap-2">
          <label
            :for="`${id}-read-only-${one.id}`"
            class="text-xs font-medium text-surface-700 dark:text-surface-200"
            >Read only</label
          >
          <ToggleSwitch
            :key="redrawn"
            :model-value="one.readOnly"
            :input-id="`${id}-read-only-${one.id}`"
            class="flex-none"
            data-app-read-only
            @update:model-value="readOnly => switchReadOnly(one, readOnly)"
          />
        </div>

        <!-- What the app is set up with: the command for Claude Code, and the
             address and token on their own for any other. -->
        <div class="flex flex-col gap-1" data-app-setup>
          <div
            v-for="row in setupOf(one)"
            :key="row.id"
            class="flex items-center gap-2"
            :data-setup="row.id"
          >
            <span class="flex-none w-24 text-xs font-medium text-surface-700 dark:text-surface-200">
              {{ row.label }}
            </span>
            <code
              class="flex-1 min-w-0 truncate text-xs text-surface-900 dark:text-surface-0"
              :class="{ 'select-all': row.shown === row.text }"
              >{{ row.shown }}</code
            >
            <button
              v-tooltip.bottom="copied === `${one.id}:${row.id}` ? 'Copied' : 'Copy'"
              type="button"
              class="flex-none w-6 h-6 rounded flex items-center justify-center text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-surface-0"
              :aria-label="`Copy ${row.label}`"
              data-action="copy-setup"
              @click="copy(one, row)"
            >
              <i
                :class="copied === `${one.id}:${row.id}` ? 'pi pi-check' : 'pi pi-copy'"
                style="font-size: 0.7rem"
              />
            </button>
          </div>
        </div>

        <div class="flex gap-2">
          <Button label="Done" size="small" data-action="done" @click="open = null" />
          <Button
            label="Remove"
            size="small"
            severity="danger"
            text
            data-action="remove"
            @click="remove(one)"
          />
        </div>
      </CardItem>
    </CardList>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, useId, watch } from 'vue'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'
import Popover from 'primevue/popover'
import ToggleSwitch from 'primevue/toggleswitch'
import CardList from '@/components/common/CardList.vue'
import CardItem from '@/components/common/CardItem.vue'
import HeaderButton from '../layout/HeaderButton.vue'
import { useSectionHeading } from '@/components/common/sectionHeading.js'
import {
  appAddress,
  claudeCodeCommand,
  nextAppName,
  useConnectedApps,
} from '@/composables/useConnectedApps.js'
import { useProjects } from '@/composables/useProjects.js'
import { useToast } from '@/composables/useToast'
import { formatRelativeTime } from '@/utils/formatters.js'
import { projectsNamed } from '@/utils/projectList.js'

/** @typedef {import('@/platform/apps.js').AppConnection} AppConnection */

/**
 * Settings → Connections → Connected apps, in the desktop app: the other
 * apps on this computer the writer has let into their projects, a coding
 * agent first. A card for each, with its name, the projects ticked for it,
 * whether it only reads them, what to set the app up with, and when it last
 * asked anything. An app is let in only to the projects ticked, and none is
 * to start with. Adding one makes it, under a name to change, and opens its
 * card, whole: its token is what the app is set up with.
 *
 * The server they all come in by has a card of its own above theirs:
 * whether it runs, with its switch, its port behind a cog, and under those,
 * while it runs, the address an app reaches it at. See
 * composables/useConnectedApps.js and `.llm/mcp_server_design.md`.
 */

const id = useId()
const heading = useSectionHeading()
const toast = useToast()
const projects = useProjects()
const {
  state,
  load,
  add: addApp,
  rename,
  setProject,
  setReadOnly,
  remove: removeApp,
  setPort,
  setEnabled,
} = useConnectedApps()

const root = ref(/** @type {HTMLElement|null} */ (null))
const connections = computed(() => state.value?.connections ?? [])

/** The connection whose card is open, if one's is. */
const open = ref(/** @type {string|null} */ (null))

/**
 * Counted up when a switch's or a tick's change couldn't be made. A control
 * keeps what was clicked until it is drawn again, and would go on showing a
 * change that was never made.
 */
const redrawn = ref(0)

/** Whether an app is being added, so that a second click adds no second. */
let adding = false

/** Each connection's name as it is being typed. */
const nameDrafts = reactive(/** @type {Record<string, string>} */ ({}))

watch(
  connections,
  all => {
    for (const one of all) nameDrafts[one.id] = one.name
  },
  { immediate: true }
)

onMounted(async () => {
  try {
    await Promise.all([load(), projects.init()])
  } catch (error) {
    console.error('Failed to read the connected apps:', error)
    toast.error("The connected apps couldn't be read.")
  }
})

// The projects of the card that is open, as searched: one card is open at a
// time, and its search starts empty.
const projectQuery = ref('')
const projectsShown = computed(() => projectsNamed(projects.rows.value, projectQuery.value))
watch(open, () => {
  projectQuery.value = ''
})

/** @param {AppConnection} one */
const toggle = one => {
  open.value = open.value === one.id ? null : one.id
}

/**
 * The line under a connection's name: the projects it is let into, by name,
 * and that it only reads them, where it does.
 * @param {AppConnection} one
 */
const projectsLine = one => {
  const names = projects.rows.value
    .filter(project => one.projects.includes(project.id))
    .map(project => project.name)
  const line = names.length > 0 ? names.join(', ') : 'No projects'
  return one.readOnly ? `${line} · Read only` : line
}

/**
 * Make a connection, and open its card on its name, selected to be typed
 * over: the projects and what to set the app up with are below it.
 */
const add = async () => {
  if (adding) return
  adding = true
  try {
    const made = await addApp(nextAppName(connections.value))
    open.value = made.id
    await nextTick()
    const field = /** @type {HTMLInputElement|null} */ (
      root.value?.querySelector(`[data-app="${made.id}"] [data-field="app-rename"]`) ?? null
    )
    field?.focus()
    field?.select()
  } catch (error) {
    console.error('Failed to add a connected app:', error)
    toast.error("The app couldn't be added.")
  } finally {
    adding = false
  }
}

/** @param {AppConnection} one */
const saveName = async one => {
  try {
    await rename(one.id, nameDrafts[one.id] || '')
  } catch (error) {
    console.error('Failed to rename a connected app:', error)
  }
  nameDrafts[one.id] = connections.value.find(other => other.id === one.id)?.name ?? one.name
}

/**
 * @param {AppConnection} one
 * @param {string} storyId
 * @param {boolean} ticked
 */
const tick = async (one, storyId, ticked) => {
  try {
    await setProject(one.id, storyId, ticked)
  } catch (error) {
    console.error('Failed to change a connected app’s projects:', error)
    toast.error("The app's projects couldn't be changed.")
    redrawn.value++
  }
}

/**
 * @param {AppConnection} one
 * @param {boolean} readOnly
 */
const switchReadOnly = async (one, readOnly) => {
  try {
    await setReadOnly(one.id, readOnly)
  } catch (error) {
    console.error('Failed to change what a connected app may do:', error)
    toast.error("Read only couldn't be changed.")
    redrawn.value++
  }
}

/** @param {AppConnection} one */
const remove = async one => {
  try {
    await removeApp(one.id)
    if (open.value === one.id) open.value = null
  } catch (error) {
    console.error('Failed to remove a connected app:', error)
    toast.error("The app couldn't be removed.")
  }
}

/**
 * What an app is set up with, a row each: what is copied, and what is shown
 * of it, the token shown only in part.
 *
 * @param {AppConnection} one
 * @returns {Array<{id: string, label: string, text: string, shown: string}>}
 */
const setupOf = one => {
  const port = state.value?.port ?? 0
  const hidden = `${one.token.slice(0, 4)}…`
  return [
    {
      id: 'claude-code',
      label: 'Claude Code',
      text: claudeCodeCommand(port, one.token),
      shown: claudeCodeCommand(port, hidden),
    },
    { id: 'address', label: 'Address', text: appAddress(port), shown: appAddress(port) },
    { id: 'token', label: 'Token', text: one.token, shown: hidden },
  ]
}

/** The row just copied, for its button to say so. */
const copied = ref(/** @type {string|null} */ (null))

/**
 * Copy something, and mark its button as having copied for a moment.
 *
 * @param {string} key - What marks the button: a card's row, or the address
 * @param {string} text
 */
const copyText = async (key, text) => {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => {
      if (copied.value === key) copied.value = null
    }, 1500)
  } catch {
    toast.error("That couldn't be copied.")
  }
}

/**
 * @param {AppConnection} one
 * @param {{id: string, label: string, text: string}} row
 */
const copy = (one, row) => copyText(`${one.id}:${row.id}`, row.text)

// The server every app comes in by, on a card of its own above theirs.

/** What marks the address's copy button as having copied. */
const ADDRESS = 'address'

/**
 * The switch at the size of the line it is on: the default is half again
 * as tall as the text beside it.
 */
const SMALL_SWITCH = { width: '1.75rem', height: '1rem', handle: { size: '0.75rem' } }

const portPanel = ref(/** @type {any} */ (null))

/**
 * Have the port's popup open under the cog with their right edges in line.
 * A popup opens to the right of what opened it, and the cog is at the
 * card's right edge: it would hang out of the settings.
 */
const alignPortPanel = () => {
  const panel = /** @type {HTMLElement|null} */ (document.querySelector('[data-apps-port]'))
  const cog = document.querySelector('[data-action="apps-port"]')
  if (!panel || !cog) return
  const over = panel.getBoundingClientRect().right - cog.getBoundingClientRect().right
  if (over <= 0) return
  panel.style.left = `${panel.offsetLeft - over}px`
  // Its arrow stays under the cog: PrimeVue places it by this.
  panel.style.setProperty('--p-popover-arrow-left', `${over}px`)
}

/** Whether apps are let in at all: they are, until the writer says not. */
const enabled = computed(() => state.value?.enabled !== false)

/**
 * What the server is doing, in a word, or what keeps it from its port. It
 * runs while it is switched on: with no app yet there is nobody to reach it,
 * and it listens from the first one.
 */
const status = computed(() => state.value?.problem || (enabled.value ? 'Running' : 'Stopped'))

/** Where an app reaches the server. */
const address = computed(() => appAddress(state.value?.port ?? 0))

/** Whether there is an address to give out: the server is on, and has its port. */
const reachable = computed(() => enabled.value && !state.value?.problem)

/** @param {boolean} on */
const switchServer = async on => {
  try {
    await setEnabled(on)
  } catch (error) {
    console.error('Failed to turn the MCP server on or off:', error)
    toast.error(`The MCP server couldn't be turned ${on ? 'on' : 'off'}.`)
    redrawn.value++
  }
}

// The port, kept as it is left: on Enter, or on leaving the field. The
// server moves to it at once.
const portDraft = ref('')

const showPort = () => {
  portDraft.value = state.value?.port ? String(state.value.port) : ''
}

watch(() => state.value?.port, showPort, { immediate: true })

const savePort = async () => {
  const port = Number(portDraft.value.trim())
  if (!/^\d+$/.test(portDraft.value.trim()) || port === state.value?.port) return showPort()
  try {
    await setPort(port)
  } catch (error) {
    console.error('Failed to change the port apps connect on:', error)
    toast.error("That port can't be used. Choose a number from 1024 to 65535.")
  }
  showPort()
}
</script>
