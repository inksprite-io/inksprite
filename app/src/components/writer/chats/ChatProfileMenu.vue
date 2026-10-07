<template>
  <div class="flex-none min-w-0 max-w-[40%] flex">
    <Button
      v-tooltip.bottom="'Profile'"
      type="button"
      severity="secondary"
      size="small"
      rounded
      class="min-w-0 max-w-full !h-7 !py-0 !px-2 !gap-1 !text-xs !bg-transparent !border-transparent hover:!bg-surface-700"
      aria-haspopup="true"
      :aria-controls="menuId"
      :aria-label="`Profile: ${selectedProfile?.name ?? ''}`"
      data-chat-profile
      @click="menu?.toggle($event)"
    >
      <span class="truncate">{{ selectedProfile?.name }}</span>
      <i class="pi pi-chevron-down !text-[0.625rem] flex-none" aria-hidden="true" />
    </Button>
    <!-- Sized to the button that opens it rather than to PrimeVue's menu,
         which is 12.5rem wide at the least. -->
    <Menu :id="menuId" ref="menu" :model="items" :popup="true" class="!min-w-36 text-xs">
      <template #item="{ item, props: itemProps }">
        <a
          class="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer"
          v-bind="itemProps.action"
          :data-profile="item.profileId"
          @contextmenu="profileMenu?.show($event, item.profileId)"
        >
          <span class="flex-1 truncate">{{ item.label }}</span>
          <span class="pi text-xs" :class="{ 'pi-check': item.profileId === selectedProfileId }" />
        </a>
      </template>
    </Menu>
    <ProfileContextMenu ref="profileMenu" :story-id="props.storyId" :chat-id="props.chatId" />
  </div>
</template>

<script setup>
import { computed, ref, useId } from 'vue'
import { Button } from 'primevue'
import Menu from 'primevue/menu'
import ProfileContextMenu from './ProfileContextMenu.vue'
import { useChatSettings } from '@/composables/useChatSettings'

/**
 * The profile a chat runs on, in its header, and the way to put it on another.
 *
 * Switching stamps the new profile's settings over the chat's own, the same as
 * picking it in the settings; this is the shorter way there. Most use is in a
 * chat not started yet, where there is nothing of its own to stamp over.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} chatId - The chat, which can be the story's unstarted one
 */
const props = defineProps({
  storyId: { type: String, required: true },
  chatId: { type: String, required: true },
})

const { profiles, selectedProfileId, selectedProfile, chooseProfile } = useChatSettings(
  props.storyId,
  () => props.chatId
)

/** @type {import('vue').Ref<any>} */
const menu = ref(null)
const menuId = `chat_profile_menu_${useId()}`

const items = computed(() =>
  profiles.value.map(profile => ({
    label: profile.name,
    profileId: profile.id,
    command: () => chooseProfile(profile.id),
  }))
)

/** @type {import('vue').Ref<any>} */
const profileMenu = ref(null)
</script>
