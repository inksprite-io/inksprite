<template>
  <div class="w-full h-full flex flex-col bg-surface-0 dark:bg-surface-800">
    <!-- Header -->
    <div
      class="w-full flex-none flex items-center justify-between py-2 px-2 bg-surface-100 dark:bg-surface-900/40 shadow-sm"
    >
      <Button
        type="button"
        icon="pi pi-chevron-left"
        severity="secondary"
        size="small"
        rounded
        class="flex-none !bg-transparent !border-transparent hover:!bg-surface-700"
        aria-label="Back to chat"
        @click="emit('back')"
      />
      <h2 class="text-md font-semibold truncate flex-1 text-center">Chat Settings</h2>
      <div class="w-8" />
    </div>

    <ScrollPanel class="flex-1 overflow-auto">
      <div class="mx-auto w-full max-w-3xl flex flex-col gap-1 p-4">
        <!-- 1. The profile: how this chat is run. -->
        <ExpandableSection
          title="Profile"
          storage-key="ui.chat-settings.profile"
          level="2"
          default-expanded
          content-wrapper-class="flex flex-col px-3"
        >
          <div class="flex flex-col gap-3 pt-2 pb-2">
            <div class="flex flex-col gap-1">
              <SettingLabel
                label="Profile"
                description="Editing a built-in profile makes a copy of your own."
                :overridden="!isDefaultProfile"
                reset-tooltip="Back to the project's default"
                @reset="setProfile(defaultProfileId)"
              />

              <div class="flex gap-1">
                <InputText
                  v-if="renamingProfile"
                  ref="profileNameInput"
                  v-model="draftProfileName"
                  placeholder="Profile name"
                  size="small"
                  class="flex-1 min-w-0 dark:!bg-surface-900"
                  aria-label="Profile name"
                  @keyup.enter="commitProfileRename"
                  @keyup.escape="renamingProfile = false"
                  @blur="commitProfileRename"
                />
                <Select
                  v-else
                  :model-value="selectedProfileId"
                  :options="profiles"
                  option-label="name"
                  option-value="id"
                  placeholder="Select a profile"
                  class="flex-1 min-w-0 dark:!bg-surface-900"
                  size="small"
                  :pt="{ list: { onMousedownCapture: ignoreRightButton } }"
                  @update:model-value="chooseProfile"
                >
                  <template #option="{ option }">
                    <span
                      class="flex-1 flex items-center gap-2 min-w-0"
                      :data-profile="option.id"
                      @contextmenu="profileContextMenu?.show($event, option.id)"
                    >
                      <span class="truncate">{{ option.name }}</span>
                      <span v-if="option.readOnly" class="text-xs text-surface-400 flex-none">
                        built-in
                      </span>
                    </span>
                  </template>
                </Select>
                <Button
                  v-tooltip.top="'Profile actions'"
                  icon="pi pi-ellipsis-v"
                  severity="secondary"
                  text
                  rounded
                  size="small"
                  aria-label="Profile actions"
                  aria-haspopup="true"
                  aria-controls="chat_profile_actions"
                  @click="profileMenu?.toggle($event)"
                />
                <Menu
                  id="chat_profile_actions"
                  ref="profileMenu"
                  :model="profileMenuItems"
                  :popup="true"
                />
                <ProfileContextMenu
                  ref="profileContextMenu"
                  :story-id="props.storyId"
                  :chat-id="props.chatId"
                />
              </div>
            </div>

            <!-- Capped: a long prompt otherwise fills the panel. -->
            <div class="flex flex-col gap-1">
              <SettingLabel label="System prompt" />
              <Textarea
                v-model="systemPrompt"
                size="small"
                class="w-full max-h-80 !overflow-y-auto dark:!bg-surface-900"
                auto-resize
                rows="6"
                aria-label="System Prompt"
                @input="handleSystemPromptInput"
              />
            </div>

            <div class="flex flex-col gap-1">
              <SettingLabel
                label="Author's note"
                description="Sent just ahead of each message you write. Keep it short."
              />
              <Textarea
                v-model="rules"
                size="small"
                class="w-full max-h-48 !overflow-y-auto dark:!bg-surface-900"
                auto-resize
                rows="3"
                aria-label="Author's note"
                placeholder="e.g. Past tense, third person. Never end on a question."
                @input="handleRulesInput"
              />
            </div>

            <div class="flex flex-col gap-1">
              <div class="flex items-center justify-between gap-2">
                <label class="text-xs font-medium text-surface-700 dark:text-surface-200">
                  Project Context
                </label>
                <ToggleSwitch
                  :model-value="projectContextEnabled"
                  class="flex-none"
                  aria-label="Project Context"
                  @update:model-value="setProjectContextEnabled"
                />
              </div>
              <p class="text-xs text-surface-500 dark:text-surface-400">
                Sends the project overview and your pinned documents with every turn.
              </p>
            </div>
          </div>
        </ExpandableSection>

        <!-- 2. Tools: what the model can reach for. -->
        <ExpandableSection
          title="Tools"
          storage-key="ui.chat-settings.tools"
          level="2"
          content-wrapper-class="flex flex-col px-3"
        >
          <div class="flex flex-col gap-1 pt-2 pb-2">
            <!-- The size of the groups' headers under it, so that its switch
                 lines up with theirs and the rows are spaced alike. -->
            <div class="flex items-center justify-between gap-2 h-8 px-2">
              <label class="text-xs font-medium text-surface-700 dark:text-surface-200">
                Enable Tools
              </label>
              <ToggleSwitch
                :model-value="allToolsEnabled"
                :disabled="!modelToolsEnabled"
                class="flex-none"
                aria-label="Enable Tools"
                @update:model-value="setAllToolsEnabled"
              />
            </div>
            <p v-if="!modelToolsEnabled" class="text-xs text-surface-500 dark:text-surface-400">
              Tool use is off in the AI preset.
            </p>
            <!-- App-wide, unlike the rest of the section, and it says so. -->
            <div class="flex items-center justify-between gap-2 h-8 px-2">
              <label class="text-xs font-medium text-surface-700 dark:text-surface-200">
                Apply edits automatically
              </label>
              <ToggleSwitch
                v-model="applyEditsAutomatically"
                class="flex-none"
                aria-label="Apply edits automatically"
              />
            </div>
            <p class="text-xs text-surface-500 dark:text-surface-400 px-2 pb-1">
              Applies to every chat.
            </p>
            <ExpandableSection
              v-for="group in toolGroups"
              :key="group.id"
              :title="group.label"
              :storage-key="`ui.chat-settings.tools.${group.id}`"
              subsection
              content-wrapper-class="flex flex-col"
            >
              <template #actions>
                <ToggleSwitch
                  :model-value="isGroupEnabled(group.id)"
                  :disabled="!modelToolsEnabled"
                  class="flex-none"
                  :aria-label="`${group.label} tools`"
                  :data-tool-group="group.id"
                  @update:model-value="setGroupEnabled(group.id, $event)"
                />
              </template>
              <div class="flex flex-col gap-1 pt-1 pb-2">
                <div
                  v-for="tool in group.tools"
                  :key="tool.name"
                  class="flex items-center justify-between gap-2"
                >
                  <span
                    v-tooltip.top="{ value: tool.description, showDelay: 400 }"
                    class="text-xs text-surface-700 dark:text-surface-200 truncate"
                    :class="{ 'opacity-50': !isGroupEnabled(group.id) }"
                  >
                    {{ tool.name }}
                  </span>
                  <ToggleSwitch
                    :model-value="!disabledTools.includes(tool.name)"
                    :disabled="!isGroupEnabled(group.id)"
                    class="flex-none"
                    :aria-label="tool.name"
                    @update:model-value="setToolEnabled(tool.name, $event)"
                  />
                </div>
              </div>
            </ExpandableSection>

            <!-- The writer's servers, each opted into rather than withheld: a
                 server connected tomorrow reaches no chat that did not ask. -->
            <template v-if="servers.length > 0">
              <p class="text-xs text-surface-500 dark:text-surface-400 pt-2 px-2">
                From your connections
              </p>
              <ExpandableSection
                v-for="server in servers"
                :key="server.id"
                :title="server.name"
                :storage-key="`ui.chat-settings.tools.mcp.${server.id}`"
                subsection
                content-wrapper-class="flex flex-col"
              >
                <template #actions>
                  <ToggleSwitch
                    :model-value="isServerEnabled(server.id)"
                    :disabled="!modelToolsEnabled"
                    class="flex-none"
                    :aria-label="`${server.name} tools`"
                    :data-server="server.id"
                    @update:model-value="setServerEnabled(server.id, $event)"
                  />
                </template>
                <div class="flex flex-col gap-1 pt-1 pb-2">
                  <div
                    v-for="tool in server.tools"
                    :key="tool.name"
                    class="flex items-center justify-between gap-2"
                  >
                    <span
                      v-tooltip.top="{ value: tool.description, showDelay: 400 }"
                      class="text-xs text-surface-700 dark:text-surface-200 truncate"
                      :class="{ 'opacity-50': !isServerEnabled(server.id) }"
                    >
                      {{ tool.label }}
                    </span>
                    <ToggleSwitch
                      :model-value="!disabledTools.includes(tool.name)"
                      :disabled="!isServerEnabled(server.id)"
                      class="flex-none"
                      :aria-label="tool.label"
                      @update:model-value="setToolEnabled(tool.name, $event)"
                    />
                  </div>
                </div>
              </ExpandableSection>
            </template>
          </div>
        </ExpandableSection>

        <!-- 3. Skills: the pieces of work with prompts of their own. -->
        <ExpandableSection
          title="Skills"
          storage-key="ui.chat-settings.skills"
          level="2"
          content-wrapper-class="flex flex-col px-3"
        >
          <div class="flex flex-col gap-1 pt-2 pb-2">
            <p class="text-xs text-surface-500 dark:text-surface-400 pb-1">
              Off hides a skill from the model. Its command still works.
            </p>

            <ExpandableSection
              v-for="skill in skills"
              :key="skill.id"
              :title="skill.label"
              :storage-key="`ui.chat-settings.skills.${skill.id}`"
              subsection
              content-wrapper-class="flex flex-col"
            >
              <template #actions>
                <span
                  v-if="skill.loaded"
                  class="text-xs text-surface-500 dark:text-surface-400 flex-none"
                  data-skill-loaded
                  >Loaded</span
                >
                <ToggleSwitch
                  v-if="skill.tool"
                  :model-value="isSkillEnabled(skill.tool)"
                  :disabled="!modelToolsEnabled"
                  class="flex-none"
                  :aria-label="`${skill.label} available to the model`"
                  @update:model-value="setSkillEnabled(skill.tool, $event)"
                />
                <span v-else class="text-xs text-surface-400 flex-none">{{ skill.command }}</span>
              </template>
              <div class="flex flex-col gap-2 pt-1 pb-2">
                <p class="text-xs text-surface-500 dark:text-surface-400">
                  {{ skill.description }}
                  <template v-if="skill.tool && skill.command">
                    Call it yourself with {{ skill.command }}.
                  </template>
                </p>
                <p
                  v-if="skill.waiting"
                  class="text-xs text-surface-500 dark:text-surface-400 italic"
                >
                  {{ skill.waiting }}
                </p>
                <p
                  v-if="skill.loaded"
                  class="text-xs text-surface-500 dark:text-surface-400 flex items-center gap-2"
                >
                  <span v-if="skill.dropped" class="flex-1" data-skill-dropped>
                    Dropped at the next summary.
                  </span>
                  <span v-else class="flex-1"> Loaded in this chat. </span>
                  <Button
                    v-if="!skill.dropped"
                    v-tooltip.top="'Not kept past the next summary'"
                    label="Drop"
                    size="small"
                    text
                    severity="secondary"
                    :aria-label="`Drop ${skill.label} at the next summary`"
                    data-action="drop-skill"
                    @click="dropSkill(skill.id)"
                  />
                </p>
                <div class="flex flex-col gap-1">
                  <SettingLabel
                    label="Prompt"
                    :overridden="isSkillOverridden(skill.id)"
                    :reset-tooltip="`Back to the wording ${skill.label} ships with`"
                    @reset="resetSkill(skill.id)"
                  />
                  <Textarea
                    v-model="skillDrafts[skill.id]"
                    size="small"
                    class="w-full max-h-80 !overflow-y-auto dark:!bg-surface-900"
                    auto-resize
                    rows="4"
                    :aria-label="`${skill.label} prompt`"
                    @input="setSkillPrompt(skill.id)"
                  />
                </div>
              </div>
            </ExpandableSection>

            <p class="text-xs text-surface-500 dark:text-surface-400 pt-1">
              <button
                type="button"
                class="underline hover:text-surface-700 dark:hover:text-surface-200"
                data-action="open-library"
                @click="settingsPanel.open('skills')"
              >
                Open the skill library
              </button>
            </p>
          </div>
        </ExpandableSection>

        <!-- 4. AI: what the request runs on. App-wide, and says so. -->
        <ExpandableSection
          title="AI"
          storage-key="ui.chat-settings.ai"
          level="2"
          content-wrapper-class="flex flex-col px-3"
        >
          <div class="flex flex-col gap-3 pt-2 pb-2">
            <AiPresetGroup />
            <p class="text-xs text-surface-500 dark:text-surface-400">Shared by every chat.</p>
          </div>
        </ExpandableSection>

        <!-- 5. Voices: how this chat is read aloud. -->
        <ExpandableSection
          title="Voices"
          storage-key="ui.chat-settings.voices"
          level="2"
          content-wrapper-class="flex flex-col px-3"
        >
          <div class="flex flex-col gap-3 pt-2 pb-2">
            <div class="flex flex-col gap-1">
              <SettingLabel
                label="Assistant Voice"
                :overridden="!!chatVoice"
                reset-tooltip="Back to the project's default voice"
                @reset="setVoice(null)"
              />
              <Select
                :model-value="selectedVoiceId"
                :options="voices"
                option-label="name"
                option-value="id"
                class="w-full dark:!bg-surface-900"
                size="small"
                aria-label="Assistant Voice"
                data-chat-voice
                @update:model-value="setVoice"
              />
            </div>

            <div class="flex flex-col gap-1">
              <SettingLabel
                label="Your Voice"
                :overridden="!!userVoice"
                reset-tooltip="Back to the assistant's voice"
                @reset="setUserVoice(null)"
              />
              <Select
                :model-value="selectedUserVoiceId"
                :options="voices"
                option-label="name"
                option-value="id"
                class="w-full dark:!bg-surface-900"
                size="small"
                aria-label="Your Voice"
                data-chat-user-voice
                @update:model-value="setUserVoice"
              />
            </div>

            <p class="text-xs text-surface-500 dark:text-surface-400">
              Voices come from the Narration tab.
            </p>
          </div>
        </ExpandableSection>
      </div>
    </ScrollPanel>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { Button, Textarea } from 'primevue'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Menu from 'primevue/menu'
