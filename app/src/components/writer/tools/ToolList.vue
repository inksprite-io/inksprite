<template>
  <div class="flex flex-col gap-1">
    <!-- The size of the groups' headers under it, so that its switch lines up
         with theirs and the rows are spaced alike. -->
    <div class="flex items-center justify-between gap-2 h-8 px-2">
      <label class="text-xs font-medium text-surface-700 dark:text-surface-200">
        Enable tools
      </label>
      <ToggleSwitch
        :model-value="allOn"
        :disabled="disabled"
        class="flex-none"
        aria-label="Enable tools"
        data-tools-switch
        @update:model-value="emit('all', $event)"
      />
    </div>
    <slot />
    <ExpandableSection
      v-for="group in groups"
      :key="group.id"
      :title="group.label"
      :storage-key="`ui.chat-settings.tools.${group.id}`"
      subsection
      content-wrapper-class="flex flex-col"
    >
      <template #actions>
        <ToggleSwitch
          :model-value="isGroupOn(group.id)"
          :disabled="!allOn"
          class="flex-none"
          :aria-label="toolsOf(group.label)"
          :data-tool-group="group.id"
          @update:model-value="emit('groups', [group.id], $event)"
        />
      </template>
      <div class="flex flex-col gap-1 pt-1 pb-2">
        <div
          v-for="row in group.rows"
          :key="row.name"
          class="flex items-center gap-2"
          :data-tool="row.name"
        >
          <span
            v-tooltip.top="{ value: row.description, showDelay: 400 }"
            class="flex-1 min-w-0 text-xs text-surface-700 dark:text-surface-200 truncate"
            :class="{ 'opacity-50': !allOn || !isGroupOn(group.id) }"
          >
            {{ row.label }}
          </span>
          <Select
            :key="drawn"
            :model-value="disabled ? 'off' : row.value"
            :options="row.options"
            option-label="label"
            option-value="value"
            :disabled="!allOn || !isGroupOn(group.id)"
            :aria-label="row.label"
            size="small"
            class="flex-none w-48 dark:!bg-surface-900"
            @update:model-value="row.set"
          />
        </div>
      </div>
    </ExpandableSection>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useReadingConfirm } from '@/composables/useReadingConfirm.js'
import { READ_WEB_PAGE } from '@/ai/tools/web.js'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import { getToolGroups } from '@/ai/tools/index.js'
import {
  DOCUMENTS_GROUP,
  DOCUMENT_ROWS,
  SKILLS_GROUP,
  groupOn,
  rowOn,
  toolOn,
  toolsSwitchedOff,
} from '@/ai/tools/choice.js'
import { allSkills, skillLabel } from '@/ai/skills/index.js'
import { loadedByModel } from '@/ai/skills/runner.js'
import { useApplicationState } from '@/composables/useApplicationState.js'
import { useSkills } from '@/composables/useSkills'
import { OFF_ON, WEB_TOOL_LABELS, useToolSettings } from '@/composables/useToolSettings.js'
import { useMcpServers } from '@/composables/useMcpServers.js'
import { useWebSearch } from '@/composables/useWebSearch.js'
import { serverTool } from '@/mcp/servers.js'

/**
 * What the model can reach for, by where each comes from: the documents, the
 * web, Python, each server, the skills, the RPG tools (`getToolGroups`). A
 * group switches on or off, and opens on what is in it, each with its own
 * setting: off or on, or for a tool that may ask the writer first, off,
 * asking first, or always allowed.
 *
 * A group's switch is the chat's, and its profile's (ai/tools/choice.js), as
 * are the documents' rows, what the model does with them rather than tool by
 * tool, and each skill; whoever holds the choice writes those. Every other
 * tool's setting is the whole app's (ai/tools/everywhere.js), and written
 * from here.
 *
 * Enable tools, over them all, switches every tool off or back on without
 * touching their own settings, which wait as they are, greyed, until it is
 * on.
 *
 * @typedef {Object} Props
 * @property {import('@/ai/tools/choice.js').ToolChoice|null} [choice] - The
 *   tools as they are switched
 * @property {'off'|'ask'|'auto'} [editing] - How the model edits the
 *   documents: not at all, as suggestions, or straight in
 * @property {boolean} [disabled] - The model can't be offered tools at all:
 *   everything reads as off and can't be switched
 */
