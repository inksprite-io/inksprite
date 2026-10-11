import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import EditorTabs from '@/components/writer/editor/EditorTabs.vue'

const items = [
  { id: 'doc_1', title: 'Chapter One' },
  { id: 'doc_2', title: 'Chapter Two' },
]

const mountStrip = (props = {}, slots = {}) =>
  mount(EditorTabs, {
    props: { items, activeId: 'doc_1', ...props },
    slots,
    global: { plugins: [PrimeVue] },
  })

const tab = (wrapper, id) => wrapper.find(`[data-tab-id="${id}"]`)

describe('EditorTabs', () => {
  it('shows the open documents in order, with the one showing marked', () => {
    const wrapper = mountStrip()
    const tabs = wrapper.findAll('[role="tab"]')
    expect(tabs.map(t => t.text())).toEqual(['Chapter One', 'Chapter Two'])
    expect(tab(wrapper, 'doc_1').attributes('aria-selected')).toBe('true')
    expect(tab(wrapper, 'doc_2').attributes('aria-selected')).toBe('false')
  })

  it('asks for a tab to be brought forward', async () => {
    const wrapper = mountStrip()
    await tab(wrapper, 'doc_2').trigger('click')
    expect(wrapper.emitted('activate')).toEqual([['doc_2']])
  })

  it('asks for a tab to be kept on a double-click', async () => {
    const wrapper = mountStrip()
    await tab(wrapper, 'doc_2').trigger('dblclick')
    expect(wrapper.emitted('keep')).toEqual([['doc_2']])
  })

  it('asks for a tab to be closed from its button, without bringing it forward', async () => {
    const wrapper = mountStrip()
    await tab(wrapper, 'doc_2').find('button').trigger('click')
    expect(wrapper.emitted('close')).toEqual([['doc_2']])
    expect(wrapper.emitted('activate')).toBeUndefined()
  })

  it('closes on a middle click', async () => {
    const wrapper = mountStrip()
    await tab(wrapper, 'doc_2').trigger('auxclick', { button: 1 })
    expect(wrapper.emitted('close')).toEqual([['doc_2']])
  })

  it('ignores other auxiliary clicks', async () => {
    const wrapper = mountStrip()
    await tab(wrapper, 'doc_2').trigger('auxclick', { button: 2 })
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('marks a document in the plain text editor, and no other', () => {
    const wrapper = mountStrip({ items: [items[0], { ...items[1], plain: true }] })
    expect(tab(wrapper, 'doc_1').find('[data-plain]').exists()).toBe(false)
    expect(tab(wrapper, 'doc_2').find('[data-plain]').exists()).toBe(true)
  })

  it('is named by its title, and not by its close button', () => {
    const wrapper = mountStrip({ items: [items[0], { ...items[1], plain: true }] })
    expect(tab(wrapper, 'doc_1').attributes('aria-label')).toBe(items[0].title)
    expect(tab(wrapper, 'doc_2').attributes('aria-label')).toBe(`${items[1].title}, plain text`)
  })

  describe('from the keyboard', () => {
    it('is one stop for Tab, on the tab showing', () => {
      const wrapper = mountStrip({ activeId: 'doc_2' })
      expect(tab(wrapper, 'doc_1').attributes('tabindex')).toBe('-1')
      expect(tab(wrapper, 'doc_2').attributes('tabindex')).toBe('0')
      expect(tab(wrapper, 'doc_2').find('button').attributes('tabindex')).toBe('-1')
    })

    it('brings a tab forward on Enter and on Space, and closes it on Delete', async () => {
      const wrapper = mountStrip()
      await tab(wrapper, 'doc_2').trigger('keydown', { key: 'Enter' })
      await tab(wrapper, 'doc_2').trigger('keydown', { key: ' ' })
      await tab(wrapper, 'doc_2').trigger('keydown', { key: 'Delete' })
      expect(wrapper.emitted('activate')).toEqual([['doc_2'], ['doc_2']])
      expect(wrapper.emitted('close')).toEqual([['doc_2']])
    })

    it('goes along the strip with the arrows', async () => {
      const wrapper = mountStrip()
      document.body.appendChild(wrapper.element)
      await tab(wrapper, 'doc_1').trigger('keydown', { key: 'ArrowRight' })
      expect(document.activeElement).toBe(tab(wrapper, 'doc_2').element)
      await tab(wrapper, 'doc_2').trigger('keydown', { key: 'ArrowRight' })
      expect(document.activeElement).toBe(tab(wrapper, 'doc_1').element)
      wrapper.element.remove()
    })
  })

  it('names the close button after its document', () => {
    const wrapper = mountStrip()
    expect(tab(wrapper, 'doc_1').find('button').attributes('aria-label')).toBe('Close Chapter One')
  })

  it('opens a menu of what the panel offers on right-click', async () => {
    const actions = vi.fn(id => [{ label: `Copy ${id}` }])
    const wrapper = mountStrip({ actions })
    const menu = wrapper.findComponent({ name: 'ContextMenu' })

    await tab(wrapper, 'doc_2').trigger('contextmenu', { clientX: 40, clientY: 12 })

    expect(menu.emitted('before-show')).toHaveLength(1)
    expect(actions).toHaveBeenCalledWith('doc_2')
    expect(menu.props('model').map(item => item.label)).toEqual(['Copy doc_2'])
  })

  it('has no menu when the panel offers nothing', () => {
    const wrapper = mountStrip()
    expect(wrapper.findComponent({ name: 'ContextMenu' }).exists()).toBe(false)
  })

  it('puts what the panel gives it at the far end, outside the tabs’ scroll', () => {
    const wrapper = mountStrip({}, { end: '<span data-end />' })
    expect(wrapper.find('[data-end]').exists()).toBe(true)
    // Beside the scrolling list, not in it: a strip full of tabs would
    // otherwise carry it off the edge.
    expect(wrapper.find('[role="tablist"] [data-end]').exists()).toBe(false)
    expect(mountStrip().find('[data-end]').exists()).toBe(false)
  })

  describe('scrolling the strip', () => {
    /** A strip wider than its room, the way a full one is. */
    const overflowing = wrapper => {
      const strip = wrapper.find('[role="tablist"]').element
      Object.defineProperty(strip, 'scrollWidth', { value: 600, configurable: true })
      Object.defineProperty(strip, 'clientWidth', { value: 300, configurable: true })
      let left = 0
      Object.defineProperty(strip, 'scrollLeft', {
        get: () => left,
        set: value => {
          left = value
        },
        configurable: true,
      })
      return strip
    }
    const turn = (strip, init) => {
      const event = new window.WheelEvent('wheel', { cancelable: true, ...init })
      strip.dispatchEvent(event)
      return event
    }

    it('scrolls the tabs along when turned up or down', () => {
      const strip = overflowing(mountStrip())

      expect(turn(strip, { deltaY: 40 }).defaultPrevented).toBe(true)
      expect(strip.scrollLeft).toBe(40)
      expect(turn(strip, { deltaY: -10 }).defaultPrevented).toBe(true)
      expect(strip.scrollLeft).toBe(30)
    })

    it('counts a wheel that turns in lines as a tab’s height per line', () => {
      const strip = overflowing(mountStrip())
      turn(strip, { deltaY: 2, deltaMode: 1 })
      expect(strip.scrollLeft).toBe(72)
    })

    it('leaves a sideways turn to the browser, which scrolls it already', () => {
      const strip = overflowing(mountStrip())
      expect(turn(strip, { deltaX: 20, deltaY: 5 }).defaultPrevented).toBe(false)
      expect(strip.scrollLeft).toBe(0)
    })

    it('leaves the wheel to the page when every tab fits', () => {
      const strip = wrapper => wrapper.find('[role="tablist"]').element
      const event = turn(strip(mountStrip()), { deltaY: 40 })
      expect(event.defaultPrevented).toBe(false)
    })

    it('lays a thumb over the tabs while they scroll, and lets it fade after', async () => {
      vi.useFakeTimers()
      try {
        const wrapper = mountStrip()
        const strip = overflowing(wrapper)
        expect(wrapper.find('[data-scroll-thumb]').exists()).toBe(false)

        strip.scrollLeft = 150
        strip.dispatchEvent(new window.Event('scroll'))
        await wrapper.vm.$nextTick()

        const thumb = wrapper.find('[data-scroll-thumb]')
        expect(thumb.classes()).toContain('opacity-100')
        // Half the tabs are in view, so the thumb is half the strip, and
        // halfway along it.
        expect(thumb.element.style.width).toBe('150px')
        expect(thumb.element.style.left).toBe('75px')

        vi.advanceTimersByTime(1000)
        await wrapper.vm.$nextTick()
        expect(thumb.classes()).toContain('opacity-0')
      } finally {
        vi.useRealTimers()
      }
    })

    it('draws no thumb when every tab fits', () => {
      expect(mountStrip().find('[data-scroll-thumb]').exists()).toBe(false)
    })
  })
})
