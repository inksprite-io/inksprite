<template>
  <SectionLayout
    v-model="activeId"
    :part="parts[activeId]"
    :sections="sections"
    label="Settings sections"
    @update:part="parts = { ...parts, [activeId]: $event }"
  >
    <!-- The profile the chat showing runs on, over the sections that are its
         own: its prompts, its tools, and its profile's wording of the skills. -->
    <template v-if="chatId" #nav-start>
      <ChatProfileChip :key="chatId" :story-id="storyId" :chat-id="chatId" />
    </template>
  </SectionLayout>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import SectionLayout from '@/components/common/SectionLayout.vue'
import SkillsSection from './SkillsSection.vue'
import ConnectionsSection from './ConnectionsSection.vue'
import ModelsSection from './ModelsSection.vue'
import ChipIcon from '@/components/icons/ChipIcon.vue'
import ChatPrompts from '../chats/settings/ChatPrompts.vue'
import ChatTools from '../chats/settings/ChatTools.vue'
import ChatProfileChip from '../chats/settings/ChatProfileChip.vue'
import PenIcon from '@/components/icons/PenIcon.vue'
import AiNetworkIcon from '@/components/icons/AiNetworkIcon.vue'
import { useChatTabs } from '@/composables/useChatTabs.js'
import MagicBookIcon from '@/components/icons/MagicBookIcon.vue'
import SystemSection from './SystemSection.vue'
import SyncSection from './SyncSection.vue'
import ProjectSection from './ProjectSection.vue'
import AboutSection from './AboutSection.vue'
import ExtensionsSection from './ExtensionsSection.vue'
import ExtensionsIcon from '@/components/icons/ExtensionsIcon.vue'
import SettingsIcon from '@/components/icons/SettingsIcon.vue'
import CloudIcon from '@/components/icons/CloudIcon.vue'
import StoryboardIcon from '@/components/icons/StoryboardIcon.vue'
import BookIcon from '@/components/icons/BookIcon.vue'
import NetworkIcon from '@/components/icons/NetworkIcon.vue'
import { useAIConfig } from '@/composables/useAIConfig'
import { useApplicationState } from '@/composables/useApplicationState'
import { useCloudSync } from '@/composables/useCloudSync.js'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'
import { sessionStorage } from '@/utils/sessionStorage'

/**
 * The settings, a section at a time: the app's, the project open's in a
 * section of its own, which is there only while one is open, and those of
 * the chat showing in it, under the profile it runs on, which stands over
 * the list: its **Prompts**, a roleplay chat's scene under them, and its
 * **Tools**. **Models** picks its model, and **Skills** words the built-ins
 * for its profile. The writer
 * does not care which row a setting is stored on; they care that there is
 * one place to look.
 *
 * **Sync and sharing** and **Connections** are shown a part at a time, the
 * parts listed under the section while it is open.
 *
 * Reopens on the section last looked at, and the part of it, unless whoever opened them asked
 * for another. With the AI switched off, the sections that are only the AI's
 * are not there, and one of them last looked at opens on the first. System
 * has the switch.
 *
 * @typedef {Object} Props
 * @property {string} [storyId] - The project open, if one is
 */
const props = defineProps({
  storyId: { type: String, default: '' },
})

const SECTIONS = [
  { id: 'system', label: 'System', icon: SettingsIcon, component: SystemSection },
  { id: 'sync', label: 'Sync and sharing', icon: CloudIcon, component: SyncSection },
  {
    id: 'project',
    label: 'Project',
    icon: StoryboardIcon,
    component: ProjectSection,
    project: true,
  },
  { id: 'prompts', label: 'Prompts', icon: PenIcon, component: ChatPrompts, chat: true },
  {
    id: 'connections',
    label: 'Connections',
    icon: NetworkIcon,
    component: ConnectionsSection,
    ai: true,
  },
  // After Connections, as setting up goes: a connection, then its models.
  {
    id: 'models',
    label: 'Models',
    icon: ChipIcon,
    component: ModelsSection,
    ai: true,
    chat: 'given',
  },
  { id: 'tools', label: 'Tools', icon: AiNetworkIcon, component: ChatTools, chat: true },
  {
    id: 'skills',
    label: 'Skills',
    icon: MagicBookIcon,
    component: SkillsSection,
    ai: true,
    chat: 'given',
  },
  // Only the AI's for now, since the one extension there is all for chats.
  {
    id: 'extensions',
    label: 'Extensions',
    icon: ExtensionsIcon,
    component: ExtensionsSection,
    ai: true,
  },
  { id: 'about', label: 'About', icon: BookIcon, component: AboutSection },
]

