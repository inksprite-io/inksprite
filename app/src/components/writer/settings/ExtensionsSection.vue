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
      title="Web search"
      storage-key="ui.settings.extensions.web"
      subsection
      :disabled="!webOn"
      container-class="pt-1"
      content-wrapper-class="flex flex-col"
      data-extension="web"
    >
      <template #actions>
        <ToggleSwitch
          :model-value="webOn"
          class="flex-none"
          aria-label="Web search"
          data-extension-switch="web"
          @update:model-value="on => applicationState.setExtension('web', on)"
        />
      </template>
      <div class="flex flex-col gap-3 pt-2 pb-1">
        <div class="flex flex-col gap-1">
          <label
            for="web-service"
            class="text-xs font-medium text-surface-700 dark:text-surface-200"
            >Search with</label
          >
          <Select
            input-id="web-service"
            :model-value="webChoice"
            :options="webServices"
            option-label="name"
            option-value="id"
            placeholder="Choose a service"
            aria-label="Search with"
            class="w-full dark:!bg-surface-900"
            size="small"
            data-web-service-choice
            @update:model-value="web.choose"
          />
          <p
            v-if="webProblem"
            class="m-0 text-xs text-red-600 dark:text-red-400"
            data-web-service-problem
          >
            {{ webProblem }}
            <button
              type="button"
              class="underline"
              data-action="open-connections"
              @click="settingsPanel.open('connections', 'web')"
            >
              Open Connections
            </button>
          </p>
        </div>
        <div class="flex items-center justify-between gap-2">
          <label
            for="web-ask-before-saving"
            class="text-xs font-medium text-surface-700 dark:text-surface-200"
            >Ask before saving pages</label
          >
          <ToggleSwitch
            :model-value="!web.setup.value.saveWithoutAsking"
            input-id="web-ask-before-saving"
            class="flex-none"
            data-field="web-ask-before-saving"
            @update:model-value="web.setAskBeforeSaving"
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
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'
import { useWebSearch } from '@/composables/useWebSearch.js'
import { serviceInUse } from '@/web/config.js'
import { hasPython } from '@/platform/python.js'
import { PYTHON_GROUP, PYTHON_TIME_LIMITS } from '@/ai/tools/python.js'

/**
 * The extensions: parts of the app not every writer wants, each switched on
 * here. Roleplay is character cards, the card library and the roleplay
 * profiles; its settings are the ones only roleplay has. Switching it off
 * hides all of it and deletes nothing, the card library included.
 *
 * Web search is the model searching the web and reading pages, through the
 * service chosen here, on from the start. Its services' keys are in
 * Settings › Connections, which lists them only while it is on. See `web/`.
 *
 * Python is the model running code, in the desktop app only, in the chats
 * that have it on among their tools. See `ai/tools/python.js`.
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
const pythonHere = hasPython()
const pythonOn = computed(() => applicationState.extensionOn(PYTHON_GROUP) === true)

const web = useWebSearch()
const settingsPanel = useSettingsPanel()
const webOn = computed(() => applicationState.extensionOn('web') !== false)

/** The services this copy of the app can reach. */
const webServices = web.services.filter(web.reachable)

/** The service chosen, where it can be reached from here. */
const webChoice = computed(() => {
  const id = web.setup.value.service
  return webServices.some(service => service.id === id) ? id : null
})

/**
 * What stands between the service chosen and a search: it refused its key,
 * or it has none and needs one. Both are put right in Connections.
 */
const webProblem = computed(() => {
  const service = webServices.find(one => one.id === webChoice.value)
  if (!service) return ''
  const check = web.checks.value[service.id]
  if (check && 'error' in check) return check.error
  return serviceInUse(web.setup.value) ? '' : `${service.name} needs a key.`
})

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
