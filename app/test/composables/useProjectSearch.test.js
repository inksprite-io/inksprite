import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const leaveFocus = vi.fn()

vi.mock('@/composables/useDocuments.js', () => ({ useDocuments: () => ({}) }))
vi.mock('@/composables/useEditor.js', () => ({ useEditor: () => ({}) }))
vi.mock('@/composables/useFocusMode.js', () => ({ useFocusMode: () => ({ leave: leaveFocus }) }))

const { hideSearch, searchShowing, showSearch, takeSearchField, useProjectSearchKey } =
  await import('@/composables/useProjectSearch.js')
const { useSidebarTab } = await import('@/composables/useSidebarTab.js')

const mod = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }

/** Press Mod-Shift-F, as anywhere in the writer. */
const pressSearchKey = () => {
  const event = new window.KeyboardEvent('keydown', {
    key: 'F',
    shiftKey: true,
    cancelable: true,
    ...mod,
  })
  window.dispatchEvent(event)
  return event
}

/**
 * The writer's frame, on a project or on none.
 * @param {string} storyId
 */
const mountFrame = storyId =>
  mount({
    setup() {
      useProjectSearchKey(() => storyId)
      return () => null
    },
  })

let story = 0
/** A project of its own each time, since each keeps its search. */
const nextStory = () => `story_${++story}`

describe('the search showing', () => {
  beforeEach(() => {
    takeSearchField()
    useSidebarTab().take()
    leaveFocus.mockClear()
  })

  it('shows in the outline’s place once asked for, with its field asked for, until closed', () => {
    const storyId = nextStory()
    const showing = searchShowing(storyId)
    expect(showing.value).toBe(false)

    showSearch(storyId)
    expect(showing.value).toBe(true)
    expect(takeSearchField()).toBe(true)
    expect(takeSearchField()).toBe(false)

    hideSearch(storyId)
    expect(showing.value).toBe(false)
  })

  it('is each project’s own', () => {
    const [one, other] = [nextStory(), nextStory()]
    showSearch(one)

    expect(searchShowing(one).value).toBe(true)
    expect(searchShowing(other).value).toBe(false)
  })

  it('shows on Mod-Shift-F, where the outline shows and out of focus mode', () => {
    const storyId = nextStory()
    const frame = mountFrame(storyId)
    const event = pressSearchKey()

    expect(event.defaultPrevented).toBe(true)
    expect(searchShowing(storyId).value).toBe(true)
    expect(useSidebarTab().take()).toBe('outline')
    expect(takeSearchField()).toBe(true)
    expect(leaveFocus).toHaveBeenCalled()
    frame.unmount()
  })

  it('leaves the key alone with no project open, and once the frame has gone', () => {
    const none = mountFrame('')
    expect(pressSearchKey().defaultPrevented).toBe(false)
    none.unmount()

    const storyId = nextStory()
    mountFrame(storyId).unmount()
    expect(pressSearchKey().defaultPrevented).toBe(false)
    expect(searchShowing(storyId).value).toBe(false)
  })
})
