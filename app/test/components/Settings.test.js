import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Settings from '@/components/writer/settings/Settings.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'

vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ init: vi.fn(async () => {}) }),
}))

/**
 * The chat showing in the project open, if one is. What its own sections
 * hold is tested in SettingsChatSections.test.js.
 */
const shownChat = ref(/** @type {string|null} */ (null))
vi.mock('@/composables/useChatTabs.js', () => ({
  useChatTabs: () => ({ activeChatId: shownChat }),
}))

/** The sync account this device is signed in to, if it is. */
const account = ref(/** @type {{server: string, name: string}|null} */ (null))
vi.mock('@/composables/useCloudSync.js', () => ({ useCloudSync: () => ({ account }) }))

/** A section, saying what it was handed: its part, and the project and chat it is for. */
const section = name => ({
  props: ['part', 'storyId', 'chatId'],
  emits: ['close'],
  template: `<div data-section-pane="${name}" :data-part="part" :data-story="storyId" :data-chat="chatId"><button data-close @click="$emit('close')" /></div>`,
})

const mountSettings = (props = {}) =>
  mount(Settings, {
    props,
    global: {
      plugins: [PrimeVue],
      stubs: {
        SystemSection: section('system'),
        SyncSection: section('sync'),
        ProjectSection: section('project'),
        ChatPrompts: section('prompts'),
        ConnectionsSection: section('connections'),
        ModelsSection: section('models'),
        ChatTools: section('tools'),
        SkillsSection: section('skills'),
        ExtensionsSection: section('extensions'),
        AboutSection: section('about'),
        ChatProfileChip: {
          props: ['storyId', 'chatId'],
          template: '<div data-profile-chip :data-story="storyId" :data-chat="chatId" />',
        },
        ScrollPanel: { template: '<div><slot /></div>' },
      },
    },
  })

/** The sections listed, in order. */
const ids = wrapper => wrapper.findAll('[data-section]').map(b => b.attributes('data-section'))
/** The open section's parts, as listed under it. */
const partsOf = wrapper =>
  wrapper.findAll('nav [data-section-parts] [data-part]').map(one => one.text())
/** Open a section, and one of its parts where one is named. */
const go = async (wrapper, id, part) => {
  await wrapper.find(`[data-section="${id}"]`).trigger('click')
  if (part) await wrapper.find(`nav [data-part="${part}"]`).trigger('click')
}