import ToggleSwitch from 'primevue/toggleswitch'
import ScrollPanel from 'primevue/scrollpanel'
import SettingLabel from '@/components/common/SettingLabel.vue'
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import ProfileContextMenu from './ProfileContextMenu.vue'
import AiPresetGroup from '@/components/writer/settings/ai/AiPresetGroup.vue'
import { DEFAULT_CHAT_PROMPT } from '@/ai/prompts/index.js'
import { useChatSettings } from '@/composables/useChatSettings'
import { useAIConfig } from '@/composables/useAIConfig'
import { useNarration } from '@/composables/useNarration'
import { useProfiles } from '@/composables/useProfiles'
import { getToolGroups, SKILLS_GROUP } from '@/ai/tools/index.js'
import { allSkills, skillLabel, skillPrompt } from '@/ai/skills/index.js'
import { loadedByModel, waitingOn } from '@/ai/skills/runner.js'
import { useSkills } from '@/composables/useSkills'
import { useLoadedSkills } from '@/composables/useLoadedSkills.js'
import { useMcpServers } from '@/composables/useMcpServers.js'
import { reachable, serversForChat } from '@/mcp/servers.js'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { COMMANDS } from '@/ai/commands.js'

/**
 * Everything about one chat, in five sections.
 *
 * **Profile** is how this chat is run: its prompt, its author's note, and
 * whether the project rides along. **Tools** are what the model can reach for.
 * **Skills** are the pieces of work with prompts of their own that the model
 * may hand a turn to. **AI** is what the request runs on, which is app-wide and
 * says so. **Voices** is how it is read aloud.
 *
 * Two scopes are mixed on purpose. The writer does not care which row a setting
 * is stored on; they care that everything about this chat is in one place. What
 * the sections keep straight is which of them are shared, and each shared one
 * says so: the AI section, and whether edits apply automatically, under Tools.
 *
 * @typedef {Object} Props
 * @property {string} storyId - The story this chat belongs to
 * @property {string} chatId - The chat being configured, which can be the
 *   story's unstarted one: its settings are kept until it starts, and go into
 *   the chat it becomes.
 */
