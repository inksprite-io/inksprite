/* global MouseEvent */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ProfileMenu from '@/components/writer/chats/ProfileMenu.vue'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'

/** The profiles there are: two built in, two the writer's own. */
const profiles = ref(/** @type {any[]} */ ([]))
const selectedProfileId = ref('default')
const setProfile = vi.fn()
const newProfile = vi.fn()
const deleteProfile = vi.fn()
vi.mock('@/composables/useChatSettings', () => ({
  useChatSettings: () => ({ profiles, selectedProfileId, setProfile, newProfile, deleteProfile }),
}))

/** The profile new chats start on. */
const starred = ref('default')
const updateProfile = vi.fn()
vi.mock('@/composables/useProfiles', () => ({
  useProfiles: () => ({
    chatDefaultId: () => starred.value,
    getProfile: id => profiles.value.find(profile => profile.id === id) ?? null,
    // As useProfiles has it: the name, or the name with the next number free.
    freeProfileName: name =>
      profiles.value.some(profile => profile.name === name) ? `${name} (2)` : name,
    updateProfile,
  }),
}))

const setChatProfileId = vi.fn()
vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => ({ setChatProfileId }),
}))

/**
 * The menu, always open: each item drawn as the component draws it, and a
 * click on one running its command, as PrimeVue's does.
 */
const toggled = vi.fn()
const Menu = {
  name: 'Menu',
  props: ['model'],
  template: `<div data-menu>
    <template v-for="(item, index) in model" :key="index">
      <hr v-if="item.separator" />
      <div v-else data-item @click="item.command()">
        <slot name="item" :item="item" :props="{ action: {} }" />
      </div>
    </template>
  </div>`,
  methods: { toggle: toggled },
}

/** A profile's own menu, reduced to what it offers and being asked to open. */
const contextShown = vi.fn()
const ContextMenu = {
  name: 'ContextMenu',
  props: ['model'],
  template: '<div />',
  methods: { show: contextShown },
}

const Dialog = {
  props: ['visible', 'header'],
  emits: ['update:visible'],
  template: '<div v-if="visible" data-dialog :data-header="header"><slot /></div>',
}

const mountMenu = () =>
  mount(ProfileMenu, {
    props: { id: 'profiles', storyId: 'story_1', chatId: 'chat_1' },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: { Menu, ContextMenu, Dialog },
    },
  })

const row = (wrapper, profileId) => wrapper.find(`[data-profile="${profileId}"]`)

/** Right-click a profile, and hand back what its menu offers. */
const rightClick = async (wrapper, profileId) => {
  await row(wrapper, profileId).trigger('contextmenu')
  return wrapper
    .findComponent(ContextMenu)
    .props('model')
    .filter(item => item.visible !== false)
}
const labels = items => items.map(item => item.label)

/** Type a name into the dialog that asks for one, and save it. */
const nameIt = async (wrapper, name) => {
  await wrapper.find('[data-field="profile-name"]').setValue(name)
  await wrapper.find('form').trigger('submit')
}

