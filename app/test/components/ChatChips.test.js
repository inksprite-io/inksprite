/* global MouseEvent */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ChatChips from '@/components/writer/chats/ChatChips.vue'

/** The chat's settings, as useChatSettings hands them over. */
const chat = ref(/** @type {any} */ ({}))
const selectedProfile = ref(/** @type {any} */ ({ id: 'default', name: 'Default' }))
const applyEdits = ref('ask')
const setApplyEdits = vi.fn()
vi.mock('@/composables/useChatSettings', () => ({
  useChatSettings: () => ({ chat, selectedProfile, applyEdits, setApplyEdits }),
}))

/** The profiles' menu, reduced to whose it is and being asked to open. */
const profilesToggled = vi.fn()
const ProfileMenu = {
  name: 'ProfileMenu',
  props: ['id', 'storyId', 'chatId'],
  template: '<div data-profile-menu :id="id" :data-chat="chatId" />',
  methods: { toggle: profilesToggled },
}

/** The model's chip, reduced to whose it is and its popover being asked for. */
const modelsShown = vi.fn()
const ChatModelChip = {
  name: 'ChatModelChip',
  props: ['storyId', 'chatId'],
  template: '<button data-chat-model-chip :data-chat="chatId" />',
  methods: { show: modelsShown },
}

/**
 * The edits' menu, always open: each item drawn as the component draws it,
 * and a click on one running its command, as PrimeVue's does.
 */
const editsToggled = vi.fn()
const Menu = {
  name: 'Menu',
  props: ['model'],
  template: `<div data-menu>
    <div v-for="item in model" :key="item.label" data-item @click="item.command()">
      <slot name="item" :item="item" :props="{ action: {} }" />
    </div>
  </div>`,
  methods: { toggle: editsToggled },
}

const mountChips = () =>
  mount(ChatChips, {
    props: { storyId: 'story_1', chatId: 'chat_1' },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: { ProfileMenu, ChatModelChip, Menu },
    },
  })

const profileChip = wrapper => wrapper.find('[data-chat-profile-chip]')
const editsChip = wrapper => wrapper.find('[data-chat-edits-chip]')