const props = defineProps({
  storyId: { type: String, required: true },
  chatId: { type: String, required: true },
})

const emit = defineEmits(['back'])

const aiConfig = useAIConfig()
const profilesApi = useProfiles()
const { skills: library } = useSkills()

// The writer's MCP servers, as the Tools section lists them. See mcp/servers.js.
const { servers: connectedServers } = useMcpServers()

const servers = computed(() =>
  connectedServers.value.filter(reachable).map(server => ({
    id: server.id,
    name: server.name,
    tools: (server.tools || []).map(tool => ({
      name: tool.exposed,
      label: tool.title || tool.name,
      description: tool.description || '',
    })),
  }))
)

/** The servers this chat is offered: its choice, or its profile's until it makes one. */
const chatServers = computed(() =>
  serversForChat(chat.value, selectedProfileId.value, connectedServers.value).map(
    server => server.id
  )
)

/** @param {string} id */
const isServerEnabled = id => modelToolsEnabled.value && chatServers.value.includes(id)

/**
 * Switch a server on or off for this chat. The first switch writes the chat's
 * own list, and from then on it no longer follows its profile's.
 *
 * @param {string} id
 * @param {boolean} enabled
 */
const setServerEnabled = (id, enabled) => {
  const others = chatServers.value.filter(one => one !== id)
  update({ mcpServers: enabled ? [...others, id] : others })
}

