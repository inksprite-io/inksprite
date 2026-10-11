<template>
  <div
    class="flex bg-surface-200 dark:bg-surface-700 shrink-0 select-none border-b border-surface-300 dark:border-surface-600"
  >
    <button
      v-for="tab in TABS"
      :key="tab.id"
      type="button"
      :class="[
        BUTTON,
        tab.needsStory && !hasStory
          ? 'opacity-50 cursor-default'
          : 'cursor-pointer hover:bg-primary-200 hover:dark:bg-primary-emphasis',
        { [PRESSED]: activeMobileTab === tab.id },
      ]"
      :aria-label="tab.label"
      :aria-pressed="activeMobileTab === tab.id"
      :aria-disabled="(tab.needsStory && !hasStory) || undefined"
      :data-tab="tab.id"
      @click="(!tab.needsStory || hasStory) && $emit('update:activeMobileTab', tab.id)"
    >
      <component :is="tab.icon" :size="20" />
    </button>

    <!-- Everything else, the jobs among it: shown as the one in use while one
         of its views is, and carrying the count of jobs running, since the
         jobs have no button of their own here. -->
    <button
      type="button"
      :class="[
        BUTTON,
        'cursor-pointer hover:bg-primary-200 hover:dark:bg-primary-emphasis',
        { [PRESSED]: inMenu },
      ]"
      aria-label="More"
      aria-haspopup="true"
      aria-controls="mobile_more_menu"
      :aria-expanded="menuOpen"
      data-action="more"
      @click="menu?.toggle($event)"
    >
      <span class="relative flex">
        <span class="pi pi-ellipsis-h text-xl leading-5" aria-hidden="true" />
        <span
          v-if="jobsStore.runningCount"
          class="absolute -top-1.5 -right-2 min-w-4 h-4 px-1 rounded-full bg-primary-500 text-white text-[10px] leading-4 text-center font-semibold"
          data-rail-badge
        >
          {{ jobsStore.runningCount }}
        </span>
      </span>
    </button>

    <Menu
      id="mobile_more_menu"
      ref="menu"
      :model="items"
      :popup="true"
      @show="menuOpen = true"
      @hide="menuOpen = false"
    >
      <template #item="{ item, props: link }">
        <a
          v-bind="link.action"
          class="flex items-center gap-3 px-3 py-2.5"
          :aria-current="item.current || undefined"
          :data-menu-item="item.id"
        >
          <component :is="item.iconComponent" :size="18" />
          <span class="flex-1" :class="{ 'font-semibold': item.current }">{{ item.label }}</span>
          <span
            v-if="item.count"
            class="min-w-4 h-4 px-1 rounded-full bg-primary-500 text-white text-[10px] leading-4 text-center font-semibold"
          >
            {{ item.count }}
          </span>
        </a>
      </template>
    </Menu>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import Menu from 'primevue/menu'
import PenIcon from '@/components/icons/PenIcon.vue'
import StoryboardIcon from '@/components/icons/StoryboardIcon.vue'
import ChatBubbleIcon from '@/components/icons/ChatBubbleIcon.vue'
import CommentIcon from '@/components/icons/CommentIcon.vue'
import SettingsIcon from '@/components/icons/SettingsIcon.vue'
import SpeakerIcon from '@/components/icons/SpeakerIcon.vue'
import InProcessIcon from '@/components/icons/InProcessIcon.vue'
import { useJobsStore } from '@/stores/jobsStore.js'
import { useJobsToast } from '@/composables/useJobsToast.js'

/**
 * The phone's tab bar: the writing, the outline and the chat, one view at a
 * time, and a menu of everything else — the narration, the comments, the
 * jobs toast and the settings.
 *
 * @typedef {Object} Props
 * @property {string} activeMobileTab
 * @property {boolean} [hasStory] - Whether a project is open. Without one only
 *   the writing view, which says so, the jobs and the settings mean anything.
 */
const props = defineProps({
  activeMobileTab: {
    type: String,
    default: 'write',
  },
  hasStory: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits(['update:activeMobileTab'])

const jobsStore = useJobsStore()
const jobsToast = useJobsToast()

/** @type {import('vue').Ref<{toggle: (event: Event) => void}|null>} */
const menu = ref(null)
const menuOpen = ref(false)

// At least 44 px tall, which is as small as a thumb's target should be.
const BUTTON =
  'flex-1 flex items-center min-h-11 p-3 justify-center text-surface-contrast duration-150 transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500'

const PRESSED = 'bg-surface-300 dark:bg-surface-500'

const TABS = [
  { id: 'write', label: 'Write', icon: PenIcon, needsStory: false },
  { id: 'outline', label: 'Outline', icon: StoryboardIcon, needsStory: true },
  { id: 'chat', label: 'Chat', icon: ChatBubbleIcon, needsStory: true },
]

const NARRATION = { id: 'narration', label: 'Narration', icon: SpeakerIcon, needsStory: true }
const COMMENTS = { id: 'comments', label: 'Comments', icon: CommentIcon, needsStory: true }
const SETTINGS = { id: 'settings', label: 'Settings', icon: SettingsIcon, needsStory: false }

/** The views in the menu. */
const MENU_TABS = [NARRATION, COMMENTS, SETTINGS]

/** Whether the view showing is one of the menu's. */
const inMenu = computed(() => MENU_TABS.some(tab => tab.id === props.activeMobileTab))

/** @param {{id: string, label: string, icon: object, needsStory: boolean}} tab */
const viewItem = tab => ({
  id: tab.id,
  label: tab.label,
  iconComponent: tab.icon,
  current: props.activeMobileTab === tab.id,
  disabled: tab.needsStory && !props.hasStory,
  command: () => emit('update:activeMobileTab', tab.id),
})

// The jobs just before the settings, as on the rail: not a view but the jobs
// toast, which this opens and closes.
const items = computed(() => [
  viewItem(NARRATION),
  viewItem(COMMENTS),
  {
    id: 'jobs',
    label: 'Jobs',
    iconComponent: InProcessIcon,
    current: jobsToast.state.open,
    count: jobsStore.runningCount,
    command: () => jobsToast.toggle(),
  },
  viewItem(SETTINGS),
])
</script>
