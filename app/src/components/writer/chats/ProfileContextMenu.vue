<template>
  <!-- A profile's own menu, on a right click wherever profiles are listed:
       the writer's own can be deleted from here. The built-ins cannot, so
       they have none. -->
  <ContextMenu ref="menu" :model="items" class="!min-w-36 text-xs" />
</template>

<script setup>
import { ref } from 'vue'
import ContextMenu from 'primevue/contextmenu'
import { useChatSettings } from '@/composables/useChatSettings'
import { useProfiles } from '@/composables/useProfiles'

/**
 * The right-click menu for a profile in a list of them: the header's profile
 * menu and the settings' profile picker. Deleting goes through
 * `useChatSettings`, so the chat moves off a profile it was on.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} chatId - The chat the list is for, which can be the
 *   story's unstarted one
 */
const props = defineProps({
  storyId: { type: String, required: true },
  chatId: { type: String, required: true },
})

const { deleteProfile } = useChatSettings(props.storyId, () => props.chatId)
const profilesApi = useProfiles()

/** @type {import('vue').Ref<any>} */
const menu = ref(null)

/** The profile right-clicked, which `items` acts on. */
const profileId = ref(/** @type {string|null} */ (null))

const items = [
  {
    label: 'Delete profile',
    icon: 'pi pi-trash',
    command: () => profileId.value && deleteProfile(profileId.value),
  },
]

/**
 * Open the menu for a profile, if it is one of the writer's own. The
 * browser's own menu is kept off either way, so a right click on a built-in
 * does nothing rather than something unrelated.
 *
 * @param {MouseEvent} event
 * @param {string} id
 */
const show = (event, id) => {
  event.preventDefault()
  if (profilesApi.getProfile(id)?.readOnly !== false) return
  profileId.value = id
  menu.value?.show(event)
}

defineExpose({ show })
</script>
