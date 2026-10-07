import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ChatProfileMenu from '@/components/writer/chats/ChatProfileMenu.vue'
import { clearChatsInstances, useChats } from '@/composables/useChats'
import { useChatsStore } from '@/stores/chatsStore'
import { useProfiles } from '@/composables/useProfiles'
import {
  CHAT_PROFILE_ID,
  ROLEPLAY_PROFILE_ID,
  ROLEPLAY_NSFW_PROFILE_ID,
} from '@/ai/profiles/index.js'
import { useProfileNotice } from '@/composables/useProfileNotice.js'
import { useApplicationState } from '@/composables/useApplicationState'

vi.mock('@/stores/db', () => ({ default: {} }))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const mountMenu = chatId =>
  mount(ChatProfileMenu, {
    props: { storyId: 'story_1', chatId },
    attachTo: document.body,
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })

/** Open the menu and pick an entry by what it says. */
const pick = async (wrapper, label) => {
  await wrapper.find('[data-chat-profile]').trigger('click')
  await flushPromises()
  const entry = [...document.body.querySelectorAll('[role="menuitem"]')].find(
    item => item.textContent.trim() === label
  )
  entry.querySelector('a').click()
  await flushPromises()
}

/** Open the menu and right-click an entry by what it says. */
const rightClick = async (wrapper, label) => {
  await wrapper.find('[data-chat-profile]').trigger('click')
  await flushPromises()
  const entry = [...document.body.querySelectorAll('[role="menuitem"]')].find(
    item => item.textContent.trim() === label
  )
  entry
    .querySelector('a')
    .dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
  await flushPromises()
}

describe('ChatProfileMenu', () => {
  /** @type {ReturnType<typeof useChats>} */
  let chats

  beforeEach(() => {
    setActivePinia(createPinia())
    clearChatsInstances()
    document.body.innerHTML = ''
    useApplicationState().resetState()
    chats = useChats('story_1')
  })

  it('names the profile the chat is on', () => {
    const wrapper = mountMenu(chats.unstartedChat.value.id)
    expect(wrapper.find('[data-chat-profile]').text()).toBe('Default')
  })

  it('puts the unstarted chat on another profile without saving anything', async () => {
    const wrapper = mountMenu(chats.unstartedChat.value.id)

    await pick(wrapper, 'Roleplay')

    expect(chats.unstartedChat.value.profileId).toBe(ROLEPLAY_PROFILE_ID)
    expect(useChatsStore().getChatsForStory('story_1')).toHaveLength(0)
    expect(wrapper.find('[data-chat-profile]').text()).toBe('Roleplay')
  })

  it('tells the writer what Roleplay (NSFW) asks of them the first time they pick it', async () => {
    window.localStorage.clear()
    useApplicationState().setNsfwProfiles(true)
    const notice = useProfileNotice()
    notice.dismiss()
    const wrapper = mountMenu(chats.unstartedChat.value.id)

    await pick(wrapper, 'Roleplay (NSFW)')

    expect(chats.unstartedChat.value.profileId).toBe(ROLEPLAY_NSFW_PROFILE_ID)
    expect(notice.pending.value?.header).toBe('Roleplay (NSFW)')

    notice.dismiss()
    await pick(wrapper, 'Roleplay')
    await pick(wrapper, 'Roleplay (NSFW)')
    expect(notice.pending.value).toBeNull()
  })

  it('replaces a started chat’s settings with the profile’s, even ones it does not set', async () => {
    const chat = chats.createChat(undefined, ROLEPLAY_PROFILE_ID)
    chats.updateChat(chat.id, { projectContextEnabled: false })
    const wrapper = mountMenu(chat.id)

    await pick(wrapper, 'Default')

    const now = chats.getChatById(chat.id)
    expect(now.profileId).toBe(CHAT_PROFILE_ID)
    expect(now.disabledToolGroups).toBeUndefined()
    expect(now.rules).toBeUndefined()
    expect(now.projectContextEnabled).toBeUndefined()
  })

  it('has no way into the settings of its own, the cog being there', async () => {
    const wrapper = mountMenu(chats.unstartedChat.value.id)
    await wrapper.find('[data-chat-profile]').trigger('click')
    await flushPromises()
    const labels = [...document.body.querySelectorAll('[role="menuitem"]')].map(item =>
      item.textContent.trim()
    )
    expect(labels).toEqual(['Default', 'Roleplay', 'Blank'])
  })

  it('offers Roleplay (NSFW) once NSFW profiles are switched on', async () => {
    useApplicationState().setNsfwProfiles(true)
    const wrapper = mountMenu(chats.unstartedChat.value.id)
    await wrapper.find('[data-chat-profile]').trigger('click')
    await flushPromises()
    const labels = [...document.body.querySelectorAll('[role="menuitem"]')].map(item =>
      item.textContent.trim()
    )
    expect(labels).toEqual(['Default', 'Roleplay', 'Roleplay (NSFW)', 'Blank'])
  })

  it('names Roleplay for a chat on Roleplay (NSFW) once they are switched off', async () => {
    useApplicationState().setNsfwProfiles(true)
    const chat = chats.createChat(undefined, ROLEPLAY_NSFW_PROFILE_ID)
    const wrapper = mountMenu(chat.id)
    expect(wrapper.find('[data-chat-profile]').text()).toBe('Roleplay (NSFW)')

    useApplicationState().setNsfwProfiles(false)
    await flushPromises()

    expect(wrapper.find('[data-chat-profile]').text()).toBe('Roleplay')
    // The chat keeps naming it, for when they are switched back on.
    expect(chats.getChatById(chat.id).profileId).toBe(ROLEPLAY_NSFW_PROFILE_ID)
  })

  it('deletes one of the writer’s own from its right-click menu, moving the chat off it', async () => {
    const mine = useProfiles().saveProfile('Mine', { prompt: 'Be terse.' })
    const chat = chats.createChat(undefined, mine.id)
    const wrapper = mountMenu(chat.id)

    await rightClick(wrapper, 'Mine')
    const remove = [...document.body.querySelectorAll('.p-contextmenu [role="menuitem"]')].find(
      item => item.textContent.trim() === 'Delete profile'
    )
    remove.querySelector('a').click()
    await flushPromises()

    expect(useProfiles().getProfile(mine.id)).toBeNull()
    expect(chats.getChatById(chat.id).profileId).toBe(CHAT_PROFILE_ID)
  })

  it('offers no right-click menu on a built-in', async () => {
    const wrapper = mountMenu(chats.unstartedChat.value.id)
    await rightClick(wrapper, 'Roleplay')
    expect(document.body.querySelector('.p-contextmenu')).toBeNull()
  })
})
