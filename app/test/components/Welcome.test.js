import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Welcome from '@/components/common/Welcome.vue'

const { platform, setShowWelcomeDialog, ai } = vi.hoisted(() => ({
  platform: {
    desktop: false,
    advice: { clearsAfterAWeek: false, homeScreen: false, desktopApp: true },
  },
  setShowWelcomeDialog: vi.fn(),
  // The preset in use and its connection: OpenRouter with no key yet, as on
  // a first visit.
  ai: { preset: null, connections: [] },
}))

/** Whether the AI is switched on. */
const aiEnabled = ref(true)
const setAiEnabled = (/** @type {boolean} */ on) => (aiEnabled.value = on)

vi.mock('@/platform/desktop.js', () => ({ isDesktop: () => platform.desktop }))
vi.mock('@/platform/persistence.js', () => ({ storageAdvice: () => platform.advice }))
vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => ({ setShowWelcomeDialog, aiEnabled, setAiEnabled }),
}))
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({
    activeAIPreset: { value: ai.preset },
    getProvider: id => ai.connections.find(connection => connection.id === id) || null,
  }),
}))

/** The AI as a first visit finds it: the default preset on OpenRouter, not connected. */
const notSetUp = () => {
  ai.preset = { id: 'profile_default_chat', providerId: 'provider_openrouter_default', model: 'm' }
  ai.connections = [{ id: 'provider_openrouter_default', name: 'OpenRouter', type: 'openrouter' }]
}

const mountWelcome = () =>
  mount(Welcome, {
    props: { visible: true },
    global: {
      plugins: [PrimeVue],
      stubs: {
        Dialog: { template: '<div><slot /><slot name="footer" /></div>' },
        AiConfigSection: { template: '<div data-ai-settings />' },
        ScrollPanel: { template: '<div><slot /></div>' },
      },
    },
  })

/** The button in the open section that reads `text`. */
const inlineButton = (wrapper, text) =>
  wrapper.findAll('button:not([data-section])').find(button => button.text() === text)

/** The storage warning's text, or null without one. */
const warning = wrapper => {
  const paragraph = wrapper.find('[data-storage-warning]')
  return paragraph.exists() ? paragraph.text().replace(/\s+/g, ' ') : null
}