const props = defineProps({
  choice: { type: Object, default: null },
  editing: { type: String, default: 'auto' },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits({
  /** Every tool switched off, or back on as each was. */
  all: (/** @type {boolean} */ on) => typeof on === 'boolean',
  /** Groups switched on or off, by id. */
  groups: (/** @type {string[]} */ ids, /** @type {boolean} */ on) =>
    Array.isArray(ids) && typeof on === 'boolean',
  /** A skill switched on or off, by the name the model calls it. */
  tool: (/** @type {string} */ name, /** @type {boolean} */ on) =>
    typeof name === 'string' && typeof on === 'boolean',
  /** Reading or commenting on the documents switched on or off. */
  row: (/** @type {'read'|'comment'} */ id, /** @type {boolean} */ on) =>
    typeof id === 'string' && typeof on === 'boolean',
  /** How the model edits the documents. */
  editing: (/** @type {'off'|'ask'|'auto'} */ mode) => ['off', 'ask', 'auto'].includes(mode),
})

// What is listed is made from the writer's skills, servers and web search,
// so it is read again when they change. See ai/tools.
const { skills: library } = useSkills()
const mcp = useMcpServers()
const webSearch = useWebSearch()
const app = useApplicationState()
const everywhere = useToolSettings()
const { confirmUnasked } = useReadingConfirm()
/** Raised to draw the selects again as they are set, after a change is refused. */
const drawn = ref(0)

/** For editing the documents. @type {import('@/composables/useToolSettings.js').Option[]} */
const OFF_SUGGEST_EDIT = [
  { label: 'Off', value: 'off' },
  { label: 'Suggest changes', value: 'ask' },
  { label: 'Edit directly', value: 'auto' },
]

/**
 * A tool as the writer reads it: its name in words, as a server's tool is
 * listed by its title. `read_document` is how the model knows it.
 * @param {string} name
 * @returns {string}
 */
const readableTool = name => {
  const words = name.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * What a group's switch is called: its tools, said once — a group already
 * called "RPG Tools" is not "RPG Tools tools".
 * @param {string} label
 * @returns {string}
 */
const toolsOf = label => (/\btools$/i.test(label) ? label : `${label} tools`)

/**
 * A tool switched for the whole app, as the list shows it: a server's by the
 * title it gave, the app's own by its name in words.
 * @param {import('@/ai/tools/registry.js').ToolDefinition} definition
 */
const toolRow = definition => {
  const name = definition.function.name
  const found = serverTool(name)
  return {
    name,
    label: found
      ? found.tool.title || found.tool.name
      : (WEB_TOOL_LABELS[name] ?? readableTool(name)),
    description: (found ? found.tool.description : definition.function.description) || '',
    options: everywhere.optionsFor(name),
    value: everywhere.settingOf(name),
    set: async (/** @type {string} */ setting) => {
      // Reading that stops asking is confirmed first; said no, the row is
      // drawn again as it was.
      const unasked =
        name === READ_WEB_PAGE && setting === 'always' && everywhere.settingOf(name) !== 'always'
      if (unasked && !(await confirmUnasked('web'))) drawn.value++
      else everywhere.setSetting(name, setting)
    },
  }
}

/** What the model does with the documents: reading, editing, commenting. */
const documentRows = computed(() =>
  DOCUMENT_ROWS.map(row => ({
    name: row.id,
    label: row.label,
    description: '',
    options: row.id === 'edit' ? OFF_SUGGEST_EDIT : OFF_ON,
    value: row.id === 'edit' ? props.editing : rowOn(switched.value, row.id) ? 'on' : 'off',
    set: (/** @type {string} */ setting) =>
      row.id === 'edit'
        ? emit('editing', /** @type {'off'|'ask'|'auto'} */ (setting))
        : emit('row', row.id, setting === 'on'),
  }))
)

/**
 * The skills the model can call or load, by name rather than as
 * `use_skill`: the writer's own, then the built-ins, each in alphabetical
 * order. Each is switched by its name.
 */
const skillRows = computed(() => {
  void library.value
  /** @param {import('@/ai/skills/index.js').Skill} skill */
  const rank = skill => (skill.builtIn ? 1 : 0)
  return allSkills()
    .filter(skill => (skill.model && skill.execute) || loadedByModel(skill))
    .map(skill => ({ skill, label: skillLabel(skill) }))
    .sort((a, b) => rank(a.skill) - rank(b.skill) || a.label.localeCompare(b.label))
    .map(({ skill, label }) => ({
      name: skill.name,
      label,
      description: skill.summary,
      options: OFF_ON,
      value: toolOn(switched.value, skill.name, SKILLS_GROUP) ? 'on' : 'off',
      set: (/** @type {string} */ setting) => emit('tool', skill.name, setting === 'on'),
    }))
})

/** The groups, in the order the registry lists them, less any with nothing in them. */
const groups = computed(() => {
  // What each tool is set to for the whole app is kept in these.
  void mcp.servers.value
  void webSearch.setup.value
  void app.toolsOff.value
  return getToolGroups()
    .map(group => ({
      id: group.id,
      label: group.label,
      rows:
        group.id === DOCUMENTS_GROUP
          ? documentRows.value
          : group.id === SKILLS_GROUP
            ? skillRows.value
            : group.definitions.map(toolRow),
    }))
    .filter(group => group.rows.length > 0)
})

/** Whether tools are on at all: the switch over all of them. */
const allOn = computed(() => !props.disabled && !toolsSwitchedOff(props.choice))

/** The choice as each switch has it, whether or not tools are on at all. */
const switched = computed(() => ({ ...props.choice, toolsOff: undefined }))

/** @param {string} id */
const isGroupOn = id => !props.disabled && groupOn(switched.value, id)
</script>
