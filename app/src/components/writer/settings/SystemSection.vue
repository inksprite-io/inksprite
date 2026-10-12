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
        aria-label="Theme"
        class="w-full dark:!bg-surface-900"
        size="small"
        @change="handleThemeChange"
      />
    </div>

    <div class="flex flex-col gap-1 px-2 pt-1 pb-2">
      <div class="flex items-center justify-between gap-2">
        <label
          for="compact-text-switch"
          class="text-xs font-medium text-surface-700 dark:text-surface-200"
          >Compact text</label
        >
        <ToggleSwitch
          :model-value="applicationState.compactText.value"
          input-id="compact-text-switch"
          class="flex-none"
          data-compact-text
          @update:model-value="applicationState.setCompactText"
        />
      </div>
    </div>

    <div class="flex flex-col gap-1 px-2 pt-1 pb-2">
      <div class="flex items-center justify-between gap-2">
        <label for="debug-switch" class="text-xs font-medium text-surface-700 dark:text-surface-200"
          >Debug</label
        >
        <ToggleSwitch v-model="debug" input-id="debug-switch" class="flex-none" data-debug />
      </div>
    </div>

    <h3 class="px-2 pt-4 pb-1 text-sm font-semibold text-surface-700 dark:text-surface-200">
      Chats
    </h3>
    <div class="flex flex-col gap-1 px-2 pt-1 pb-2">
      <label for="chat-profile" class="text-xs font-medium text-surface-700 dark:text-surface-200"
        >Profile for new chats</label
      >
      <Select
        input-id="chat-profile"
        :model-value="chatProfile"
        :options="profiles"
        option-label="name"
        option-value="id"
        aria-label="Profile for new chats"
        class="w-full dark:!bg-surface-900"
        size="small"
        data-chat-profile
        @update:model-value="applicationState.setChatProfileId"
      />
    </div>
    <div class="flex flex-col gap-1 px-2 pt-1 pb-2">
      <label
        for="roleplay-profile"
        class="text-xs font-medium text-surface-700 dark:text-surface-200"
        >Profile for character cards</label
      >
      <Select
        input-id="roleplay-profile"
        :model-value="roleplayProfile"
        :options="profiles"
        option-label="name"
        option-value="id"
        aria-label="Profile for character cards"
        class="w-full dark:!bg-surface-900"
        size="small"
        data-roleplay-profile
        @update:model-value="applicationState.setRoleplayProfileId"
      />
    </div>
    <div class="flex flex-col gap-1 px-2 pt-1 pb-2">
      <div class="flex items-center justify-between gap-2">
        <label for="nsfw-switch" class="text-xs font-medium text-surface-700 dark:text-surface-200"
          >Enable NSFW chat profiles</label
        >
        <ToggleSwitch
          :model-value="applicationState.nsfwProfiles.value"
          input-id="nsfw-switch"
          class="flex-none"
          data-nsfw-profiles
          @update:model-value="applicationState.setNsfwProfiles"
        />
      </div>
    </div>

    <h3 class="px-2 pt-4 pb-1 text-sm font-semibold text-surface-700 dark:text-surface-200">
      Data
    </h3>
    <LibrarySection v-if="desktop" />
    <DataSection />
  </div>
</template>

<script setup>
import { computed, ref, watch, onMounted } from 'vue'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import DataSection from './DataSection.vue'
import LibrarySection from './LibrarySection.vue'
import { isDesktop } from '@/platform/desktop.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { useProfiles } from '@/composables/useProfiles'
import { applyTheme } from '@/composables/useSystemSettings.js'
import { useMessagesStore } from '@/stores/messagesStore'

const applicationState = useApplicationState()
const desktop = isDesktop()
const { theme, setTheme } = applicationState
const messagesStore = useMessagesStore()
const profilesApi = useProfiles()
const { profiles } = profilesApi

// The profiles chats start on, as the pickers show them: the NSFW switch puts
// a built-in's counterpart in its place, as it does in a chat.
const chatProfile = computed(() => profilesApi.getProfile(profilesApi.chatDefaultId())?.id)
const roleplayProfile = computed(() => profilesApi.getProfile(profilesApi.roleplayDefaultId())?.id)

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