// What this chat has loaded, read off its messages; see ai/skills/loads.js.
const {
  loaded: loadedSkillNames,
  dropped: droppedSkillNames,
  drop: dropSkill,
} = useLoadedSkills(() => props.chatId)
const settingsPanel = useSettingsPanel()

/**
 * Registered tools by group, in the order the registry declares them. Read
 * again when the writer's library changes, since their skills are tools too.
 */
const allGroups = computed(() => {
  void library.value
  return getToolGroups().map(group => ({
    id: group.id,
    label: group.label,
    tools: group.definitions.map(d => ({
      name: d.function.name,
      description: d.function.description,
    })),
  }))
})

// The skills have a section of their own, so they are not also a group in the
// tool list: one switch per thing, in the place that explains what it is.
const toolGroups = computed(() => allGroups.value.filter(group => group.id !== SKILLS_GROUP))

/**
 * The skills the model is offered, by the name each is switched by: its tool,
 * or, for one it loads, its own name in `use_skill`'s list.
 */
const skillTools = computed(() => skills.value.flatMap(skill => (skill.tool ? [skill.tool] : [])))

// The preset gates whether this model can call tools at all; these switches
// only choose among the ones it would otherwise be offered.
const activePreset = computed(() => aiConfig.activeAIPreset.value)
const modelToolsEnabled = computed(() => activePreset.value?.toolsEnabled !== false)

