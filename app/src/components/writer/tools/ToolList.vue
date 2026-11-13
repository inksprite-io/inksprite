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
          v-for="tool in group.tools"
          :key="tool.name"
          class="flex items-center gap-2"
          :data-tool="tool.name"
        >
          <span
            v-tooltip.top="{ value: tool.description, showDelay: 400 }"
            class="flex-1 min-w-0 text-xs text-surface-700 dark:text-surface-200 truncate"
            :class="{ 'opacity-50': !allOn || !isGroupOn(group.id) }"
          >
            {{ tool.label }}
          </span>
          <span
            v-if="tool.approval"
            class="flex-none text-xs text-surface-400"
            :data-approval="tool.approval"
          >
            {{ tool.approval === 'asks' ? 'Asks first' : 'Always allowed' }}
          </span>
          <ToggleSwitch
            :model-value="isToolOn(group.id, tool.name)"
            :disabled="!allOn || !isGroupOn(group.id)"
            class="flex-none"
            :aria-label="tool.label"
            @update:model-value="emit('tool', tool.name, $event)"
          />
        </div>
      </div>
    </ExpandableSection>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import ToggleSwitch from 'primevue/toggleswitch'
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import { getToolGroups, SKILLS_GROUP } from '@/ai/tools/index.js'
import { groupOn, toolOn, toolsSwitchedOff } from '@/ai/tools/choice.js'
import { allSkills, skillLabel } from '@/ai/skills/index.js'
import { loadedByModel } from '@/ai/skills/runner.js'
import { useSkills } from '@/composables/useSkills'
import { useMcpServers } from '@/composables/useMcpServers.js'
import { useWebSearch } from '@/composables/useWebSearch.js'
import { approvalOf } from '@/composables/useToolApprovals.js'
import { serverTool } from '@/mcp/servers.js'

/**
 * What the model can reach for, by where each comes from: the documents, the
 * web, Python, each server, the skills, the RPG tools (`getToolGroups`). A
 * group switches on or off and opens to switch single tools; beside a tool
 * that asks before each call, whether it does, as text and never a switch.
 * Enable tools, over them all, switches every tool off or back on without
 * touching their own switches, which wait as they are, greyed, until it is
 * on. It shows a choice of tools (ai/tools/choice.js) and says what was
 * switched, and whoever holds the choice writes it.
 *
 * @typedef {Object} Props
 * @property {import('@/ai/tools/choice.js').ToolChoice|null} [choice] - The
 *   tools as they are switched
 * @property {boolean} [disabled] - The model can't be offered tools at all:
 *   every switch reads as off and can't be switched
 */
const props = defineProps({
  choice: { type: Object, default: null },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits({
  /** Every tool switched off, or back on as each was. */
  all: (/** @type {boolean} */ on) => typeof on === 'boolean',
  /** Groups switched on or off, by id. */
  groups: (/** @type {string[]} */ ids, /** @type {boolean} */ on) =>
    Array.isArray(ids) && typeof on === 'boolean',
  /** A tool switched on or off, by the name the model calls it. */
  tool: (/** @type {string} */ name, /** @type {boolean} */ on) =>
    typeof name === 'string' && typeof on === 'boolean',
})

// What is listed is made from the writer's skills, servers and web search,
// so it is read again when they change. See ai/tools.
const { skills: library } = useSkills()
const { servers } = useMcpServers()
const webSearch = useWebSearch()

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
 * A tool as the list shows it: a server's by the title it gave, the app's
 * own by its name in words, and whether it asks before each call.
 * @param {import('@/ai/tools/registry.js').ToolDefinition} definition
 */
const toolRow = definition => {
  const name = definition.function.name
  const found = serverTool(name)
  return {
    name,
    label: found ? found.tool.title || found.tool.name : readableTool(name),
    description: (found ? found.tool.description : definition.function.description) || '',
    approval: approvalOf(name),
  }
}

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
      approval: /** @type {'asks'|'allowed'|null} */ (null),
    }))
})

/** The groups, in the order the registry lists them, less any with nothing in them. */
const groups = computed(() => {
  void servers.value
  void webSearch.setup.value
  const skills = skillRows.value
  return getToolGroups()
    .map(group => ({
      id: group.id,
      label: group.label,
      tools: group.id === SKILLS_GROUP ? skills : group.definitions.map(toolRow),
    }))
    .filter(group => group.tools.length > 0)
})

/** Whether tools are on at all: the switch over all of them. */
const allOn = computed(() => !props.disabled && !toolsSwitchedOff(props.choice))

/** The choice as each switch has it, whether or not tools are on at all. */
const switched = computed(() => ({ ...props.choice, toolsOff: undefined }))

/** @param {string} id */
const isGroupOn = id => !props.disabled && groupOn(switched.value, id)

/** @param {string} groupId @param {string} name */
const isToolOn = (groupId, name) => !props.disabled && toolOn(switched.value, name, groupId)
</script>
