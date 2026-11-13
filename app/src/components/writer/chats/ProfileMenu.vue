<template>
  <Menu
    :id="id"
    ref="menu"
    :model="items"
    :popup="true"
    class="!min-w-44 text-sm"
    data-profile-menu
  >
    <template #item="{ item, props: itemProps }">
      <a
        class="flex items-center gap-2 px-3 py-1.5 cursor-pointer"
        v-bind="itemProps.action"
        :class="{
          'rounded-[inherit] bg-[var(--p-highlight-background)] !text-[color:var(--p-highlight-color)]':
            item.profileId && item.profileId === selectedProfileId,
        }"
        :aria-current="item.profileId && item.profileId === selectedProfileId ? 'true' : undefined"
        :data-profile="item.profileId"
        :data-action="item.action"
        @contextmenu="item.profileId && contextMenu?.show($event, item.profileId)"
      >
        <span class="flex-1 truncate">{{ item.label }}</span>
        <span
          v-if="item.isDefault"
          v-tooltip.top="'Default'"
          class="pi pi-star-fill !text-[0.625rem] text-surface-400"
          aria-label="Default"
          data-default-profile
        />
      </a>
    </template>
  </Menu>
  <ProfileContextMenu
    ref="contextMenu"
    :story-id="storyId"
    :chat-id="chatId"
    @rename="startRename"
  />
  <ProfileNameDialog
    v-model:visible="naming"
    :header="renaming ? 'Rename profile' : 'New profile'"
    :action="renaming ? 'Rename' : 'Create'"
    :name="draftName"
    @save="saveName"
  />
</template>

<script setup>
import { computed, ref } from 'vue'
import Menu from 'primevue/menu'
import ProfileContextMenu from './ProfileContextMenu.vue'
import ProfileNameDialog from './ProfileNameDialog.vue'
import { useChatSettings } from '@/composables/useChatSettings'
import { useProfiles } from '@/composables/useProfiles'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'

/**
 * The profiles, to put a chat on one: the one it is on tinted as a
 * select's choice is, the default starred, New profile… after them, a copy of the chat's settings under
 * a name asked for, which the chat moves onto, and Prompts… at the end, which
 * opens the chat's prompts in the settings. A right click on one is its
 * own menu: Set as default, and on the writer's own Rename… and Delete. The
 * profile chip under the message box and the one atop the chat's settings
 * open the same menu.
 *
 * @typedef {Object} Props
 * @property {string} id - The menu's element id, for its button's aria-controls
 * @property {string} storyId
 * @property {string} chatId - The chat, which can be the story's unstarted one
 */
const props = defineProps({
  id: { type: String, required: true },
  storyId: { type: String, required: true },
  chatId: { type: String, required: true },
})

const { profiles, selectedProfileId, setProfile, newProfile } = useChatSettings(
  props.storyId,
  () => props.chatId
)
const profilesApi = useProfiles()
const settingsPanel = useSettingsPanel()

/** @type {import('vue').Ref<any>} */
const menu = ref(null)
/** @type {import('vue').Ref<{ show: (event: Event, id: string) => void }|null>} */
const contextMenu = ref(null)

/** Whether a name is being asked for, and for which profile when renaming. */
const naming = ref(false)
const renaming = ref(/** @type {string|null} */ (null))
const draftName = ref('')

const items = computed(() => {
  const starred = profilesApi.chatDefaultId()
  return [
    ...profiles.value.map(profile => ({
      label: profile.name,
      profileId: profile.id,
      isDefault: profile.id === starred,
      command: () => setProfile(profile.id),
    })),
    { separator: true },
    {
      label: 'New profile…',
      action: 'new-profile',
      command: () => {
        renaming.value = null
        draftName.value = profilesApi.freeProfileName('New Profile')
        naming.value = true
      },
    },
    { separator: true },
    {
      label: 'Prompts…',
      action: 'prompts',
      command: () => settingsPanel.open('prompts'),
    },
  ]
})

/** @param {string} id */
const startRename = id => {
  renaming.value = id
  draftName.value = profilesApi.getProfile(id)?.name ?? ''
  naming.value = true
}

/**
 * Make the new profile under this name, or rename the one asked for, to a
 * name no other profile has.
 * @param {string} name
 */
const saveName = name => {
  const id = renaming.value
  if (!id) {
    newProfile(name)
    return
  }
  if (name === profilesApi.getProfile(id)?.name) return
  profilesApi.updateProfile(id, { name: profilesApi.freeProfileName(name) })
}

defineExpose({
  /** @param {Event} event - The click on the button the menu opens from */
  toggle: event => menu.value?.toggle(event),
})
</script>
