import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'

/** The writer's theme, as the app's state keeps it. */
const state = vi.hoisted(() => ({ theme: /** @type {import('vue').Ref<string>} */ (null) }))
vi.mock('@/composables/useApplicationState.js', async () => {
  const { ref } = await import('vue')
  state.theme = ref('system')
  return { useApplicationState: () => ({ theme: state.theme }) }
})

import { TITLE_BAR_COLORS, applyTheme, useTheme } from '@/composables/useSystemSettings.js'

/** The system's theme, which a test changes as the system would. */
const system = {
  dark: false,
  listeners: new Set(),
  /** @param {boolean} dark */
  change(dark) {
    this.dark = dark
    for (const listener of this.listeners) listener()
  },
}

/** The title bar's colours, as index.html has them: one per system theme. */
const titleBar = () =>
  [...document.querySelectorAll('meta[name="theme-color"]')].map(meta =>
    meta.getAttribute('content')
  )

const isDark = () => document.documentElement.classList.contains('dark')

/** The app, as far as the theme goes. */
const mountApp = () =>
  mount(
    defineComponent({
      setup() {
        useTheme()
        return () => h('div')
      },
    })
  )

beforeEach(() => {
  document.head.innerHTML = `
    <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
    <meta name="theme-color" content="#18181b" media="(prefers-color-scheme: dark)" />`
  system.dark = false
  system.listeners.clear()
  vi.stubGlobal('matchMedia', (/** @type {string} */ query) => ({
    get matches() {
      return system.dark && query.includes('dark')
    },
    media: query,
    addEventListener: (/** @type {string} */ _, /** @type {() => void} */ listener) =>
      system.listeners.add(listener),
    removeEventListener: (/** @type {string} */ _, /** @type {() => void} */ listener) =>
      system.listeners.delete(listener),
  }))
})

afterEach(() => {
  document.head.innerHTML = ''
  document.documentElement.className = ''
  vi.unstubAllGlobals()
})

describe('applyTheme', () => {
  it('turns the page dark, for PrimeVue and Tailwind', () => {
    applyTheme('dark')
    expect(document.documentElement.classList.contains('inksprite-dark')).toBe(true)
    expect(isDark()).toBe(true)

    applyTheme('light')
    expect(document.documentElement.className).toBe('')
  })

  it('gives the title bar the dark theme colour, whatever the system theme', () => {
    applyTheme('dark')
    expect(titleBar()).toEqual([TITLE_BAR_COLORS.dark, TITLE_BAR_COLORS.dark])
  })

  it('gives the title bar the light theme colour, whatever the system theme', () => {
    system.dark = true
    applyTheme('light')
    expect(titleBar()).toEqual([TITLE_BAR_COLORS.light, TITLE_BAR_COLORS.light])
  })

  it('follows the system theme when asked to', () => {
    system.dark = true
    applyTheme('system')
    expect(isDark()).toBe(true)
    expect(titleBar()).toEqual([TITLE_BAR_COLORS.dark, TITLE_BAR_COLORS.dark])

    system.dark = false
    applyTheme('system')
    expect(isDark()).toBe(false)
    expect(titleBar()).toEqual([TITLE_BAR_COLORS.light, TITLE_BAR_COLORS.light])
  })
})

describe('useTheme', () => {
  it('puts the page in the writer theme as the app opens, and as it is changed', async () => {
    state.theme.value = 'dark'
    mountApp()
    expect(isDark()).toBe(true)

    state.theme.value = 'light'
    await nextTick()
    expect(isDark()).toBe(false)
  })

  it('follows the system theme as it changes, while the theme is System', () => {
    state.theme.value = 'system'
    mountApp()
    expect(isDark()).toBe(false)

    system.change(true)
    expect(isDark()).toBe(true)
    expect(titleBar()).toEqual([TITLE_BAR_COLORS.dark, TITLE_BAR_COLORS.dark])

    system.change(false)
    expect(isDark()).toBe(false)
  })

  it('keeps a chosen theme when the system theme changes', () => {
    state.theme.value = 'light'
    mountApp()

    system.change(true)
    expect(isDark()).toBe(false)
  })

  it('stops listening to the system when the app is gone', () => {
    mountApp().unmount()
    expect(system.listeners.size).toBe(0)
  })
})
