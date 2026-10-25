<template>
  <div class="flex flex-col">
    <!-- Each extension opens onto its own settings while it is on, with its
         switch in its header, as a tool group's is in a chat's settings. -->
    <ExpandableSection
      title="Roleplay"
      storage-key="ui.settings.extensions.roleplay"
      subsection
      :disabled="!roleplayOn"
      container-class="pt-1"
      content-wrapper-class="flex flex-col"
      data-extension="roleplay"
    >
      <template #actions>
        <ToggleSwitch
          :model-value="roleplayOn"
          class="flex-none"
          aria-label="Roleplay"
          data-extension-switch="roleplay"
          @update:model-value="switchRoleplay"
        />
      </template>
      <div class="flex flex-col gap-3 pt-2 pb-1">
        <div class="flex flex-col gap-1">
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
        <div class="flex items-center justify-between gap-2">
          <label
            for="nsfw-switch"
            class="text-xs font-medium text-surface-700 dark:text-surface-200"
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
        <div class="flex flex-wrap gap-2">
          <Button
            label="Delete card library"
            icon="pi pi-trash"
            size="small"
            outlined
            severity="danger"
            :disabled="!library.hasCards"
            data-delete-card-library
            @click="confirmDeleteLibrary"
          />
        </div>
      </div>
    </ExpandableSection>

    <ExpandableSection
      v-if="pythonHere"
      title="Python"
      storage-key="ui.settings.extensions.python"
      subsection
      :disabled="!pythonOn"
      container-class="pt-1"
      content-wrapper-class="flex flex-col"
      data-extension="python"
    >
      <template #actions>
        <ToggleSwitch
          :model-value="pythonOn"
          class="flex-none"
          aria-label="Python"
          data-extension-switch="python"
          @update:model-value="on => applicationState.setExtension('python', on)"
        />
      </template>
      <div class="flex flex-col gap-3 pt-2 pb-1">
        <div class="flex flex-col gap-1">
          <label
            for="python-time-limit"
            class="text-xs font-medium text-surface-700 dark:text-surface-200"
            >Time limit</label
          >
          <Select
            input-id="python-time-limit"
            :model-value="applicationState.pythonTimeLimit.value"
            :options="PYTHON_TIME_LIMITS"
            option-label="label"
            option-value="seconds"
            aria-label="Time limit"
            class="w-full dark:!bg-surface-900"
            size="small"
            data-python-time-limit
            @update:model-value="applicationState.setPythonTimeLimit"
          />
        </div>
        <div class="flex flex-col gap-1">
          <span class="text-xs font-medium text-surface-700 dark:text-surface-200">
            Used in chats on
          </span>
          <div class="flex flex-wrap gap-x-4 gap-y-1">
            <label
              v-for="profile in profiles"
              :key="profile.id"
              class="flex items-center gap-2 text-xs"
            >
              <ToggleSwitch
                :model-value="pythonProfileIds.includes(profile.id)"
                :aria-label="`Run Python in chats on ${profile.name}`"
                :data-python-profile="profile.id"
                @update:model-value="setPythonProfile(profile.id, $event)"
              />
              {{ profile.name }}
            </label>
          </div>
        </div>
      </div>
    </ExpandableSection>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import Button from 'primevue/button'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { useProfiles } from '@/composables/useProfiles'
import { useCardLibraryStore } from '@/stores/cardLibraryStore.js'
import { inPreview } from '@/config/preview.js'
import { hasPython } from '@/platform/python.js'
import {
  PYTHON_GROUP,
  PYTHON_TIME_LIMITS,
  pythonProfiles,
  setPythonProfile,
} from '@/ai/tools/python.js'

/**
 * The extensions: parts of the app not every writer wants, each switched on
 * here. Roleplay is character cards, the card library and the roleplay
 * profiles; its settings are the ones only roleplay has. Switching it off
 * hides all of it and deletes nothing, the card library included.
 *
 * Python is the model running code, in the desktop app only, in chats on the
 * profiles listed here or that switch it on themselves. See
 * `ai/tools/python.js`.
 *
 * See `extensions/`.
 */

const applicationState = useApplicationState()
const profilesApi = useProfiles()
const { profiles } = profilesApi
const library = useCardLibraryStore()
const confirm = useConfirm()
const toast = useToast()

/** The switch as it is set, whether or not the AI is on to use it. */
const roleplayOn = computed(() => applicationState.extensionOn('roleplay') === true)

/** Whether Python can run here at all: in the desktop app. */
const pythonHere = inPreview('python') && hasPython()
const pythonOn = computed(() => applicationState.extensionOn(PYTHON_GROUP) === true)

/** The profiles whose chats run Python. */
const pythonProfileIds = computed(() => pythonProfiles())

// As the picker shows it: the NSFW switch puts a built-in's counterpart in
// its place, as it does in a chat.
const roleplayProfile = computed(() => profilesApi.getProfile(profilesApi.roleplayDefaultId())?.id)

/** Empty the library. */
const deleteLibrary = async () => {
  try {
    await library.removeAll()
  } catch (error) {
    toast.add({
      severity: 'error',
      detail: `The card library couldn't be deleted. ${error.message}`,
      life: 6000,
    })
  }
}

const confirmDeleteLibrary = async () => {
  await library.ensureLoaded()
  confirm.require({
    header: 'Delete card library?',
    message:
      library.allCards.length === 1
        ? 'Delete the card in the library?'
        : `Delete all ${library.allCards.length} cards in the library?`,
    icon: 'pi pi-trash',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: deleteLibrary,
  })
}

/**
 * Switched off, roleplay goes at once; the card library is kept for when it
 * is back on.
 *
 * @param {boolean} on
 */
const switchRoleplay = on => applicationState.setExtension('roleplay', on)
</script>