// Whether the assistant's changes to documents go straight in, or wait in the
// chat for the writer. App-wide; it sits here because this is where the writer
// looks when deciding what the assistant may do.
const { applyEdits, setApplyEdits } = useApplicationState()
const applyEditsAutomatically = computed({
  get: () => applyEdits.value === 'auto',
  set: value => setApplyEdits(value ? 'auto' : 'ask'),
})

const {
  chat,
  update,
  profiles,
  defaultProfileId,
  selectedProfileId,
  selectedProfile,
  setProfile,
  chooseProfile,
  deleteProfile,
} = useChatSettings(props.storyId, () => props.chatId)

const disabledTools = computed(() => chat.value?.disabledTools || [])
const disabledToolGroups = computed(() => chat.value?.disabledToolGroups || [])

/** A group's own switch, and the preset's switch above it, both have to be on. */
const isGroupEnabled = groupId =>
  modelToolsEnabled.value && !disabledToolGroups.value.includes(groupId)

/**
 * Whether the project rides at the tail of every turn. Chats saved before this
 * existed carried it, so an absent flag means on — the opposite of the
 * Director's, which nothing had.
 */
const projectContextEnabled = computed(() => chat.value?.projectContextEnabled !== false)

const setProjectContextEnabled = enabled => update({ projectContextEnabled: enabled })

