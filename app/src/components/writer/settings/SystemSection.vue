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
      />
    </div>

    <div class="flex flex-col gap-1 px-2 pt-1 pb-2">
      <div class="flex items-center justify-between gap-2">
        <label for="ai-switch" class="text-xs font-medium text-surface-700 dark:text-surface-200"
          >Enable AI</label
        >
        <ToggleSwitch
          :model-value="applicationState.aiEnabled.value"
          input-id="ai-switch"
          class="flex-none"
          data-ai-enabled
          @update:model-value="applicationState.setAiEnabled"
        />
      </div>
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

    <!-- A phone keeps its keyboard's checker, so the app's isn't offered there. -->
    <ExpandableSection
      v-if="!touch"
      title="Spelling"
      storage-key="ui.settings.spelling"
      subsection
      container-class="pt-2"
      content-wrapper-class="flex flex-col"
    >
      <div class="flex flex-col gap-3 pt-2 pb-1">
        <div class="flex items-center justify-between gap-2">
          <label
            for="spelling-switch"
            class="text-xs font-medium text-surface-700 dark:text-surface-200"
            >Spell checker</label
          >
          <ToggleSwitch
            :model-value="spelling.enabled"
            input-id="spelling-switch"
            class="flex-none"
            data-spelling-enabled
            @update:model-value="applicationState.setSpellingEnabled"
          />
        </div>
        <template v-if="spelling.enabled">
          <div class="flex flex-col gap-1">
            <label
              for="spelling-language"
              class="text-xs font-medium text-surface-700 dark:text-surface-200"
              >Language</label
            >
            <Select
              :model-value="spelling.dialect"
              :options="DIALECTS"
              option-label="label"
              option-value="value"
              input-id="spelling-language"
              class="w-full dark:!bg-surface-900"
              size="small"
              data-spelling-language
              @update:model-value="applicationState.setSpellingDialect"
            />
          </div>
          <div class="flex items-center justify-between gap-2">
            <label
              for="grammar-switch"
              class="text-xs font-medium text-surface-700 dark:text-surface-200"
              >Grammar</label
            >
            <ToggleSwitch
              :model-value="spelling.grammar"
              input-id="grammar-switch"
              class="flex-none"
              data-grammar
              @update:model-value="applicationState.setGrammar"
            />
          </div>
          <div class="flex flex-wrap gap-2">
            <Button
              label="Manage dictionary"
              icon="pi pi-book"
              size="small"
              outlined
              severity="secondary"
              data-manage-dictionary
              @click="dictionaryVisible = true"
            />
          </div>
          <DictionaryDialog v-model:visible="dictionaryVisible" />
        </template>
      </div>
    </ExpandableSection>

    <!-- The chats are the AI's, and go with it. -->
    <ExpandableSection
      v-if="applicationState.aiEnabled.value"
      title="Chats"
      storage-key="ui.settings.chats"
      subsection
      container-class="pt-2"
      content-wrapper-class="flex flex-col"
    >
      <div class="flex flex-col gap-3 pt-2 pb-1">
        <div class="flex flex-col gap-1">
          <label
            for="chat-profile"
            class="text-xs font-medium text-surface-700 dark:text-surface-200"
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
        <div class="flex flex-col gap-1">
          <label
            for="chat-preset"
            class="text-xs font-medium text-surface-700 dark:text-surface-200"
            >Default preset</label
          >
          <Select
            input-id="chat-preset"
            :model-value="aiConfig.activeAIPresetId.value"
            :options="aiConfig.presets.value"
            option-label="name"
            option-value="id"
            aria-label="Default preset"
            class="w-full dark:!bg-surface-900"
            size="small"
            data-chat-preset
            @update:model-value="aiConfig.setActiveAIPreset"
          />
        </div>
        <div class="flex items-center justify-between gap-2">
          <label
            for="ask-before-exploring"
            class="text-xs font-medium text-surface-700 dark:text-surface-200"
            >Ask before exploring large folders</label
          >
          <ToggleSwitch
            :model-value="applicationState.askBeforeExploring.value"
            input-id="ask-before-exploring"
            class="flex-none"
            data-ask-before-exploring
            @update:model-value="applicationState.setAskBeforeExploring"
          />
        </div>
      </div>
    </ExpandableSection>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import Button from 'primevue/button'
import DictionaryDialog from './DictionaryDialog.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { useProfiles } from '@/composables/useProfiles'
import { useAIConfig } from '@/composables/useAIConfig'
import { useMessagesStore } from '@/stores/messagesStore'
import { DIALECTS } from '@/spelling/dialects.js'
import { hasTouchKeyboard } from '@/utils/touch.js'

const applicationState = useApplicationState()
const { theme, setTheme, spelling } = applicationState
// A phone keeps its keyboard's checker, so the editor's isn't offered there.
const touch = hasTouchKeyboard()
const dictionaryVisible = ref(false)
const messagesStore = useMessagesStore()
const profilesApi = useProfiles()
const { profiles } = profilesApi

// The profile new chats start on, as the picker shows it: the NSFW switch puts
// a built-in's counterpart in its place, as it does in a chat.
const chatProfile = computed(() => profilesApi.getProfile(profilesApi.chatDefaultId())?.id)

// The default preset: what a chat runs on when neither it nor its profile names
// one, and a workflow or a job with no provider of its own.
const aiConfig = useAIConfig()

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

// Choosing one is enough: useTheme, in App.vue, puts the page in it.
const selectedTheme = computed({ get: () => theme.value, set: setTheme })
</script>
