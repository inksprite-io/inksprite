<template>
  <div class="flex flex-col">
    <div class="flex flex-col gap-1 px-2 pt-1 pb-2">
      <label class="text-xs font-medium text-surface-700 dark:text-surface-200">Theme</label>
      <Select
        id="theme-select"
        v-model="selectedTheme"
        :options="themeOptions"
        option-label="label"
        option-value="value"
        placeholder="Select a theme"
        class="w-full dark:!bg-surface-900"
        size="small"
        @change="handleThemeChange"
      />
    </div>

    <div class="flex flex-col gap-1 px-2 pt-1 pb-2">
      <div class="flex items-center justify-between gap-2">
        <label for="nsfw-switch" class="text-xs font-medium text-surface-700 dark:text-surface-200"
          >Enable NSFW chat profiles</label
        >
        <ToggleSwitch
          v-model="nsfwProfiles"
          input-id="nsfw-switch"
          class="flex-none"
          data-nsfw-profiles
        />
      </div>
      <p class="text-xs text-surface-500 dark:text-surface-400">
        Adds Roleplay (NSFW) to the profiles, for adults. With this off, chats already on it run as
        Roleplay.
      </p>
    </div>

    <div class="flex flex-col gap-1 px-2 pt-1 pb-2">
      <div class="flex items-center justify-between gap-2">
        <label for="debug-switch" class="text-xs font-medium text-surface-700 dark:text-surface-200"
          >Debug</label
        >
        <ToggleSwitch v-model="debug" input-id="debug-switch" class="flex-none" data-debug />
      </div>
      <p class="text-xs text-surface-500 dark:text-surface-400">
        Keeps the request behind each reply, which makes long chats heavy.
      </p>
    </div>

    <h3 class="px-2 pt-4 pb-1 text-sm font-semibold text-surface-700 dark:text-surface-200">
      Data
    </h3>
    <DataSection />
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import DataSection from './DataSection.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { applyTheme } from '@/composables/useSystemSettings.js'
import { useMessagesStore } from '@/stores/messagesStore'

const applicationState = useApplicationState()
const { theme, setTheme } = applicationState
const messagesStore = useMessagesStore()

const nsfwProfiles = computed({
  get: () => applicationState.nsfwProfiles.value,
  set: value => applicationState.setNsfwProfiles(value),
})

// Switched off, it forgets what it kept. A saved request is as large as the
// conversation behind it, and in a long chat kept with it on they came to most
// of what the chat took to open and to hold in memory.
const debug = computed({
  get: () => applicationState.debug.value,
  set: value => {
    applicationState.setDebug(value)
    if (!value) {
      messagesStore
        .forgetSavedRequests()
        .catch(error => console.error('Failed to forget saved requests:', error))
    }
  },
})

const themeOptions = [
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
  { label: 'System', value: 'system' },
]

const selectedTheme = ref(theme.value || 'system')

watch(
  selectedTheme,
  newTheme => {
    setTheme(newTheme)
    applyTheme(newTheme)
  },
  { immediate: false }
)

watch(theme, newValue => {
  selectedTheme.value = newValue
})

const handleThemeChange = event => {
  const newTheme = event.value || selectedTheme.value
  setTheme(newTheme)
  applyTheme(newTheme)
}

onMounted(() => {
  applyTheme(theme.value)

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  mediaQuery.addEventListener('change', () => {
    if (theme.value === 'system') {
      applyTheme('system')
    }
  })
})
</script>