// The voice the chat is read aloud in: one of the project's. A chat that has
// picked none, or one since removed, reads in the project's default, and
// shows it, so the box is never empty.
const narration = useNarration(props.storyId)
const voices = computed(() => narration.voices.value)
const chatVoice = computed(() => narration.voiceById(chat.value?.voiceId ?? ''))
const selectedVoiceId = computed(() => chatVoice.value?.id ?? narration.defaultVoiceId.value)

/** @param {string|null} voiceId - A voice, or null for the project's default */
const setVoice = voiceId => update({ voiceId: voiceId || null })

// The writer's own messages, when they want to hear the two sides apart. Falls
// back to whatever the assistant is read in rather than to the project's
// default, so one voice for the whole chat stays one setting.
const userVoice = computed(() => narration.voiceById(chat.value?.userVoiceId ?? ''))
const selectedUserVoiceId = computed(() => userVoice.value?.id ?? selectedVoiceId.value)

/** @param {string|null} voiceId - A voice, or null to read as the assistant does */
const setUserVoice = voiceId => update({ userVoiceId: voiceId || null })

/**
 * The chat's author's note. Edited locally for the reason the prompt is: the
 * store echoes every write back, and a value that arrives mid-keystroke moves
 * the caret.
 */
const rules = ref(chat.value?.rules || '')

watch(
  () => chat.value?.rules,
  next => {
    if ((next || '') !== rules.value) rules.value = next || ''
  }
)

// Stored trimmed, and stored as absent when there is nothing left: an empty
// string and no note at all mean the same thing to the turn, and only one of
// them should reach the row.
const handleRulesInput = () => update({ rules: rules.value.trim() || undefined })

/**
 * Store the withheld tools rather than the allowed ones, so a tool added to
 * the registry later is offered to existing chats instead of silently missing.
 *
 * @param {string} name - Tool name
 * @param {boolean} enabled - Whether to offer it
 */
const setToolEnabled = (name, enabled) => {
  const next = disabledTools.value.filter(t => t !== name)
  if (!enabled) next.push(name)
  update({ disabledTools: next })
}

/**
 * Switching a group off withholds its members without naming them, so a tool
 * added to that group later stays off too — which is what the group is for.
 * Individual switches underneath are left alone, so turning the group back on
 * restores whatever was set before.
 *
 * @param {string} groupId
 * @param {boolean} enabled
 */
const setGroupEnabled = (groupId, enabled) => {
  const next = disabledToolGroups.value.filter(g => g !== groupId)
  if (!enabled) next.push(groupId)
  update({ disabledToolGroups: next })
}

/** On while any group in the list is: the switch over all of them. */
const allToolsEnabled = computed(() => toolGroups.value.some(group => isGroupEnabled(group.id)))

/**
 * Switch every group in the list at once. It goes through the groups rather
 * than the tools, so each tool's own switch is still as it was when they come
 * back. The skills are not in it: each has a switch of its own, beside what
 * it does.
 *
 * @param {boolean} enabled
 */