const { aiEnabled, webSearch } = useApplicationState()

const { requestedSection, requestedProject, takeSection, takePart, close } = useSettingsPanel()

const { account } = useCloudSync()

/**
 * The sections shown a part at a time, and their parts: an account's people
 * and devices once signed in, and web search's services while its extension
 * is on.
 * @type {import('vue').ComputedRef<Record<string, {id: string, label: string}[]>>}
 */
const partsOf = computed(() => ({
  sync: [
    { id: 'account', label: 'Account' },
    ...(account.value
      ? [
          { id: 'people', label: 'People' },
          { id: 'devices', label: 'Devices' },
        ]
      : []),
    { id: 'backup', label: 'Backup' },
  ],
  connections: [
    { id: 'providers', label: 'AI providers' },
    { id: 'mcp', label: 'MCP servers' },
    ...(webSearch.value ? [{ id: 'web', label: 'Web search' }] : []),
  ],
}))

/**
 * The chat whose settings these are: the one showing in the project open,
 * which can be its unstarted one. None with the AI off, or no project open.
 */
const chatId = computed(() =>
  aiEnabled.value && props.storyId ? useChatTabs(props.storyId).activeChatId.value : null
)

/** The project whose section this is: one asked for from a list, or the one open. */
const projectId = computed(() => requestedProject.value || props.storyId)

// Asked for once: the settings open on the project open next time.
onBeforeUnmount(() => {
  requestedProject.value = null
})

const sections = computed(() =>
  SECTIONS.filter(
    section =>
      (aiEnabled.value || !section.ai) &&
      (projectId.value || !section.project) &&
      (chatId.value || section.chat !== true)
  ).map(section => {
    if (partsOf.value[section.id]) return { ...section, parts: partsOf.value[section.id] }
    // The project's is keyed on it, so that another project's opens fresh.
    if (section.project) {
      return { ...section, props: { storyId: projectId.value, key: projectId.value } }
    }
    // A chat's are keyed on it, and close the settings for what they open
    // in their place: a prompt in the editor.
    if (section.chat && chatId.value) {
      return {
        ...section,
        props: {
          storyId: props.storyId,
          chatId: chatId.value,
          key: `${section.id}:${chatId.value}`,
          onClose: close,
        },
      }
    }
    return section
  })
)

const STORAGE_KEY = 'ui.settings.section'

// Reopens on the section last looked at; settings are usually revisited.
const activeId = ref(
  SECTIONS.some(section => section.id === sessionStorage.get(STORAGE_KEY))
    ? sessionStorage.get(STORAGE_KEY)
    : SECTIONS[0].id
)

const PARTS_KEY = 'ui.settings.parts'

/**
 * The part each section was last on, reopened as the section is.
 * @type {import('vue').Ref<Record<string, string>>}
 */
const parts = ref({ ...(sessionStorage.get(PARTS_KEY) ?? {}) })
watch(parts, value => sessionStorage.set(PARTS_KEY, value))

const aiConfig = useAIConfig()

// Whoever opened the settings may have asked for a section — a chat with no
// provider wants the AI section, not the one last looked at.
watch(
  requestedSection,
  section => {
    if (!section) return
    activeId.value = takeSection() ?? activeId.value
    // A part of a section shown a part at a time is opened here; any other
    // is the section's own to open.
    if (partsOf.value[activeId.value]) {
      const part = takePart()
      if (part) parts.value = { ...parts.value, [activeId.value]: part }
    }
  },
  { immediate: true }
)

onMounted(async () => {
  await aiConfig.init()
})

watch(activeId, id => sessionStorage.set(STORAGE_KEY, id))
</script>
