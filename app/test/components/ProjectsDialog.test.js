import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ProjectsDialog from '@/components/writer/projects/ProjectsDialog.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { LONG_PRESS_MS } from '@/composables/useLongPress.js'

const projects = vi.hoisted(() => ({
  rows: { value: [] },
  elsewhere: { value: new Set() },
  pick: vi.fn(),
  lookElsewhere: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('@/composables/useProjects', () => ({ useProjects: () => projects }))

const Dialog = {
  name: 'Dialog',
  props: ['visible', 'header'],
  emits: ['update:visible'],
  template: '<div v-if="visible" role="dialog"><slot /></div>',
}

const HOUR = 3600000
const now = Date.now()

describe('ProjectsDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    useApplicationState().setState('ui.projectOrder', undefined)
    projects.elsewhere.value = new Set()
    projects.rows.value = [
      { id: 'a', name: 'Apple', edited: now - 3 * HOUR, created: Date.UTC(2026, 0, 15, 12) },
      { id: 'b', name: 'Banana', edited: now - HOUR, created: Date.UTC(2026, 4, 15, 12) },
      { id: 'c', name: 'Cherry', edited: now - 2 * HOUR, created: Date.UTC(2025, 2, 15, 12) },
    ]
  })

  const mountDialog = async (props = {}) => {
    const wrapper = mount(ProjectsDialog, {
      props: { visible: false, storyId: 'b', ...props },
      global: { plugins: [PrimeVue], stubs: { Dialog } },
    })
    await wrapper.setProps({ visible: true })
    await flushPromises()
    return wrapper
  }

  /** The names in the table, in order. */
  const names = wrapper =>
    wrapper.findAll('[data-project]').map(row => row.find('td span.truncate').text())

  const search = wrapper => wrapper.find('[data-project-search]')

  it('lists every project with when it was edited and made, the latest edited first', async () => {
    const wrapper = await mountDialog()

    expect(names(wrapper)).toEqual(['Banana', 'Cherry', 'Apple'])
    const cells = wrapper.findAll('[data-project="a"] td').map(cell => cell.text())
    expect(cells).toEqual(['Apple', '3h ago', 'Jan 15, 2026'])
  })

  it('reads the list again each time it opens, and starts over', async () => {
    const wrapper = await mountDialog()
    expect(projects.refresh).toHaveBeenCalledTimes(1)
    expect(projects.lookElsewhere).toHaveBeenCalledTimes(1)
    await search(wrapper).setValue('apple')

    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true })
    await flushPromises()

    expect(projects.refresh).toHaveBeenCalledTimes(2)
    expect(search(wrapper).element.value).toBe('')
    expect(names(wrapper)).toHaveLength(3)
  })

  it('sorts by a column, names from A and times from the latest, and back on a second click', async () => {
    const wrapper = await mountDialog()

    await wrapper.find('[data-sort="name"]').trigger('click')
    expect(names(wrapper)).toEqual(['Apple', 'Banana', 'Cherry'])

    await wrapper.find('[data-sort="name"]').trigger('click')
    expect(names(wrapper)).toEqual(['Cherry', 'Banana', 'Apple'])

    await wrapper.find('[data-sort="created"]').trigger('click')
    expect(names(wrapper)).toEqual(['Banana', 'Apple', 'Cherry'])

    await wrapper.find('[data-sort="edited"]').trigger('click')
    expect(names(wrapper)).toEqual(['Banana', 'Cherry', 'Apple'])
  })

  it('says which column it is sorted by, and which way', async () => {
    const wrapper = await mountDialog()
    const sortOf = key => wrapper.find(`[data-sort="${key}"]`).element.closest('th')

    expect(sortOf('edited').getAttribute('aria-sort')).toBe('descending')
    expect(sortOf('name').getAttribute('aria-sort')).toBeNull()

    await wrapper.find('[data-sort="name"]').trigger('click')
    expect(sortOf('name').getAttribute('aria-sort')).toBe('ascending')
    expect(sortOf('edited').getAttribute('aria-sort')).toBeNull()
  })

  it('keeps the order chosen for next time', async () => {
    const first = await mountDialog()
    await first.find('[data-sort="name"]').trigger('click')
    first.unmount()

    const second = await mountDialog()
    expect(names(second)).toEqual(['Apple', 'Banana', 'Cherry'])
  })

  it('goes back to the latest edited first when what was kept makes no sense', async () => {
    useApplicationState().setState('ui.projectOrder', { by: 'nonsense', descending: false })
    const wrapper = await mountDialog()
    expect(names(wrapper)).toEqual(['Banana', 'Cherry', 'Apple'])
  })

  it('finds projects by name as it is typed, and says when none has it', async () => {
    const wrapper = await mountDialog()

    await search(wrapper).setValue('CHER')
    expect(names(wrapper)).toEqual(['Cherry'])
    expect(wrapper.find('[data-no-projects]').exists()).toBe(false)

    await search(wrapper).setValue('nothing like it')
    expect(names(wrapper)).toEqual([])
    expect(wrapper.find('[data-no-projects]').text()).toBe('No projects match.')
  })

  it('opens the project picked and closes, passing on the click for a new window', async () => {
    const wrapper = await mountDialog()

    await wrapper.find('[data-project="c"]').trigger('click', { metaKey: true })

    expect(projects.pick).toHaveBeenCalledTimes(1)
    const [storyId, event] = projects.pick.mock.calls[0]
    expect(storyId).toBe('c')
    expect(event.metaKey).toBe(true)
    expect(wrapper.emitted('update:visible')).toEqual([[false]])
  })

  it('only closes when the project picked is the one open', async () => {
    const wrapper = await mountDialog()

    await wrapper.find('[data-project="b"]').trigger('click')

    expect(projects.pick).not.toHaveBeenCalled()
    expect(wrapper.emitted('update:visible')).toEqual([[false]])
  })

  it('marks the project open, and those open in another window', async () => {
    projects.elsewhere.value = new Set(['c'])
    const wrapper = await mountDialog()

    const open = wrapper.find('[data-project="b"]')
    expect(open.find('button').attributes('aria-current')).toBe('true')
    expect(open.find('i').classes()).toContain('pi-check')

    const away = wrapper.find('[data-project="c"]')
    expect(away.text()).toContain('Open in another window')
    expect(away.find('i').classes()).toContain('pi-clone')
    expect(wrapper.find('[data-project="a"]').text()).not.toContain('Open in another window')
  })

  it('asks for a project’s own menu when one is right-clicked', async () => {
    const wrapper = await mountDialog()

    await wrapper.find('[data-project="c"]').trigger('contextmenu')

    const [[event, storyId]] = wrapper.emitted('project-menu')
    expect(event.type).toBe('contextmenu')
    expect(storyId).toBe('c')
    expect(projects.pick).not.toHaveBeenCalled()
  })

  it('asks for it under a finger held on a project, where the finger is', async () => {
    const wrapper = await mountDialog()
    vi.useFakeTimers()
    try {
      await wrapper
        .find('[data-project="a"]')
        .trigger('touchstart', { touches: [{ clientX: 30, clientY: 40 }] })
      expect(wrapper.emitted('project-menu')).toBeUndefined()

      vi.advanceTimersByTime(LONG_PRESS_MS)

      const [[event, storyId]] = wrapper.emitted('project-menu')
      expect(event).toMatchObject({ pageX: 30, pageY: 40 })
      expect(storyId).toBe('a')
    } finally {
      vi.useRealTimers()
    }
  })

  it('can have the caret put back in the search', async () => {
    const wrapper = await mountDialog()
    const mask = document.createElement('div')
    const input = document.createElement('input')
    input.setAttribute('data-project-search', '')
    mask.append(input)
    document.body.append(mask)
    wrapper.findComponent({ name: 'Dialog' }).vm.mask = mask

    wrapper.vm.focusSearch()

    expect(document.activeElement).toBe(input)
    mask.remove()
  })

  describe('from the keyboard', () => {
    const chosenRow = wrapper => wrapper.find('tr.bg-surface-200').attributes('data-project')

    it('starts on the first project that is not the one open', async () => {
      const wrapper = await mountDialog()
      expect(chosenRow(wrapper)).toBe('c')

      await search(wrapper).trigger('keydown', { key: 'Enter' })
      expect(projects.pick.mock.calls[0][0]).toBe('c')
      expect(wrapper.emitted('update:visible')).toEqual([[false]])
    })

    it('starts on the only match, though it is the one open', async () => {
      const wrapper = await mountDialog()
      await search(wrapper).setValue('banana')
      expect(chosenRow(wrapper)).toBe('b')
    })

    it('moves with the arrows, stopping at the ends', async () => {
      const wrapper = await mountDialog()
      const press = async key => {
        await search(wrapper).trigger('keydown', { key })
        await nextTick()
      }

      await press('ArrowDown')
      expect(chosenRow(wrapper)).toBe('a')
      await press('ArrowDown')
      expect(chosenRow(wrapper)).toBe('a')
      await press('ArrowUp')
      await press('ArrowUp')
      expect(chosenRow(wrapper)).toBe('b')
      await press('ArrowUp')
      expect(chosenRow(wrapper)).toBe('b')
    })

    it('follows the pointer', async () => {
      const wrapper = await mountDialog()
      await wrapper.find('[data-project="a"]').trigger('mousemove')
      expect(chosenRow(wrapper)).toBe('a')
    })

    it('starts again on the first when the search or the order changes', async () => {
      const wrapper = await mountDialog()
      await wrapper.find('[data-project="a"]').trigger('mousemove')

      await wrapper.find('[data-sort="name"]').trigger('click')
      expect(chosenRow(wrapper)).toBe('a')
      await wrapper.find('[data-project="c"]').trigger('mousemove')
      await search(wrapper).setValue('a')
      expect(chosenRow(wrapper)).toBe('a')
    })

    it('leaves the Enter that ends typing in an input method alone', async () => {
      const wrapper = await mountDialog()
      await search(wrapper).trigger('keydown', { key: 'Enter', isComposing: true })
      expect(projects.pick).not.toHaveBeenCalled()
    })

    it('does nothing on Enter with nothing found', async () => {
      const wrapper = await mountDialog()
      await search(wrapper).setValue('nothing like it')
      await search(wrapper).trigger('keydown', { key: 'Enter' })
      expect(projects.pick).not.toHaveBeenCalled()
      expect(wrapper.emitted('update:visible')).toBeUndefined()
    })
  })
})