const setAllToolsEnabled = enabled => {
  const ids = toolGroups.value.map(group => group.id)
  const next = disabledToolGroups.value.filter(g => !ids.includes(g))
  if (!enabled) next.push(...ids)
  update({ disabledToolGroups: next })
}

/**
 * Whether the model is offered a skill. Skills are tools, so the preset's
 * switch and the skills group's gate them as well as their own.
 *
 * @param {string} tool
 */
const isSkillEnabled = tool => isGroupEnabled(SKILLS_GROUP) && !disabledTools.value.includes(tool)

/**
 * A skill's switch. The group has no switch of its own here — a control that
 * empties a section from somewhere else looks broken — but a profile can ship
 * with it off, as Roleplay does. Switching one skill on under it lifts the
 * group and holds back the others, so what comes on is the one asked for.
 *
 * @param {string} tool
 * @param {boolean} enabled
 */
const setSkillEnabled = (tool, enabled) => {
  if (!enabled || !disabledToolGroups.value.includes(SKILLS_GROUP)) {
    setToolEnabled(tool, enabled)
    return
  }
  const others = skillTools.value.filter(name => name !== tool)
  update({
    disabledToolGroups: disabledToolGroups.value.filter(g => g !== SKILLS_GROUP),
    disabledTools: [...new Set([...disabledTools.value.filter(t => t !== tool), ...others])],
  })
}

const isDefaultProfile = computed(() => selectedProfileId.value === defaultProfileId.value)

// Only the writer's own can be renamed or removed; the built-ins ship with the
// app, and editing one makes a copy to edit instead.
const isSavedProfile = computed(() => !!selectedProfile.value && !selectedProfile.value.readOnly)

/**
 * Every skill there is — the built-ins and the writer's own — from the
 * registry rather than named one at a time, as the panel lists them: what it
 * is called, what it does, the tool the model reaches it by when it is offered
 * one, the command the writer can type for it when there is one, and what a
 * skill of theirs is still waiting on.
 *
 * Made again when the library changes: the registry is not reactive, and the
 * library it is made from is.
 */
const skills = computed(() => {
  void library.value
  return allSkills().map(skill => ({
    id: skill.name,
    label: skillLabel(skill),
    description: skill.summary,
    // Only what the model is offered has a switch: Write has a tool to be
    // called by, and is the writer's until its file says otherwise.
    tool: (skill.model && skill.execute) || loadedByModel(skill) ? skill.name : undefined,
    command: skill.name in COMMANDS ? `/${skill.name}` : undefined,
    waiting: skill.builtIn ? '' : waitingOn(skill),
    loaded: loadedSkillNames.value.includes(skill.name),
    dropped: droppedSkillNames.value.includes(skill.name),
  }))
})

/**
 * What a skill runs under here, and whether this profile has said so rather
 * than taking the wording the skill ships with.
 *
 * @param {string} id
 */
const skillPromptFor = id => skillPrompt(id, selectedProfile.value?.settings)
const isSkillOverridden = id => !!selectedProfile.value?.settings?.skills?.[id]?.prompt

/**
 * The text as it is being typed, for the same reason the system prompt is held
 * locally: the store echoes every write back, and a value that arrives
 * mid-keystroke moves the caret.
 *
 * @type {import('vue').Ref<Record<string, string>>}
 */
const skillDrafts = ref(
  Object.fromEntries(skills.value.map(skill => [skill.id, skillPromptFor(skill.id)]))
)

watch(
  () => [selectedProfile.value?.settings, skills.value],
  () => {
    for (const skill of skills.value) {
      const stored = skillPromptFor(skill.id)
      if (stored !== skillDrafts.value[skill.id]) skillDrafts.value[skill.id] = stored
    }
  }
)

/**
 * Change what a skill runs under, on the profile. Editing a built-in forks it
 * the same way editing the system prompt does — the wording is the profile's,
 * and a built-in is not the writer's to rewrite.
 *
 * @param {string} id
 */