describe('ChatChips', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chat.value = {}
    selectedProfile.value = { id: 'default', name: 'Default' }
    applyEdits.value = 'ask'
  })

  it('sets the profile to the left, then the model and the edits', () => {
    const wrapper = mountChips()
    const order = [...wrapper.element.querySelectorAll('button')].map(
      button =>
        ['data-chat-profile-chip', 'data-chat-model-chip', 'data-chat-edits-chip'].find(name =>
          button.hasAttribute(name)
        ) ?? ''
    )

    expect(order).toEqual([
      'data-chat-profile-chip',
      'data-chat-model-chip',
      'data-chat-edits-chip',
    ])
    expect(wrapper.find('[data-chat-model-chip]').classes()).toContain('ml-auto')
    expect(wrapper.find('[data-chat-model-chip]').attributes('data-chat')).toBe('chat_1')
  })

  describe('the profile chip', () => {
    it('says the profile the chat runs on', () => {
      selectedProfile.value = { id: 'mine', name: 'Drafting' }
      const chip = profileChip(mountChips())

      expect(chip.text()).toBe('Drafting')
      expect(chip.attributes('aria-label')).toBe('Profile: Drafting')
      expect(chip.attributes('aria-haspopup')).toBe('true')
    })

    it('opens the profiles’ menu, the chat’s own, on a click', async () => {
      const wrapper = mountChips()
      const menu = wrapper.findComponent(ProfileMenu)

      expect(menu.props()).toMatchObject({ storyId: 'story_1', chatId: 'chat_1' })
      expect(profileChip(wrapper).attributes('aria-controls')).toBe(menu.props('id'))

      await profileChip(wrapper).trigger('click')

      expect(profilesToggled).toHaveBeenCalledTimes(1)
      expect(profilesToggled.mock.calls[0][0]).toBeInstanceOf(MouseEvent)
    })

    it('lists no profiles itself, and has no Manage profiles…', () => {
      const wrapper = mountChips()

      expect(wrapper.text()).not.toContain('Manage profiles')
      // The one menu here is the edits'.
      expect(wrapper.findAllComponents(Menu)).toHaveLength(1)
    })
  })

  describe('the edits chip', () => {
    it('says Suggesting while the chat’s edits wait, and Editing while they go in', async () => {
      const wrapper = mountChips()

      expect(editsChip(wrapper).text()).toBe('Suggesting')
      expect(editsChip(wrapper).attributes('aria-label')).toBe('Document edits: Suggesting')

      applyEdits.value = 'auto'
      await wrapper.vm.$nextTick()

      expect(editsChip(wrapper).text()).toBe('Editing')
      expect(editsChip(wrapper).attributes('aria-label')).toBe('Document edits: Editing')
    })

    it('opens its menu on a click', async () => {
      const wrapper = mountChips()

      await editsChip(wrapper).trigger('click')

      expect(editsToggled).toHaveBeenCalledTimes(1)
      expect(editsChip(wrapper).attributes('aria-controls')).toBe(
        wrapper.findComponent(Menu).attributes('id')
      )
    })

    it('offers the two, each with a line on what it does, the one in use tinted', () => {
      applyEdits.value = 'auto'
      const wrapper = mountChips()
      const suggesting = wrapper.find('[data-edits="ask"]')
      const editing = wrapper.find('[data-edits="auto"]')

      expect(wrapper.findAll('[data-edits]')).toHaveLength(2)
      expect(suggesting.text()).toContain('Suggesting')
      expect(suggesting.text()).toContain('The model suggests changes')
      expect(editing.text()).toContain('Editing')
      expect(editing.text()).toContain('The model edits documents')

      expect(editing.attributes('aria-current')).toBe('true')
      expect(editing.classes()).toContain('bg-[var(--p-highlight-background)]')
      expect(suggesting.attributes('aria-current')).toBeUndefined()
      expect(wrapper.find('.pi-check').exists()).toBe(false)
    })

    it('sets the chat’s edits to the one picked', async () => {
      const wrapper = mountChips()

      await wrapper.find('[data-edits="auto"]').trigger('click')
      expect(setApplyEdits).toHaveBeenLastCalledWith('auto')

      await wrapper.find('[data-edits="ask"]').trigger('click')
      expect(setApplyEdits).toHaveBeenLastCalledWith('ask')
    })

    it('is gone, its menu with it, while the chat’s document tools are off', async () => {
      chat.value = { disabledToolGroups: ['documents'] }
      const wrapper = mountChips()

      expect(editsChip(wrapper).exists()).toBe(false)
      expect(wrapper.findComponent(Menu).exists()).toBe(false)

      // Another group off takes nothing from it.
      chat.value = { disabledToolGroups: ['rpg'] }
      await wrapper.vm.$nextTick()
      expect(editsChip(wrapper).exists()).toBe(true)
    })

    it('is gone on a profile that offers only other groups, as Blank does', () => {
      chat.value = { onlyToolGroups: [] }
      expect(editsChip(mountChips()).exists()).toBe(false)

      chat.value = { onlyToolGroups: ['documents'] }
      expect(editsChip(mountChips()).exists()).toBe(true)
    })

    it('is gone while tools are off as a whole, and back with them', async () => {
      chat.value = { toolsOff: true }
      const wrapper = mountChips()

      expect(editsChip(wrapper).exists()).toBe(false)

      chat.value = {}
      await wrapper.vm.$nextTick()
      expect(editsChip(wrapper).exists()).toBe(true)
    })
  })

  it('opens the model chip’s popover when asked to show the models', () => {
    const wrapper = mountChips()
    const click = new MouseEvent('click')

    wrapper.vm.showModels(click)
    expect(modelsShown).toHaveBeenCalledWith(click)

    wrapper.vm.showModels()
    expect(modelsShown).toHaveBeenLastCalledWith(undefined)
  })
})
