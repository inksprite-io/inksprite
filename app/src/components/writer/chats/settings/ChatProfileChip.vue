<template>
  <!-- The same width whatever the profile is called: the column's at the side,
       a fixed one in the strip across the top. -->
  <div class="flex w-44 md:w-auto md:mb-1 flex-none">
    <Button
      v-tooltip.bottom="'Profile'"
      type="button"
      severity="secondary"
      size="small"
      rounded
      class="flex-1 min-w-0 !justify-between !h-8 !py-0 !px-3 !gap-1 !text-sm !bg-transparent !border-transparent hover:!bg-surface-200 dark:hover:!bg-surface-700"
      aria-haspopup="true"
      :aria-controls="menuId"
      :aria-label="`Profile: ${selectedProfile?.name ?? ''}`"
      data-chat-profile
      @click="menu?.toggle($event)"
    >
      <span class="truncate font-medium">{{ selectedProfile?.name }}</span>
      <i class="pi pi-chevron-down !text-[0.625rem] flex-none" aria-hidden="true" />
    </Button>
    <ProfileMenu :id="menuId" ref="menu" :story-id="storyId" :chat-id="chatId" />
  </div>
</template>

<script setup>
import { ref, useId } from 'vue'
import Button from 'primevue/button'
import ProfileMenu from '../ProfileMenu.vue'
import { useChatSettings } from '@/composables/useChatSettings'

/**
 * The profile a chat runs on, at the top of its settings, where every
 * section can see it, and the way to put it on another: switching stamps the
 * new profile's settings over the chat's own, and picking the one it is on
 * puts the chat back as its profile has it. Profiles are made, renamed,
 * deleted and made the default from its menu (`ProfileMenu`).
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} chatId - The chat, which can be the story's unstarted one
 */
const props = defineProps({
  storyId: { type: String, required: true },
  chatId: { type: String, required: true },
})

const { selectedProfile } = useChatSettings(props.storyId, () => props.chatId)

const menuId = `chat_profile_menu_${useId()}`

/** @type {import('vue').Ref<InstanceType<typeof ProfileMenu>|null>} */
const menu = ref(null)
</script>