const setSkillPrompt = id => {
  const prompt = skillDrafts.value[id]
  const worded = { ...(selectedProfile.value?.settings?.skills || {}), [id]: { prompt } }
  if (isSavedProfile.value) {
    profilesApi.updateProfile(selectedProfileId.value, { settings: { skills: worded } })
  } else {
    forkProfile({ skills: worded })
  }
}

/**
 * Take the override off, which puts the skill back on the wording it ships
 * with — and keeps it there as that wording improves.
 *
 * @param {string} id
 */
const resetSkill = id => {
  if (!isSavedProfile.value) return
  const worded = { ...(selectedProfile.value?.settings?.skills || {}) }
  delete worded[id]
  profilesApi.updateProfile(selectedProfileId.value, { settings: { skills: worded } })
}

/** The text as the library holds it, which is what the next request sends. */
const profilePrompt = computed(() => selectedProfile.value?.settings?.prompt ?? DEFAULT_CHAT_PROMPT)

// Edited locally so typing doesn't fight the value the store echoes back,
// which would otherwise jump the caret on every keystroke.
const systemPrompt = ref(profilePrompt.value)

watch(profilePrompt, next => {
  if (next !== systemPrompt.value) systemPrompt.value = next
})

/**
 * Save the text as it is typed. A saved profile takes the edit itself. A
 * built-in is read-only, so the first keystroke makes a copy of the writer's
 * own and moves the chat onto it: the text stays where it is, and the copy's
 * name appears above it.
 */
const handleSystemPromptInput = () => {
  if (isSavedProfile.value) {
    profilesApi.updateProfile(selectedProfileId.value, { settings: { prompt: systemPrompt.value } })
  } else {
    forkProfile({ prompt: systemPrompt.value })
  }
}

/**
 * Copy the selected profile and switch this chat to the copy.
 * @param {Partial<import('@/ai/profiles/index.js').ProfileSettings>} [changes]
 */
const forkProfile = (changes = {}) => {
  const copy = profilesApi.duplicateProfile(selectedProfileId.value, changes)
  if (copy) update({ profileId: copy.id })
}

/** @type {import('vue').Ref<any>} */
const profileMenu = ref(null)
/** @type {import('vue').Ref<any>} */
const profileContextMenu = ref(null)

/**
 * The picker chooses an option on a press of any button, so a right click
 * would pick the profile and close the list before its menu could open. Kept
 * from the option on the way down, the press leaves the choice to the left
 * button.
 *
 * @param {MouseEvent} event
 */
const ignoreRightButton = event => {
  if (event.button === 2) event.stopPropagation()
}
/** @type {import('vue').Ref<any>} */
const profileNameInput = ref(null)
const renamingProfile = ref(false)
const draftProfileName = ref('')

const startProfileRename = async () => {
  if (!isSavedProfile.value) return
  draftProfileName.value = selectedProfile.value?.name || ''
  renamingProfile.value = true
  await nextTick()
  profileNameInput.value?.$el?.focus?.()
  profileNameInput.value?.$el?.select?.()
}

/** Blur and Enter both land here, so a name is never committed twice. */
const commitProfileRename = () => {
  if (!renamingProfile.value) return
  renamingProfile.value = false
  const name = draftProfileName.value.trim()
  if (!name || name === selectedProfile.value?.name) return
  profilesApi.updateProfile(selectedProfileId.value, { name })
}

/** Remove the selected profile. See `deleteProfile` in useChatSettings. */
const deleteSelectedProfile = () => deleteProfile(selectedProfileId.value)

const profileMenuItems = computed(() => [
  {
    label: 'New profile',
    icon: 'pi pi-plus',
    // A copy of the one in use, for the same reason a new preset is: the usual
    // reason to reach for one is a variation on what is already there.
    command: () => forkProfile(),
  },
  {
    label: 'Rename profile',
    icon: 'pi pi-pencil',
    disabled: !isSavedProfile.value,
    command: startProfileRename,
  },
  {
    label: 'Delete profile',
    icon: 'pi pi-trash',
    disabled: !isSavedProfile.value,
    command: deleteSelectedProfile,
  },
])
</script>