describe('Settings', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    useApplicationState().resetState()
    shownChat.value = null
    account.value = null
    const panel = useSettingsPanel()
    panel.takeSection()
    panel.takePart()
    panel.close()
  })

  it('opens on the first section', () => {
    const wrapper = mountSettings()
    expect(wrapper.find('[data-section-pane="system"]').exists()).toBe(true)
    expect(wrapper.find('h2').text()).toBe('System')
  })

  it('shows the project asked for in place of the one open, until it closes', async () => {
    const panel = useSettingsPanel()
    panel.open('project', undefined, 'story_other')
    const wrapper = mountSettings({ storyId: 'story_open' })
    expect(wrapper.find('[data-section-pane="project"]').attributes('data-story')).toBe(
      'story_other'
    )

    wrapper.unmount()
    panel.close()
    expect(panel.requestedProject.value).toBeNull()

    panel.open('project')
    const again = mountSettings({ storyId: 'story_open' })
    expect(again.find('[data-section-pane="project"]').attributes('data-story')).toBe('story_open')
    panel.close()
  })

  it('shows one section at a time', async () => {
    const wrapper = mountSettings()
    await wrapper.find('[data-section="skills"]').trigger('click')
    expect(wrapper.find('[data-section-pane="skills"]').exists()).toBe(true)
    expect(wrapper.find('[data-section-pane="system"]').exists()).toBe(false)
    expect(wrapper.find('h2').text()).toBe('Skills')
  })

  it('leaves what a project is read aloud through to the narration panel', () => {
    window.sessionStorage.setItem('ui.settings.section', JSON.stringify('narration'))
    const wrapper = mountSettings()
    expect(wrapper.find('[data-section="narration"]').exists()).toBe(false)
    // A section looked at before it went opens on the first.
    expect(wrapper.find('[data-section-pane="system"]').exists()).toBe(true)
  })

  it("has none of the AI's sections with the AI switched off, the AI settings among them", async () => {
    window.sessionStorage.setItem('ui.settings.section', JSON.stringify('skills'))
    useApplicationState().setAiEnabled(false)
    const wrapper = mountSettings()

    expect(
      wrapper.findAll('[data-section]').map(button => button.attributes('data-section'))
    ).toEqual(['system', 'sync', 'about'])
    // A section looked at before it went opens on the first.
    expect(wrapper.find('[data-section-pane="system"]').exists()).toBe(true)

    useApplicationState().setAiEnabled(true)
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-section-pane="skills"]').exists()).toBe(true)
  })

  it('keeps data and debug under System rather than sections of their own', () => {
    const wrapper = mountSettings()
    expect(wrapper.find('[data-section="data"]').exists()).toBe(false)
    expect(wrapper.find('[data-section="debug"]').exists()).toBe(false)
  })

  it('has sync and sharing after System, then the project open, if one is', async () => {
    expect(ids(mountSettings()).slice(0, 3)).toEqual(['system', 'sync', 'connections'])

    const wrapper = mountSettings({ storyId: 'story_1' })
    expect(ids(wrapper).slice(0, 3)).toEqual(['system', 'sync', 'project'])
    await wrapper.find('[data-section="project"]').trigger('click')
    expect(wrapper.find('h2').text()).toBe('Project')
    expect(wrapper.find('[data-section-pane="project"]').attributes('data-story')).toBe('story_1')

    // With no project open, the one last looked at opens on the first.
    expect(mountSettings().find('[data-section-pane="system"]').exists()).toBe(true)
  })

  it('opens on the section asked for', async () => {
    useSettingsPanel().open('project', 'sharing')
    const wrapper = mountSettings({ storyId: 'story_1' })
    expect(wrapper.find('[data-section-pane="project"]').exists()).toBe(true)
    // The part is the section's to take.
    expect(useSettingsPanel().takePart()).toBe('sharing')
    useSettingsPanel().close()
  })

  it('has a section for the license and the credits', async () => {
    const wrapper = mountSettings()
    await wrapper.find('[data-section="about"]').trigger('click')
    expect(wrapper.find('[data-section-pane="about"]').exists()).toBe(true)
    expect(wrapper.find('h2').text()).toBe('About')
  })

  it('reopens on the section last looked at', async () => {
    const first = mountSettings()
    await first.find('[data-section="skills"]').trigger('click')

    const second = mountSettings()
    expect(second.find('[data-section-pane="skills"]').exists()).toBe(true)
  })

  it('brings the section it opens on into view, wherever the strip is scrolled', async () => {
    const shown = vi.fn()
    const original = window.HTMLElement.prototype.scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = function (options) {
      shown(this.dataset.section, options)
    }
    try {
      window.sessionStorage.setItem('ui.settings.section', JSON.stringify('about'))
      const wrapper = mountSettings()
      expect(shown).toHaveBeenLastCalledWith('about', { block: 'nearest', inline: 'nearest' })

      await wrapper.find('[data-section="system"]').trigger('click')
      expect(shown).toHaveBeenLastCalledWith('system', { block: 'nearest', inline: 'nearest' })
    } finally {
      window.HTMLElement.prototype.scrollIntoView = original
    }
  })

  describe('sections', () => {
    it('has the app’s alone with no project open: Models after Connections, then Skills and Extensions', () => {
      const wrapper = mountSettings()

      expect(ids(wrapper)).toEqual([
        'system',
        'sync',
        'connections',
        'models',
        'skills',
        'extensions',
        'about',
      ])
      expect(wrapper.find('[data-profile-chip]').exists()).toBe(false)
    })

    it('has the chat’s among them with a chat showing, under its profile, which stands over the list', async () => {
      shownChat.value = 'chat_1'
      const wrapper = mountSettings({ storyId: 'story_1' })

      expect(ids(wrapper)).toEqual([
        'system',
        'sync',
        'project',
        'prompts',
        'connections',
        'models',
        'tools',
        'skills',
        'extensions',
        'about',
      ])
      const chip = wrapper.find('[data-profile-chip]')
      expect(chip.attributes()).toMatchObject({ 'data-story': 'story_1', 'data-chat': 'chat_1' })
      expect(wrapper.find('nav').element.firstElementChild).toBe(chip.element)

      await go(wrapper, 'prompts')
      expect(wrapper.find('h2').text()).toBe('Prompts')
      await go(wrapper, 'tools')
      expect(wrapper.find('h2').text()).toBe('Tools')
    })

    it('hands the chat to its sections, and to Models and Skills, which are there without one', async () => {
      shownChat.value = 'chat_1'
      const wrapper = mountSettings({ storyId: 'story_1' })

      for (const id of ['prompts', 'models', 'tools', 'skills']) {
        await go(wrapper, id)
        expect(wrapper.find(`[data-section-pane="${id}"]`).attributes()).toMatchObject({
          'data-story': 'story_1',
          'data-chat': 'chat_1',
        })
      }

      // Another chat shown: its own, made again.
      const before = wrapper.find('[data-section-pane="skills"]').element
      shownChat.value = 'chat_2'
      await wrapper.vm.$nextTick()
      const after = wrapper.find('[data-section-pane="skills"]')
      expect(after.attributes('data-chat')).toBe('chat_2')
      expect(after.element).not.toBe(before)
      expect(wrapper.find('[data-profile-chip]').attributes('data-chat')).toBe('chat_2')
    })

    it('hands Models and Skills no chat where none is showing', async () => {
      const wrapper = mountSettings()

      await go(wrapper, 'models')
      expect(wrapper.find('[data-section-pane="models"]').attributes('data-chat')).toBeUndefined()
      await go(wrapper, 'skills')
      expect(wrapper.find('[data-section-pane="skills"]').attributes('data-chat')).toBeUndefined()
    })

    it('has none of the chat’s with the AI off, though a project is open', () => {
      shownChat.value = 'chat_1'
      useApplicationState().setAiEnabled(false)
      const wrapper = mountSettings({ storyId: 'story_1' })

      expect(ids(wrapper)).toEqual(['system', 'sync', 'project', 'about'])
      expect(wrapper.find('[data-profile-chip]').exists()).toBe(false)
    })

    it('opens on the first section where the one last looked at was a chat’s, and none is showing', () => {
      window.sessionStorage.setItem('ui.settings.section', JSON.stringify('tools'))
      const wrapper = mountSettings()
      expect(wrapper.find('[data-section-pane="system"]').exists()).toBe(true)
    })

    it('closes for what a chat’s section opens in its place', async () => {
      shownChat.value = 'chat_1'
      const panel = useSettingsPanel()
      panel.open('prompts')
      const wrapper = mountSettings({ storyId: 'story_1' })
      expect(panel.visible.value).toBe(true)

      await wrapper.find('[data-section-pane="prompts"] [data-close]').trigger('click')
      expect(panel.visible.value).toBe(false)
    })
  })

  describe('parts', () => {
    it('shows Connections a part at a time: AI providers, MCP servers and Web search', async () => {
      const wrapper = mountSettings()
      await go(wrapper, 'connections')

      expect(partsOf(wrapper)).toEqual(['AI providers', 'MCP servers', 'Web search'])
      // On its first, whose name is the heading.
      expect(wrapper.find('h2').text()).toBe('AI providers')
      expect(wrapper.find('[data-section-pane="connections"]').attributes('data-part')).toBe(
        'providers'
      )

      await go(wrapper, 'connections', 'mcp')
      expect(wrapper.find('h2').text()).toBe('MCP servers')
      expect(wrapper.find('[data-section-pane="connections"]').attributes('data-part')).toBe('mcp')
    })

    it('lists Web search among them only while its extension is on', async () => {
      useApplicationState().setExtension('web', false)
      const wrapper = mountSettings()
      await go(wrapper, 'connections')
      expect(partsOf(wrapper)).toEqual(['AI providers', 'MCP servers'])

      useApplicationState().setExtension('web', true)
      await wrapper.vm.$nextTick()
      expect(partsOf(wrapper)).toEqual(['AI providers', 'MCP servers', 'Web search'])
    })

    it('shows Sync and sharing as Account and Backup, with People and Devices once signed in', async () => {
      const wrapper = mountSettings()
      await go(wrapper, 'sync')
      expect(partsOf(wrapper)).toEqual(['Account', 'Backup'])
      expect(wrapper.find('h2').text()).toBe('Account')

      account.value = { server: 'https://sync.inksprite.io', name: 'writer' }
      await wrapper.vm.$nextTick()
      expect(partsOf(wrapper)).toEqual(['Account', 'People', 'Devices', 'Backup'])

      await go(wrapper, 'sync', 'devices')
      expect(wrapper.find('[data-section-pane="sync"]').attributes('data-part')).toBe('devices')

      // Signed out on a part that went with the account: back on the first.
      account.value = null
      await wrapper.vm.$nextTick()
      expect(wrapper.find('[data-section-pane="sync"]').attributes('data-part')).toBe('account')
    })

    it('has no parts for the other sections', async () => {
      const wrapper = mountSettings()
      await go(wrapper, 'extensions')
      expect(wrapper.find('[data-section-parts]').exists()).toBe(false)
      expect(wrapper.find('[data-section-pane="extensions"]').attributes('data-part')).toBe(
        undefined
      )
    })

    it('remembers the part each section was on, and reopens on it', async () => {
      const first = mountSettings()
      await go(first, 'connections', 'mcp')
      await go(first, 'sync', 'backup')

      // Each its own: back in Connections, MCP servers still.
      await go(first, 'connections')
      expect(first.find('[data-section-pane="connections"]').attributes('data-part')).toBe('mcp')
      first.unmount()

      const second = mountSettings()
      expect(second.find('[data-section-pane="connections"]').attributes('data-part')).toBe('mcp')
      await go(second, 'sync')
      expect(second.find('[data-section-pane="sync"]').attributes('data-part')).toBe('backup')
      expect(second.find('h2').text()).toBe('Backup')
    })

    it('opens on the part asked for, in place of the one last looked at', async () => {
      const first = mountSettings()
      await go(first, 'connections', 'mcp')
      first.unmount()

      const panel = useSettingsPanel()
      panel.open('connections', 'web')
      const wrapper = mountSettings()

      expect(wrapper.find('[data-section-pane="connections"]').attributes('data-part')).toBe('web')
      expect(wrapper.find('h2').text()).toBe('Web search')
      // Taken, so the settings don't keep jumping back to it.
      expect(panel.requestedSection.value).toBeNull()
      expect(panel.requestedPart.value).toBeNull()
    })

    it('goes to a part asked for while it is open', async () => {
      const wrapper = mountSettings()
      expect(wrapper.find('[data-section-pane="system"]').exists()).toBe(true)

      useSettingsPanel().open('sync', 'backup')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('[data-section-pane="sync"]').attributes('data-part')).toBe('backup')
    })

    it('opens a section asked for with no part on the part it was last on', async () => {
      const first = mountSettings()
      await go(first, 'connections', 'mcp')
      await go(first, 'system')
      first.unmount()

      useSettingsPanel().open('connections')
      const wrapper = mountSettings()
      expect(wrapper.find('[data-section-pane="connections"]').attributes('data-part')).toBe('mcp')
    })
  })
})
