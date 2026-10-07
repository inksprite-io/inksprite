<template>
  <div
    class="flex bg-surface-200 dark:bg-surface-700 shrink-0 select-none border-b border-surface-300 dark:border-surface-600"
  >
    <template v-for="tab in TABS" :key="tab.id">
      <!-- The jobs, just before the settings as on the rail: not a view but
           the jobs toast, which this opens and closes -->
      <button
        v-if="tab.id === 'settings'"
        type="button"
        :class="[
          BUTTON,
          'cursor-pointer hover:bg-primary-200 hover:dark:bg-primary-emphasis',
          { 'bg-surface-300 dark:bg-surface-500': jobsToast.state.open },
        ]"
        aria-label="Jobs"
        :aria-pressed="jobsToast.state.open"
        data-action="jobs"
        @click="jobsToast.toggle()"
      >
        <span class="relative flex">
          <InProcessIcon :size="20" />
          <span
            v-if="jobsStore.runningCount"
            class="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full bg-primary-500 text-white text-[10px] leading-4 text-center font-semibold"
            data-rail-badge
          >
            {{ jobsStore.runningCount }}
          </span>
        </span>
      </button>
      <button
        type="button"
        :class="[
          BUTTON,
          tab.needsStory && !hasStory
            ? 'opacity-50 cursor-default'
            : 'cursor-pointer hover:bg-primary-200 hover:dark:bg-primary-emphasis',
          { 'bg-surface-300 dark:bg-surface-500': activeMobileTab === tab.id },
        ]"
        :aria-label="tab.label"
        :aria-pressed="activeMobileTab === tab.id"
        :aria-disabled="(tab.needsStory && !hasStory) || undefined"
        :data-tab="tab.id"
        @click="(!tab.needsStory || hasStory) && $emit('update:activeMobileTab', tab.id)"
      >
        <component :is="tab.icon" :size="20" />
      </button>
    </template>
  </div>
</template>

<script setup>
import PenIcon from '@/components/icons/PenIcon.vue'
import StoryboardIcon from '@/components/icons/StoryboardIcon.vue'
import ChatBubbleIcon from '@/components/icons/ChatBubbleIcon.vue'
import SettingsIcon from '@/components/icons/SettingsIcon.vue'
import SpeakerIcon from '@/components/icons/SpeakerIcon.vue'
import InProcessIcon from '@/components/icons/InProcessIcon.vue'
import { useJobsStore } from '@/stores/jobsStore.js'
import { useJobsToast } from '@/composables/useJobsToast.js'

/**
 * The phone's tab bar: one view at a time, and the jobs toast's button
 * beside the settings.
 *
 * @typedef {Object} Props
 * @property {string} activeMobileTab
 * @property {boolean} [hasStory] - Whether a project is open. Without one only
 *   the writing view, which says so, the jobs and the settings mean anything.
 */
defineProps({
  activeMobileTab: {
    type: String,
    default: 'write',
  },
  hasStory: {
    type: Boolean,
    default: true,
  },
})

defineEmits(['update:activeMobileTab'])

const jobsStore = useJobsStore()
const jobsToast = useJobsToast()

const BUTTON =
  'flex-1 flex items-center p-3 justify-center text-surface-contrast duration-150 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500'

const TABS = [
  { id: 'write', label: 'Write', icon: PenIcon, needsStory: false },
  { id: 'outline', label: 'Outline', icon: StoryboardIcon, needsStory: true },
  { id: 'chat', label: 'Chat', icon: ChatBubbleIcon, needsStory: true },
  { id: 'narration', label: 'Narration', icon: SpeakerIcon, needsStory: true },
  { id: 'settings', label: 'Settings', icon: SettingsIcon, needsStory: false },
]
</script>
