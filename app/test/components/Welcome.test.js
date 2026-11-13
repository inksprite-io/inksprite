import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Welcome from '@/components/common/Welcome.vue'

const { platform, setShowWelcomeDialog } = vi.hoisted(() => ({
  platform: {
    desktop: false,
    advice: { clearsAfterAWeek: false, homeScreen: false, desktopApp: true },
  },
  setShowWelcomeDialog: vi.fn(),
}))

vi.mock('@/platform/desktop.js', () => ({ isDesktop: () => platform.desktop }))
vi.mock('@/platform/persistence.js', () => ({ storageAdvice: () => platform.advice }))
vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => ({ setShowWelcomeDialog }),
}))

const mountWelcome = () =>
  mount(Welcome, {
    props: { visible: true },
    global: {
      plugins: [PrimeVue],
      stubs: {
        Dialog: { template: '<div><slot /><slot name="footer" /></div>' },
        ScrollPanel: { template: '<div><slot /></div>' },
      },
    },
  })

/** The welcome's alerts. */
const boxes = wrapper => wrapper.findAll('[data-welcome] [data-alert]')

/** The paragraphs in the welcome's alert, after its title, their spaces as one. */
const boxText = wrapper =>
  wrapper
    .findAll('[data-welcome] [data-alert] > p')
    .slice(1)
    .map(p => p.text().replace(/\s+/g, ' '))

const BROWSER =
  "Your work is stored only in this browser. If this site's data is cleared, it's gone."
const SAFARI = "Safari clears a site's data after a week without a visit."

describe('Welcome', () => {
  beforeEach(() => {
    platform.desktop = false
    platform.advice = { clearsAfterAWeek: false, homeScreen: false, desktopApp: true }
    setShowWelcomeDialog.mockClear()
  })

  it('opens on the welcome, laid out as the settings are', () => {
    const wrapper = mountWelcome()
    expect(wrapper.find('h2').text()).toBe('Welcome to inksprite')
    expect(wrapper.find('[aria-current="page"]').attributes('data-section')).toBe('welcome')
  })

  it('lists its sections in order: the welcome, the guide, feedback, the terms', () => {
    const wrapper = mountWelcome()

    expect(wrapper.find('nav').attributes('aria-label')).toBe('Welcome sections')
    expect(wrapper.findAll('[data-section]').map(button => button.text())).toEqual([
      'Welcome',
      'Getting started',
      'Feedback',
      'Terms of Service',
    ])
    // None of them shown a part at a time, as some of the settings are.
    expect(wrapper.find('[data-section-parts]').exists()).toBe(false)
  })

  it('points to the user guide from Getting started, in a tab of its own', async () => {
    const wrapper = mountWelcome()
    await wrapper.find('[data-section="getting-started"]').trigger('click')

    expect(wrapper.find('h2').text()).toBe('Getting started')
    expect(wrapper.find('[data-welcome]').exists()).toBe(false)
    const links = wrapper.findAll('a')
    expect(links.map(a => [a.text(), a.attributes('href')])).toEqual([
      ['docs.inksprite.io', 'https://docs.inksprite.io/'],
    ])
    expect(links[0].attributes('target')).toBe('_blank')
  })

  it('points to GitHub’s issues and discussions from Feedback', async () => {
    const wrapper = mountWelcome()
    await wrapper.find('[data-section="feedback"]').trigger('click')

    expect(wrapper.find('h2').text()).toBe('Feedback')
    const links = wrapper.findAll('a')
    expect(links.map(a => [a.text(), a.attributes('href')])).toEqual([
      ['Issues', 'https://github.com/inksprite-io/inksprite/issues'],
      ['Discussions', 'https://github.com/inksprite-io/inksprite/discussions'],
    ])
    for (const link of links) expect(link.attributes('target')).toBe('_blank')
  })

  it('says what inksprite is for, in lists within a list', () => {
    const wrapper = mountWelcome()
    expect(wrapper.find('[data-welcome] p').text()).toMatch(/^inksprite is /)
    expect(wrapper.find('[data-welcome] ul ul li').exists()).toBe(true)
  })

  it('has the terms, and the footer points to them from any section', async () => {
    const wrapper = mountWelcome()
    await wrapper.find('[data-terms-agreement] button').trigger('click')
    expect(wrapper.find('h2').text()).toBe('Terms of Service')
    expect(wrapper.findAll('h3').map(h => h.text())).toContain('No Warranty')
  })

  it('is put away by Start writing', async () => {
    const wrapper = mountWelcome()
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Start writing')
      .trigger('click')
    expect(setShowWelcomeDialog).toHaveBeenCalledWith(false)
  })

  it('warns in one Important box that the work is only in this browser', () => {
    const wrapper = mountWelcome()
    expect(boxes(wrapper).map(box => box.attributes('data-alert'))).toEqual(['important'])
    expect(boxText(wrapper)[0]).toBe(BROWSER)
  })

  it('offers a computer the latest desktop release, in the box', () => {
    const wrapper = mountWelcome()
    const link = wrapper.find('[data-alert] a')
    expect(link.text()).toBe('GitHub releases page')
    expect(link.attributes('href')).toBe(
      'https://github.com/inksprite-io/inksprite/releases/latest'
    )
    expect(link.attributes('target')).toBe('_blank')
    expect(boxText(wrapper)).toHaveLength(2)
  })

  it('warns Safari about the week on a line of its own, in the same box', () => {
    platform.advice = { clearsAfterAWeek: true, homeScreen: false, desktopApp: true }
    const wrapper = mountWelcome()
    expect(boxes(wrapper)).toHaveLength(1)
    expect(boxText(wrapper).slice(0, 2)).toEqual([BROWSER, SAFARI])
  })

  it("offers an iPhone the Home Screen on Safari's line, and Apple's steps for it", () => {
    platform.advice = { clearsAfterAWeek: true, homeScreen: true, desktopApp: false }
    const wrapper = mountWelcome()
    expect(boxText(wrapper)).toEqual([
      BROWSER,
      `${SAFARI} To keep it, add inksprite to your Home Screen.`,
    ])
    const link = wrapper.find('[data-alert] a')
    expect(link.text()).toBe('Home Screen')
    expect(link.attributes('href')).toMatch(/^https:\/\/support\.apple\.com\/guide\/iphone\//)
  })

  it('offers a phone neither', () => {
    platform.advice = { clearsAfterAWeek: false, homeScreen: false, desktopApp: false }
    expect(boxText(mountWelcome())).toEqual([BROWSER])
  })

  it('says nothing about browser storage in the desktop app', () => {
    platform.desktop = true
    const wrapper = mountWelcome()
    expect(boxes(wrapper)).toHaveLength(0)
    expect(wrapper.text()).not.toContain('stored only in this browser')
  })
})
