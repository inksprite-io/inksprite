<template>
  <div
    class="flex flex-col h-full bg-surface-200 dark:bg-surface-700 shrink-0 select-none w-[48px]"
  >
    <div class="flex-1 flex flex-col items-center overflow-y-auto">
      <template v-for="tab in tabs" :key="tab.id">
        <!-- The card library is a window over the writer rather than a list
             of the sidebar's, so it is a button and never shows pressed. -->
        <RailButton
          v-if="tab.id === 'cards'"
          :tooltip="tab.label"
          data-action="cards"
          @click="openCardLibrary()"
        >
          <component :is="tab.icon" :size="24" />
        </RailButton>
        <RailButton
          v-else
          :tooltip="tab.label"
          toggle
          :active="layout.sidebar && layout.sidebarTab === tab.id"
          :dimmed="tab.needsStory && !hasStory"
          :disabled="tab.needsStory && !hasStory"
          :data-tab="tab.id"
          @click="$emit('select-tab', tab.id)"
        >
          <component :is="tab.icon" :size="24" />
        </RailButton>
      </template>
    </div>

    <div class="flex flex-col items-center">
      <div class="border-t border-surface-0 dark:border-surface-600 my-2 w-[80%]" />
      <!-- The jobs are not a list of the sidebar's but a toast of their own,
           which this opens and closes, there while there are any -->
      <RailButton
        v-if="jobsStore.hasJobs"
        tooltip="Jobs"
        toggle
        :active="jobsToast.state.open"
        :badge="jobsStore.runningCount"
        data-action="jobs"
        @click="jobsToast.toggle()"
      >
        <InProcessIcon :size="24" />
      </RailButton>
      <RailButton tooltip="Settings" data-action="settings" @click="$emit('open-settings')">
        <SettingsIcon :size="24" />
      </RailButton>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import CardsIcon from '@/components/icons/CardsIcon.vue'
import ChatBubbleIcon from '@/components/icons/ChatBubbleIcon.vue'
import CommentIcon from '@/components/icons/CommentIcon.vue'
import InProcessIcon from '@/components/icons/InProcessIcon.vue'
import SearchIcon from '@/components/icons/SearchIcon.vue'
import SettingsIcon from '@/components/icons/SettingsIcon.vue'
import SpeakerIcon from '@/components/icons/SpeakerIcon.vue'
import StoryboardIcon from '@/components/icons/StoryboardIcon.vue'
import RailButton from './RailButton.vue'
import { AI_SIDEBAR_TABS, SIDEBAR_TABS } from './layout.js'
import { useJobsStore } from '@/stores/jobsStore.js'
import { useJobsToast } from '@/composables/useJobsToast.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { useCardLibraryPanel } from '@/composables/useCardLibraryPanel.js'

/**
 * The rail. Top to bottom: what the sidebar can show — the outline, the
 * search, the chats, the narration, the comments — with the card library under the
 * chats while roleplay is on; then, at the foot, the jobs toast's button,
 * while there are jobs, and the settings. Picking the list showing hides the
 * sidebar, which is how it is hidden; the editor and the chat hide each other
 * from their own headers. With the AI switched off, the chats, the narration
 * and the cards are not there.
 * The projects are switched from the top of the outline.
 *
 * @typedef {Object} Props
 * @property {import('@/types/models.js').StoryLayout} layout - Which panels are showing
 * @property {boolean} [hasStory] - Whether a project is open. Without one only
 *   the jobs and the settings mean anything.
 */
defineProps({
  layout: {
    type: Object,
    required: true,
  },
  hasStory: {
    type: Boolean,
    default: true,
  },
})

defineEmits(['select-tab', 'open-settings'])

const jobsStore = useJobsStore()

const jobsToast = useJobsToast()

const { open: openCardLibrary } = useCardLibraryPanel()

const { aiEnabled, roleplay } = useApplicationState()

const TABS = [
  { id: SIDEBAR_TABS.OUTLINE, label: 'Outline', icon: StoryboardIcon, needsStory: true },
  { id: SIDEBAR_TABS.SEARCH, label: 'Search', icon: SearchIcon, needsStory: true },
  { id: SIDEBAR_TABS.CHATS, label: 'Chats', icon: ChatBubbleIcon, needsStory: true },
  { id: SIDEBAR_TABS.NARRATION, label: 'Narration', icon: SpeakerIcon, needsStory: true },
  { id: SIDEBAR_TABS.COMMENTS, label: 'Comments', icon: CommentIcon, needsStory: true },
]

/** Not a list of the sidebar's: the button that opens the card library. */
const CARDS = { id: 'cards', label: 'Character cards', icon: CardsIcon, needsStory: false }

const tabs = computed(() => {
  if (!aiEnabled.value) return TABS.filter(tab => !AI_SIDEBAR_TABS.includes(tab.id))
  if (!roleplay.value) return TABS
  const chats = TABS.findIndex(tab => tab.id === SIDEBAR_TABS.CHATS)
  return [...TABS.slice(0, chats + 1), CARDS, ...TABS.slice(chats + 1)]
})
</script>
