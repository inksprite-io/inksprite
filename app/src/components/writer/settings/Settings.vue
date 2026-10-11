<template>
  <div class="flex flex-col md:flex-row h-full min-h-0 bg-surface-0 dark:bg-surface-800">
    <!-- The sections, down the side where there is room and across the top
         where there is not. Across the top it is swiped, as a phone's strips
         are, and draws no scrollbar. -->
    <nav
      ref="strip"
      class="flex md:flex-col md:w-44 shrink-0 gap-1 p-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b md:border-b-0 md:border-r border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-900/40"
      aria-label="Settings sections"
    >
      <button
        v-for="section in SECTIONS"
        :key="section.id"
        type="button"
        class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left whitespace-nowrap transition-colors duration-150 text-surface-700 dark:text-surface-200"
        :class="
          section.id === activeId
            ? 'bg-surface-200 dark:bg-surface-700 font-semibold'
            : 'hover:bg-surface-200/60 dark:hover:bg-surface-700/60'
        "
        :aria-current="section.id === activeId ? 'page' : undefined"
        :data-section="section.id"
        @click="activeId = section.id"
      >
        <component :is="section.icon" :size="18" class="text-surface-600 dark:text-surface-300" />
        <span>{{ section.label }}</span>
      </button>
    </nav>

    <ScrollPanel class="flex-1 min-w-0 min-h-0">
      <div class="p-4 pb-16 max-w-2xl">
        <h2 class="text-base font-semibold text-surface-800 dark:text-surface-100 mb-3">
          {{ active.label }}
        </h2>
        <component :is="active.component" />
      </div>
    </ScrollPanel>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import ScrollPanel from 'primevue/scrollpanel'
import AiConfigSection from './ai/AiConfigSection.vue'
import NarrationSection from './NarrationSection.vue'
import WorkflowsSection from './WorkflowsSection.vue'
import SkillsSection from './SkillsSection.vue'
import ConnectionsSection from './ConnectionsSection.vue'
import AiIcon from '@/components/icons/AiIcon.vue'
import MagicBookIcon from '@/components/icons/MagicBookIcon.vue'
import SystemSection from './SystemSection.vue'
import AboutSection from './AboutSection.vue'
import SettingsIcon from '@/components/icons/SettingsIcon.vue'
import BookIcon from '@/components/icons/BookIcon.vue'
import AiNetworkIcon from '@/components/icons/AiNetworkIcon.vue'
import SpeakerIcon from '@/components/icons/SpeakerIcon.vue'
import ElectronicsIcon from '@/components/icons/ElectronicsIcon.vue'
import { useAIConfig } from '@/composables/useAIConfig'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'
import { sessionStorage } from '@/utils/sessionStorage'

/**
 * App-wide settings: one section at a time, picked from a list. Sized to fill
 * whatever holds it — a dialog on the desktop, a tab on a phone.
 */

const SECTIONS = [
  { id: 'system', label: 'System', icon: SettingsIcon, component: SystemSection },
  { id: 'ai', label: 'AI', icon: AiNetworkIcon, component: AiConfigSection },
  { id: 'narration', label: 'Narration', icon: SpeakerIcon, component: NarrationSection },
  { id: 'workflows', label: 'Workflows', icon: AiIcon, component: WorkflowsSection },
  { id: 'skills', label: 'Skills', icon: MagicBookIcon, component: SkillsSection },
  {
    id: 'connections',
    label: 'Connections',
    icon: ElectronicsIcon,
    component: ConnectionsSection,
  },
  { id: 'about', label: 'About', icon: BookIcon, component: AboutSection },
]

const STORAGE_KEY = 'ui.settings.section'

// Reopens on the section last looked at; settings are usually revisited.
const activeId = ref(
  SECTIONS.some(section => section.id === sessionStorage.get(STORAGE_KEY))
    ? sessionStorage.get(STORAGE_KEY)
    : SECTIONS[0].id
)

const active = computed(
  () => SECTIONS.find(section => section.id === activeId.value) ?? SECTIONS[0]
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

/** @type {import('vue').Ref<HTMLElement|null>} */
const strip = ref(null)

/**
 * Bring the open section's button into the strip's view. Across the top of a
 * phone, the one reopened on may be past the edge, and nothing would say
 * which section this is.
 */
const showActive = () => {
  strip.value
    ?.querySelector('[aria-current="page"]')
    ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

onMounted(async () => {
  showActive()
  await aiConfig.init()
})

watch(activeId, async id => {
  sessionStorage.set(STORAGE_KEY, id)
  await nextTick()
  showActive()
})
</script>
