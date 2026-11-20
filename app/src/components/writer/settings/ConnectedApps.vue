<template>
  <div class="flex flex-col gap-2" data-connected-apps>
    <Teleport defer :to="heading" :disabled="!heading">
      <HeaderButton
        icon="pi pi-plus"
        label="Add an app"
        data-action="add-app"
        @click="openAdding"
      />
    </Teleport>

    <!-- The port apps come in on, and what keeps them out when something
         else has it. -->
    <template v-if="state">
      <label
        class="flex items-center gap-2 text-xs font-medium text-surface-700 dark:text-surface-200"
      >
        Port
        <InputText
          v-model="portDraft"
          size="small"
          class="w-24"
          inputmode="numeric"
          data-field="apps-port"
          @blur="savePort"
          @keydown.enter="savePort"
        />
      </label>
      <p v-if="state.problem" class="text-xs text-red-600 dark:text-red-400" data-apps-problem>
        {{ state.problem }}
      </p>
    </template>

    <CardList v-if="adding">
      <CardItem title="New app" open data-adding @toggle="closeAdding">
        <label class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300">
          Name
          <InputText
            ref="nameField"
            v-model="draftName"
            size="small"
            placeholder="Claude Code"
            data-field="app-name"
            @keydown.enter="add"
          />
        </label>
        <div class="flex gap-2">
          <Button
            label="Add"
            size="small"
            :disabled="!draftName.trim()"
            data-action="add"
            @click="add"
          />
          <Button
            label="Cancel"
            size="small"
            text
            severity="secondary"
            data-action="cancel"
            @click="closeAdding"
          />
        </div>
      </CardItem>
    </CardList>

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
          <div class="flex flex-col gap-1 max-h-48 overflow-y-auto">
            <label
              v-for="project in projects.rows.value"
              :key="project.id"
              class="flex items-center gap-2 text-sm cursor-pointer"
              :data-app-project="project.id"
            >
              <Checkbox
                :model-value="one.projects.includes(project.id)"
                binary
                size="small"
                @update:model-value="ticked => tick(one, project.id, ticked)"
              />
              <span class="truncate">{{ project.name }}</span>
            </label>
          </div>
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

        <div>
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
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import InputText from 'primevue/inputtext'
import CardList from '@/components/common/CardList.vue'
import CardItem from '@/components/common/CardItem.vue'
import HeaderButton from '../layout/HeaderButton.vue'
import { useSectionHeading } from '@/components/common/sectionHeading.js'
import { appAddress, claudeCodeCommand, useConnectedApps } from '@/composables/useConnectedApps.js'
import { useProjects } from '@/composables/useProjects.js'
import { useToast } from '@/composables/useToast'
import { formatRelativeTime } from '@/utils/formatters.js'

/** @typedef {import('@/platform/apps.js').AppConnection} AppConnection */

/**
 * Settings → Connections → Connected apps, in the desktop app: the other
 * apps on this computer the writer has let into their projects, a coding
 * agent first. A card for each, with its name, the projects ticked for it,
 * what to set the app up with, and when it last asked anything, under the
 * port they all come in on. An app is let in only to the projects ticked,
 * and none is to start with. See
 * composables/useConnectedApps.js and `.llm/mcp_server_design.md`.
 */

const heading = useSectionHeading()
const toast = useToast()
const projects = useProjects()
const {
  state,
  load,
  add: addApp,
  rename,
  setProject,
  remove: removeApp,
  setPort,
} = useConnectedApps()

const connections = computed(() => state.value?.connections ?? [])

/** The connection whose card is open, if one's is. */
const open = ref(/** @type {string|null} */ (null))

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

/** @param {AppConnection} one */
const toggle = one => {
  open.value = open.value === one.id ? null : one.id
}

/**
 * The line under a connection's name: the projects it is let into, by name.
 * @param {AppConnection} one
 */
const projectsLine = one => {
  const names = projects.rows.value
    .filter(project => one.projects.includes(project.id))
    .map(project => project.name)
  return names.length > 0 ? names.join(', ') : 'No projects'
}

// Adding: a name, then its card open on the projects to tick.
const adding = ref(false)
const draftName = ref('')
const nameField = ref(/** @type {any} */ (null))

const openAdding = async () => {
  adding.value = true
  await nextTick()
  nameField.value?.$el?.focus()
}

const closeAdding = () => {
  adding.value = false
  draftName.value = ''
}

const add = async () => {
  if (!draftName.value.trim()) return
  try {
    const made = await addApp(draftName.value)
    closeAdding()
    open.value = made.id
  } catch (error) {
    console.error('Failed to add a connected app:', error)
    toast.error("The app couldn't be added.")
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
 * @param {AppConnection} one
 * @param {{id: string, label: string, text: string}} row
 */
const copy = async (one, row) => {
  try {
    await navigator.clipboard.writeText(row.text)
    const key = `${one.id}:${row.id}`
    copied.value = key
    setTimeout(() => {
      if (copied.value === key) copied.value = null
    }, 1500)
  } catch {
    toast.error("That couldn't be copied.")
  }
}

// The port, kept as it is left: on Enter, or on leaving the field.
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
    toast.error("That port can't be used.")
  }
  showPort()
}
</script>
