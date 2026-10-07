<template>
  <div
    class="flex flex-col h-full bg-surface-200 dark:bg-surface-700 shrink-0 select-none w-[48px]"
  >
    <div class="flex-1 flex flex-col items-center overflow-y-auto">
      <RailButton
        v-for="tab in TABS"
        :key="tab.id"
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
    </div>

    <div class="flex flex-col items-center">
      <div class="border-t border-surface-0 dark:border-surface-600 my-2 w-[80%]" />
      <!-- The jobs are not a list of the sidebar's but a toast of their own,
           which this opens and closes -->
      <RailButton
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
import ChatBubbleIcon from '@/components/icons/ChatBubbleIcon.vue'
import InProcessIcon from '@/components/icons/InProcessIcon.vue'
import SettingsIcon from '@/components/icons/SettingsIcon.vue'
import SpeakerIcon from '@/components/icons/SpeakerIcon.vue'
import StoryboardIcon from '@/components/icons/StoryboardIcon.vue'
import RailButton from './RailButton.vue'
import { SIDEBAR_TABS } from './layout.js'
import { useJobsStore } from '@/stores/jobsStore.js'
import { useJobsToast } from '@/composables/useJobsToast.js'

/**
 * The rail. Top to bottom: what the sidebar can show — the outline, the
 * chats, the narration — then, at the foot, the jobs toast's button and the
 * settings. Picking the list showing hides the sidebar, which is how it is
 * hidden; the editor and the chat hide each other from their own headers.
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

const TABS = [
  { id: SIDEBAR_TABS.OUTLINE, label: 'Outline', icon: StoryboardIcon, needsStory: true },
  { id: SIDEBAR_TABS.CHATS, label: 'Chats', icon: ChatBubbleIcon, needsStory: true },
  { id: SIDEBAR_TABS.NARRATION, label: 'Narration', icon: SpeakerIcon, needsStory: true },
]
</script>