describe('ProfileMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    profiles.value = [
      { id: 'default', name: 'Default', readOnly: true },
      { id: 'blank', name: 'Blank', readOnly: true },
      { id: 'mine', name: 'Drafting' },
      { id: 'other', name: 'Line edits' },
    ]
    selectedProfileId.value = 'default'
    starred.value = 'default'
    useSettingsPanel().close()
    useSettingsPanel().takeSection()
  })

  it('lists the profiles, then New profile…, then Prompts…', () => {
    const wrapper = mountMenu()
    const model = wrapper.findComponent(Menu).props('model')

    expect(model.map(item => (item.separator ? '-' : item.label))).toEqual([
      'Default',
      'Blank',
      'Drafting',
      'Line edits',
      '-',
      'New profile…',
      '-',
      'Prompts…',
    ])
    expect(wrapper.text()).not.toContain('Manage profiles')
    expect(wrapper.findComponent(Menu).attributes('id')).toBe('profiles')
  })

  it('opens and shuts from the button it is under', () => {
    const wrapper = mountMenu()
    const click = new MouseEvent('click')

    wrapper.vm.toggle(click)

    expect(toggled).toHaveBeenCalledWith(click)
  })

  it('tints the profile the chat is on, as a select’s choice is, with no check', () => {
    selectedProfileId.value = 'mine'
    const wrapper = mountMenu()

    expect(row(wrapper, 'mine').attributes('aria-current')).toBe('true')
    expect(row(wrapper, 'mine').classes()).toContain('bg-[var(--p-highlight-background)]')
    expect(row(wrapper, 'default').attributes('aria-current')).toBeUndefined()
    expect(row(wrapper, 'default').classes()).not.toContain('bg-[var(--p-highlight-background)]')
    expect(wrapper.find('.pi-check').exists()).toBe(false)
    // Nor either of the items under the profiles.
    expect(wrapper.find('[data-action="new-profile"]').attributes('aria-current')).toBeUndefined()
  })

  it('stars the default, and no other', () => {
    starred.value = 'other'
    const wrapper = mountMenu()

    expect(wrapper.findAll('[data-default-profile]')).toHaveLength(1)
    const star = row(wrapper, 'other').find('[data-default-profile]')
    expect(star.exists()).toBe(true)
    expect(star.attributes('aria-label')).toBe('Default')
  })

  it('moves the chat onto the profile picked', async () => {
    const wrapper = mountMenu()

    await row(wrapper, 'mine').trigger('click')

    expect(setProfile).toHaveBeenCalledWith('mine')
  })

  describe('New profile…', () => {
    it('asks for a name, starting on one no profile has', async () => {
      const wrapper = mountMenu()
      expect(wrapper.find('[data-dialog]').exists()).toBe(false)

      await wrapper.find('[data-action="new-profile"]').trigger('click')

      const dialog = wrapper.find('[data-dialog]')
      expect(dialog.attributes('data-header')).toBe('New profile')
      expect(dialog.find('[data-action="save-profile-name"]').text()).toBe('Create')
      expect(dialog.find('[data-field="profile-name"]').element.value).toBe('New Profile')
    })

    it('starts on the next name free when New Profile is taken', async () => {
      profiles.value = [...profiles.value, { id: 'new', name: 'New Profile' }]
      const wrapper = mountMenu()

      await wrapper.find('[data-action="new-profile"]').trigger('click')

      expect(wrapper.find('[data-field="profile-name"]').element.value).toBe('New Profile (2)')
    })

    it('makes the profile under the name typed, and shuts', async () => {
      const wrapper = mountMenu()
      await wrapper.find('[data-action="new-profile"]').trigger('click')

      await nameIt(wrapper, ' Outlining ')

      expect(newProfile).toHaveBeenCalledWith('Outlining')
      expect(updateProfile).not.toHaveBeenCalled()
      expect(wrapper.find('[data-dialog]').exists()).toBe(false)
    })
  })

  describe('Prompts…', () => {
    it('opens the settings on the chat’s prompts', async () => {
      const panel = useSettingsPanel()
      const wrapper = mountMenu()

      await wrapper.find('[data-action="prompts"]').trigger('click')

      expect(panel.visible.value).toBe(true)
      expect(panel.takeSection()).toBe('prompts')
    })
  })

  describe('on a right click', () => {
    it('offers Set as default, Rename… and Delete on one of the writer’s own', async () => {
      const wrapper = mountMenu()

      const items = await rightClick(wrapper, 'mine')

      expect(labels(items)).toEqual(['Set as default', 'Rename…', 'Delete'])
      expect(contextShown).toHaveBeenCalledTimes(1)
    })

    it('offers only Set as default on a built-in', async () => {
      const items = await rightClick(mountMenu(), 'blank')

      expect(labels(items)).toEqual(['Set as default'])
    })

    it('offers no Set as default on the default', async () => {
      starred.value = 'mine'
      const items = await rightClick(mountMenu(), 'mine')

      expect(labels(items)).toEqual(['Rename…', 'Delete'])
    })

    it('opens nothing on a built-in that is the default, and keeps the browser’s menu off', async () => {
      const wrapper = mountMenu()
      const click = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })

      row(wrapper, 'default').element.dispatchEvent(click)
      await wrapper.vm.$nextTick()

      expect(contextShown).not.toHaveBeenCalled()
      expect(click.defaultPrevented).toBe(true)
    })

    it('has no menu of its own on New profile… or Prompts…', async () => {
      const wrapper = mountMenu()

      await wrapper.find('[data-action="new-profile"]').trigger('contextmenu')
      await wrapper.find('[data-action="prompts"]').trigger('contextmenu')

      expect(contextShown).not.toHaveBeenCalled()
    })

    it('makes a profile the one new chats start on', async () => {
      const items = await rightClick(mountMenu(), 'other')

      items.find(item => item.label === 'Set as default').command()

      expect(setChatProfileId).toHaveBeenCalledWith('other')
    })

    it('deletes a profile through the chat’s settings, which move the chat off it', async () => {
      const items = await rightClick(mountMenu(), 'mine')

      items.find(item => item.label === 'Delete').command()

      expect(deleteProfile).toHaveBeenCalledWith('mine')
    })

    it('asks for a new name on Rename…, starting on the one it has', async () => {
      const wrapper = mountMenu()
      const items = await rightClick(wrapper, 'mine')

      items.find(item => item.label === 'Rename…').command()
      await wrapper.vm.$nextTick()

      const dialog = wrapper.find('[data-dialog]')
      expect(dialog.attributes('data-header')).toBe('Rename profile')
      expect(dialog.find('[data-action="save-profile-name"]').text()).toBe('Rename')
      expect(dialog.find('[data-field="profile-name"]').element.value).toBe('Drafting')

      await nameIt(wrapper, 'Second draft')
      expect(updateProfile).toHaveBeenCalledWith('mine', { name: 'Second draft' })
      expect(newProfile).not.toHaveBeenCalled()
    })

    it('renames to a name no other profile has, and not at all to its own', async () => {
      const wrapper = mountMenu()
      const rename = async name => {
        const items = await rightClick(wrapper, 'mine')
        items.find(item => item.label === 'Rename…').command()
        await wrapper.vm.$nextTick()
        await nameIt(wrapper, name)
      }

      await rename('Drafting')
      expect(updateProfile).not.toHaveBeenCalled()

      await rename('Line edits')
      expect(updateProfile).toHaveBeenCalledWith('mine', { name: 'Line edits (2)' })
    })
  })
})
