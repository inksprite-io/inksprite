import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'
import PrimeVue from 'primevue/config'
import LibraryMoveToast from '@/components/writer/settings/LibraryMoveToast.vue'

const move = vi.hoisted(() => ({ state: /** @type {any} */ (null) }))

vi.mock('@/composables/useLibraryMove.js', () => ({ useLibraryMove: () => move }))

const mountToast = () =>
  mount(LibraryMoveToast, { global: { plugins: [PrimeVue] }, attachTo: document.body })

const dialogOf = wrapper => /** @type {HTMLDialogElement} */ (wrapper.find('dialog').element)

describe('LibraryMoveToast', () => {
  beforeEach(() => {
    move.state = reactive({ moving: false, progress: null })
  })

  it('is not there while nothing is moving', () => {
    const wrapper = mountToast()

    expect(dialogOf(wrapper).open).toBe(false)
    wrapper.unmount()
  })

  it('shuts the page while the projects go into the folder, and says how far they are', async () => {
    const wrapper = mountToast()

    move.state.moving = true
    await nextTick()
    expect(dialogOf(wrapper).open).toBe(true)
    expect(wrapper.text()).toContain('Moving projects into a folder')
    expect(wrapper.findComponent({ name: 'ProgressBar' }).props('mode')).toBe('indeterminate')

    move.state.progress = { title: 'Novel', index: 1, count: 3, fraction: 0.5 }
    await nextTick()
    expect(wrapper.find('[data-library-move-project]').text()).toBe('Novel · 2 of 3')
    expect(wrapper.findComponent({ name: 'ProgressBar' }).props()).toMatchObject({
      mode: 'determinate',
      value: 50,
    })

    move.state.moving = false
    await nextTick()
    expect(dialogOf(wrapper).open).toBe(false)
    wrapper.unmount()
  })

  it('names only the project when it is the one there is', async () => {
    move.state.moving = true
    move.state.progress = { title: 'Novel', index: 0, count: 1, fraction: 0.2 }
    const wrapper = mountToast()
    await nextTick()

    expect(dialogOf(wrapper).open).toBe(true)
    expect(wrapper.find('[data-library-move-project]').text()).toBe('Novel')
    wrapper.unmount()
  })

  it('opens again if it is closed while the projects are moving', async () => {
    const wrapper = mountToast()
    move.state.moving = true
    await nextTick()

    dialogOf(wrapper).close()
    await nextTick()

    expect(dialogOf(wrapper).open).toBe(true)
    wrapper.unmount()
  })
})
