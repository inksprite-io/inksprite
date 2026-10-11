import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Welcome from '@/components/common/Welcome.vue'

const { platform } = vi.hoisted(() => ({
  platform: {
    desktop: false,
    advice: { clearsAfterAWeek: false, homeScreen: false, desktopApp: true },
  },
}))

vi.mock('@/platform/desktop.js', () => ({ isDesktop: () => platform.desktop }))
vi.mock('@/platform/persistence.js', () => ({ storageAdvice: () => platform.advice }))

const mountWelcome = () =>
  mount(Welcome, {
    props: { visible: true },
    global: {
      plugins: [PrimeVue],
      stubs: { Dialog: { template: '<div><slot /><slot name="footer" /></div>' } },
    },
  })

/** The storage warning's text, or null without one. */
const warning = wrapper => {
  const paragraph = wrapper.find('[data-storage-warning]')
  return paragraph.exists() ? paragraph.text().replace(/\s+/g, ' ') : null
}

describe('Welcome', () => {
  beforeEach(() => {
    platform.desktop = false
    platform.advice = { clearsAfterAWeek: false, homeScreen: false, desktopApp: true }
  })

  it('warns that the work is in the browser, and where backups are', () => {
    const wrapper = mountWelcome()
    expect(wrapper.text()).toContain('Browser Storage')
    expect(warning(wrapper)).toContain(
      "Warning: all data is stored in your browser. If this site's data is deleted, your work will be lost."
    )
    expect(warning(wrapper)).toContain('Back up regularly from Settings › System.')
    expect(wrapper.find('[data-storage-warning] strong').classes()).toContain('text-red-600')
  })

  it('links a computer to the latest desktop release', () => {
    const wrapper = mountWelcome()
    const link = wrapper.find('[data-storage-warning] a')
    expect(link.text()).toBe('desktop version')
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
    expect(line.text()).toBe('Safari automatically clears site data after a week of inactivity.')
    expect(line.find('strong').classes()).toContain('text-red-600')
  })

  it("offers an iPhone the Home Screen on Safari's line, and Apple's steps for it", () => {
    platform.advice = { clearsAfterAWeek: true, homeScreen: true, desktopApp: false }
    const wrapper = mountWelcome()
    const line = wrapper.find('[data-safari-warning]')
    expect(line.text().replace(/\s+/g, ' ')).toBe(
      'Safari automatically clears site data after a week of inactivity. You can avoid this by adding inksprite to your Home Screen.'
    )
    const link = line.find('a')
    expect(link.text()).toBe('Home Screen')
    expect(link.attributes('href')).toMatch(/^https:\/\/support\.apple\.com\/guide\/iphone\//)
    expect(wrapper.text()).not.toContain('desktop version')
  })

  it('offers a phone neither', () => {
    platform.advice = { clearsAfterAWeek: false, homeScreen: false, desktopApp: false }
    const wrapper = mountWelcome()
    expect(warning(wrapper)).toMatch(/Back up regularly from Settings › System\.$/)
  })

  it('says nothing about browser storage in the desktop app', () => {
    platform.desktop = true
    const wrapper = mountWelcome()
    expect(wrapper.text()).not.toContain('Browser Storage')
    expect(warning(wrapper)).toBeNull()
  })
})
