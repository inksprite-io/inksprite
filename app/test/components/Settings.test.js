import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Settings from '@/components/writer/settings/Settings.vue'

vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ init: vi.fn(async () => {}) }),
}))

const section = name => ({ template: `<div data-section-pane="${name}" />` })

const mountSettings = () =>
  mount(Settings, {
    global: {
      plugins: [PrimeVue],
      stubs: {
        SystemSection: section('system'),
        AiConfigSection: section('ai'),
        NarrationSection: section('narration'),
        AboutSection: section('about'),
        ScrollPanel: { template: '<div><slot /></div>' },
      },
    },
  })

describe('Settings', () => {
  beforeEach(() => window.sessionStorage.clear())

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

  it('has a section for the speech server', async () => {
    const wrapper = mountSettings()
    await wrapper.find('[data-section="narration"]').trigger('click')
    expect(wrapper.find('[data-section-pane="narration"]').exists()).toBe(true)
    expect(wrapper.find('h2').text()).toBe('Narration')
  })

  it('keeps data and debug under System rather than sections of their own', () => {
    const wrapper = mountSettings()
    expect(wrapper.find('[data-section="data"]').exists()).toBe(false)
    expect(wrapper.find('[data-section="debug"]').exists()).toBe(false)
  })

  it('has a section for the license and the credits', async () => {
    const wrapper = mountSettings()
    await wrapper.find('[data-section="about"]').trigger('click')
    expect(wrapper.find('[data-section-pane="about"]').exists()).toBe(true)
    expect(wrapper.find('h2').text()).toBe('About')
  })

  it('reopens on the section last looked at', async () => {
    const first = mountSettings()
    await first.find('[data-section="narration"]').trigger('click')

    const second = mountSettings()
    expect(second.find('[data-section-pane="narration"]').exists()).toBe(true)
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
