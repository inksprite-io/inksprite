import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { useLastOpened } from '@/composables/useLastOpened.js'

const markOpened = vi.fn()
vi.mock('@/stores/projectViewsStore.js', () => ({
  useProjectViewsStore: () => ({ markOpened }),
}))

describe('useLastOpened', () => {
  const open = ref('')

  const mountIt = () =>
    mount({
      template: '<div />',
      setup: () => useLastOpened(() => open.value),
    })

  beforeEach(() => {
    open.value = ''
    markOpened.mockClear()
  })

  it('marks each project as it opens', async () => {
    mountIt()
    open.value = 'a'
    await nextTick()
    expect(markOpened).toHaveBeenCalledWith('a')

    open.value = 'b'
    await nextTick()
    expect(markOpened).toHaveBeenLastCalledWith('b')
  })

  it('marks nothing when no project is open', async () => {
    mountIt()
    open.value = 'a'
    await nextTick()
    markOpened.mockClear()

    open.value = ''
    await nextTick()
    window.dispatchEvent(new window.Event('focus'))
    expect(markOpened).not.toHaveBeenCalled()
  })

  it('marks the project open when the window comes forward, until it is gone', async () => {
    const wrapper = mountIt()
    open.value = 'a'
    await nextTick()
    markOpened.mockClear()

    window.dispatchEvent(new window.Event('focus'))
    expect(markOpened).toHaveBeenCalledWith('a')

    wrapper.unmount()
    markOpened.mockClear()
    window.dispatchEvent(new window.Event('focus'))
    expect(markOpened).not.toHaveBeenCalled()
  })
})
