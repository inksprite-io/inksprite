<template>
  <!-- A profile's own menu, on a right click wherever profiles are listed:
       any can be made the default, and the writer's own renamed or deleted. -->
  <ContextMenu ref="menu" :model="items" data-profile-context-menu />
</template>

<script setup>
import { computed, ref } from 'vue'
import ContextMenu from 'primevue/contextmenu'
import { useChatSettings } from '@/composables/useChatSettings'
import { useProfiles } from '@/composables/useProfiles'
import { useApplicationState } from '@/composables/useApplicationState'

/**
 * The right-click menu for a profile in a list of them: Set as default, for
 * the profile new chats start on where a project hasn't chosen one, and, on
 * the writer's own, Rename… and Delete. Deleting goes through
 * `useChatSettings`, so the chat moves off a profile it was on; renaming is
 * asked of whoever shows the menu, which asks for the name.
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

/** `rename`: the id of the profile to ask a new name for. */
const emit = defineEmits(['rename'])

const { deleteProfile } = useChatSettings(props.storyId, () => props.chatId)
const profilesApi = useProfiles()
const app = useApplicationState()

/** @type {import('vue').Ref<any>} */
const menu = ref(null)

/** The profile right-clicked, which `items` acts on. */
const profileId = ref(/** @type {string|null} */ (null))

const items = computed(() => {
  const id = profileId.value
  const profile = profilesApi.getProfile(id)
  if (!id || !profile) return []
  const isDefault = profilesApi.chatDefaultId() === id
  return [
    {
      label: 'Set as default',
      icon: 'pi pi-star',
      visible: !isDefault,
      command: () => app.setChatProfileId(id),
    },
    {
      label: 'Rename…',
      icon: 'pi pi-pencil',
      visible: !profile.readOnly,
      command: () => emit('rename', id),
    },
    {
      label: 'Delete',
      icon: 'pi pi-trash',
      visible: !profile.readOnly,
      command: () => deleteProfile(id),
    },
  ]
})

/**
 * Open the menu for a profile, where it has anything to offer: a built-in
 * that is already the default has nothing. The browser's own menu is kept
 * off either way, so a right click does nothing rather than something
 * unrelated.
 *
 * @param {MouseEvent} event
 * @param {string} id
 */
const show = (event, id) => {
  event.preventDefault()
  profileId.value = id
  if (!items.value.some(item => item.visible)) return
  menu.value?.show(event)
}

defineExpose({ show })
</script>
