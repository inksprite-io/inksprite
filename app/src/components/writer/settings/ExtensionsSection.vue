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

/**
 * The extensions: parts of the app not every writer wants, each switched on
 * here. Roleplay is character cards, the card library and the roleplay
 * profiles; its settings are the ones only roleplay has. Switching it off
 * hides all of it and deletes nothing, and offers to empty the card library.
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

// As the picker shows it: the NSFW switch puts a built-in's counterpart in
// its place, as it does in a chat.
const roleplayProfile = computed(() => profilesApi.getProfile(profilesApi.roleplayDefaultId())?.id)

/**
 * Empty the library, and say so.
 */
const deleteLibrary = async () => {
  try {
    await library.removeAll()
    toast.add({ severity: 'success', detail: 'Deleted the card library.', life: 4000 })
  } catch (error) {
    toast.add({ severity: 'error', detail: `Not deleted: ${error.message}`, life: 6000 })
  }
}

const confirmDeleteLibrary = async () => {
  await library.ensureLoaded()
  confirm.require({
    header: 'Delete card library?',
    message:
      library.allCards.length === 1
        ? 'Delete the card in the library? Cards in projects stay there.'
        : `Delete all ${library.allCards.length} cards in the library? Cards in projects stay there.`,
    icon: 'pi pi-trash',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: deleteLibrary,
  })
}

/**
 * Switched off, roleplay goes at once, and a library with cards in it asks
 * whether they should go too.
 *
 * @param {boolean} on
 */
const switchRoleplay = async on => {
  applicationState.setExtension('roleplay', on)
  if (on) return
  await library.ensureLoaded()
  if (library.allCards.length === 0) return
  confirm.require({
    header: 'Delete card library?',
    message:
      library.allCards.length === 1
        ? 'The library still has 1 card. Delete it too? Cards in projects stay there.'
        : `The library still has ${library.allCards.length} cards. Delete them too? Cards in projects stay there.`,
    icon: 'pi pi-trash',
    rejectProps: { label: 'Keep', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: deleteLibrary,
  })
}
</script>
