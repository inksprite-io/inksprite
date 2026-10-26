import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Settings from '@/components/writer/settings/Settings.vue'
import { useApplicationState } from '@/composables/useApplicationState'

vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ init: vi.fn(async () => {}) }),
}))

const section = name => ({ template: `<div data-section-pane="${name}" />` })

const mountSettings = (props = {}) =>
  mount(Settings, {
    props,
    global: {
      plugins: [PrimeVue],
      stubs: {
        SystemSection: section('system'),
        SyncSection: section('sync'),
        ProjectSection: {
          props: ['storyId'],
          template: '<div data-section-pane="project" :data-story="storyId" />',
        },
        AiConfigSection: section('ai'),
        WorkflowsSection: section('workflows'),
        SkillsSection: section('skills'),
        ConnectionsSection: section('connections'),
        AboutSection: section('about'),
        ScrollPanel: { template: '<div><slot /></div>' },
      },
    },
  })

describe('Settings', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    useApplicationState().resetState()
  })

  it('opens on the first section', () => {
    const wrapper = mountSettings()
    expect(wrapper.find('[data-section-pane="system"]').exists()).toBe(true)
    expect(wrapper.find('h2').text()).toBe('System')
  })

  it('shows one section at a time', async () => {
    const wrapper = mountSettings()
    await wrapper.find('[data-section="ai"]').trigger('click')
    expect(wrapper.find('[data-section-pane="ai"]').exists()).toBe(true)
    expect(wrapper.find('[data-section-pane="system"]').exists()).toBe(false)
    expect(wrapper.find('h2').text()).toBe('AI')
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
    const ids = wrapper => wrapper.findAll('[data-section]').map(b => b.attributes('data-section'))
    expect(ids(mountSettings()).slice(0, 3)).toEqual(['system', 'sync', 'ai'])

    const wrapper = mountSettings({ storyId: 'story_1' })
    expect(ids(wrapper).slice(0, 3)).toEqual(['system', 'sync', 'project'])
    await wrapper.find('[data-section="project"]').trigger('click')
    expect(wrapper.find('h2').text()).toBe('Project')
    expect(wrapper.find('[data-section-pane="project"]').attributes('data-story')).toBe('story_1')

    // With no project open, the one last looked at opens on the first.
    expect(mountSettings().find('[data-section-pane="system"]').exists()).toBe(true)
  })

  it('opens on the section asked for', async () => {
    const { useSettingsPanel } = await import('@/composables/useSettingsPanel.js')
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
    await first.find('[data-section="workflows"]').trigger('click')

    const second = mountSettings()
    expect(second.find('[data-section-pane="workflows"]').exists()).toBe(true)
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
})