describe('Welcome', () => {
  beforeEach(() => {
    platform.desktop = false
    platform.advice = { clearsAfterAWeek: false, homeScreen: false, desktopApp: true }
    setShowWelcomeDialog.mockClear()
    aiEnabled.value = true
    notSetUp()
  })

  it('opens on the welcome, laid out as the settings are', () => {
    const wrapper = mountWelcome()
    expect(wrapper.find('h2').text()).toBe('Welcome to inksprite')
    expect(wrapper.findAll('[data-section]').map(button => button.text())).toEqual([
      'Welcome',
      'AI',
      'Terms of Service',
    ])
    expect(wrapper.find('[aria-current="page"]').attributes('data-section')).toBe('welcome')
  })

  it('links to the getting-started guide', () => {
    const link = mountWelcome()
      .findAll('a')
      .find(a => a.text() === 'Getting Started guide')
    expect(link.attributes('href')).toBe('https://docs.inksprite.io/getting-started')
    expect(link.attributes('target')).toBe('_blank')
  })

  it('has the AI settings, and the welcome points to them', async () => {
    const wrapper = mountWelcome()
    await inlineButton(wrapper, 'connect an AI provider').trigger('click')
    expect(wrapper.find('h2').text()).toBe('AI')
    expect(wrapper.find('[data-ai-settings]').exists()).toBe(true)
  })

  it('turns the AI off, and the AI settings go with it', async () => {
    const wrapper = mountWelcome()
    await inlineButton(wrapper, 'turn them off').trigger('click')

    expect(aiEnabled.value).toBe(false)
    expect(wrapper.find('h2').text()).toBe('Welcome to inksprite')
    expect(wrapper.find('[data-section="ai"]').exists()).toBe(false)
    expect(wrapper.find('[data-ai-off]').exists()).toBe(true)
  })

  it('says the AI is off, and turns it back on', async () => {
    aiEnabled.value = false
    const wrapper = mountWelcome()

    expect(wrapper.find('[data-connect-ai]').exists()).toBe(false)
    expect(wrapper.find('[data-section="ai"]').exists()).toBe(false)
    expect(wrapper.find('[data-ai-off]').text().replace(/\s+/g, ' ')).toBe(
      'The AI tools are off. You can turn them on now or later in Settings.'
    )
    await inlineButton(wrapper, 'turn them on').trigger('click')

    expect(aiEnabled.value).toBe(true)
    expect(wrapper.find('[data-section="ai"]').exists()).toBe(true)
    expect(wrapper.find('[data-connect-ai]').exists()).toBe(true)
  })

  it('offers neither the AI settings nor connecting when the AI is set up already', () => {
    ai.preset = { id: 'profile_team', providerId: 'provider_team', model: 'house-large' }
    ai.connections = [
      { id: 'provider_team', name: 'Team proxy', type: 'generic', endpoint: 'http://h/v1' },
    ]
    const wrapper = mountWelcome()

    expect(wrapper.findAll('[data-section]').map(button => button.text())).toEqual([
      'Welcome',
      'Terms of Service',
    ])
    expect(wrapper.find('[data-connect-ai]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Write and edit documents')
  })

  it('has the terms, and the footer points to them from any section', async () => {
    const wrapper = mountWelcome()
    await wrapper.find('[data-section="ai"]').trigger('click')
    await wrapper.find('[data-terms-agreement] button').trigger('click')
    expect(wrapper.find('h2').text()).toBe('Terms of Service')
    expect(wrapper.find('[data-terms]').exists()).toBe(true)
  })

  it('says where to report bugs', () => {
    const link = mountWelcome()
      .findAll('a')
      .find(a => a.text() === 'GitHub')
    expect(link.attributes('href')).toBe('https://github.com/inksprite-io/inksprite/issues')
  })

  it('is put away by Start writing', async () => {
    const wrapper = mountWelcome()
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Start writing')
      .trigger('click')
    expect(setShowWelcomeDialog).toHaveBeenCalledWith(false)
  })

  it('warns that the work is in the browser, and where backups are', () => {
    const wrapper = mountWelcome()
    expect(wrapper.text()).toContain('Browser storage')
    expect(warning(wrapper)).toContain(
      "Your work is stored only in this browser. If this site's data is cleared, it's gone."
    )
    expect(warning(wrapper)).toContain('You can back up your data from Settings › System › Data.')
    expect(wrapper.find('[data-storage-warning] strong').classes()).toContain('text-red-600')
  })

  it('links a computer to the latest desktop release', () => {
    const wrapper = mountWelcome()
    const link = wrapper.find('[data-storage-warning] a')
    expect(link.text()).toBe('desktop app')
    expect(link.attributes('href')).toBe(
      'https://github.com/inksprite-io/inksprite/releases/latest'
    )
    expect(warning(wrapper)).not.toContain('Safari')
  })

  it('warns Safari about the week, in bold red, on a line of its own', () => {
    platform.advice = { clearsAfterAWeek: true, homeScreen: false, desktopApp: true }
    const wrapper = mountWelcome()
    const line = wrapper.find('[data-safari-warning]')
    expect(line.element.tagName).toBe('P')
    expect(line.text()).toBe("Safari clears a site's data after a week without a visit.")
    expect(line.find('strong').classes()).toContain('text-red-600')
  })

  it("offers an iPhone the Home Screen on Safari's line, and Apple's steps for it", () => {
    platform.advice = { clearsAfterAWeek: true, homeScreen: true, desktopApp: false }
    const wrapper = mountWelcome()
    const line = wrapper.find('[data-safari-warning]')
    expect(line.text().replace(/\s+/g, ' ')).toBe(
      "Safari clears a site's data after a week without a visit. To keep it, add inksprite to your Home Screen."
    )
    const link = line.find('a')
    expect(link.text()).toBe('Home Screen')
    expect(link.attributes('href')).toMatch(/^https:\/\/support\.apple\.com\/guide\/iphone\//)
    expect(warning(wrapper)).not.toContain('desktop app')
  })

  it('offers a phone neither', () => {
    platform.advice = { clearsAfterAWeek: false, homeScreen: false, desktopApp: false }
    const wrapper = mountWelcome()
    expect(warning(wrapper)).toMatch(/back up your data from Settings › System › Data\.$/)
  })

  it('says nothing about browser storage in the desktop app', () => {
    platform.desktop = true
    const wrapper = mountWelcome()
    expect(wrapper.text()).not.toContain('Browser storage')
    expect(warning(wrapper)).toBeNull()
  })
})
