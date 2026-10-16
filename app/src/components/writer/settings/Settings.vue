<template>
  <SectionLayout v-model="activeId" :sections="sections" label="Settings sections" />
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import SectionLayout from '@/components/common/SectionLayout.vue'
import AiConfigSection from './ai/AiConfigSection.vue'
import WorkflowsSection from './WorkflowsSection.vue'
import SkillsSection from './SkillsSection.vue'
import ConnectionsSection from './ConnectionsSection.vue'
import MagicBookIcon from '@/components/icons/MagicBookIcon.vue'
import SystemSection from './SystemSection.vue'
import AboutSection from './AboutSection.vue'
import ExtensionsSection from './ExtensionsSection.vue'
import ExtensionsIcon from '@/components/icons/ExtensionsIcon.vue'
import SettingsIcon from '@/components/icons/SettingsIcon.vue'
import BookIcon from '@/components/icons/BookIcon.vue'
import AiNetworkIcon from '@/components/icons/AiNetworkIcon.vue'
import NetworkIcon from '@/components/icons/NetworkIcon.vue'
import InProcessIcon from '@/components/icons/InProcessIcon.vue'
import { useAIConfig } from '@/composables/useAIConfig'
import { useApplicationState } from '@/composables/useApplicationState'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'
import { sessionStorage } from '@/utils/sessionStorage'

/**
 * App-wide settings, a section at a time. Reopens on the section last looked
 * at, unless whoever opened them asked for another. With the AI switched off,
 * the sections that are only the AI's are not there, and one of them last
 * looked at opens on the first. System has the switch.
 */

const SECTIONS = [
  { id: 'system', label: 'System', icon: SettingsIcon, component: SystemSection },
  { id: 'ai', label: 'AI', icon: AiNetworkIcon, component: AiConfigSection, ai: true },
  {
    id: 'workflows',
    label: 'Workflows',
    icon: InProcessIcon,
    component: WorkflowsSection,
    ai: true,
  },
  { id: 'skills', label: 'Skills', icon: MagicBookIcon, component: SkillsSection, ai: true },
  {
    id: 'connections',
    label: 'Connections',
    icon: NetworkIcon,
    component: ConnectionsSection,
    ai: true,
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

const { aiEnabled } = useApplicationState()

const sections = computed(() =>
  aiEnabled.value ? SECTIONS : SECTIONS.filter(section => !section.ai)
)

const STORAGE_KEY = 'ui.settings.section'

// Reopens on the section last looked at; settings are usually revisited.
const activeId = ref(
  SECTIONS.some(section => section.id === sessionStorage.get(STORAGE_KEY))
    ? sessionStorage.get(STORAGE_KEY)
    : SECTIONS[0].id
)

const aiConfig = useAIConfig()

// Whoever opened the settings may have asked for a section — a chat with no
// provider wants the AI section, not the one last looked at.
const { requestedSection, takeSection } = useSettingsPanel()
watch(
  requestedSection,
  section => {
    if (section) activeId.value = takeSection() ?? activeId.value
  },
  { immediate: true }
)

onMounted(async () => {
  await aiConfig.init()
})

watch(activeId, id => sessionStorage.set(STORAGE_KEY, id))
</script>
