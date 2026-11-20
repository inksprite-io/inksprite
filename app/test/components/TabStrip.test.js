import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import TabStrip from '@/components/writer/layout/TabStrip.vue'

const items = [
  { id: 'doc_1', title: 'Chapter One' },
  { id: 'doc_2', title: 'Chapter Two' },
]

const mountStrip = (props = {}, slots = {}) =>
  mount(TabStrip, {
    props: { items, activeId: 'doc_1', ...props },
    slots,
    global: { plugins: [PrimeVue] },
  })

const tab = (wrapper, id) => wrapper.find(`[data-tab-id="${id}"]`)

describe('TabStrip', () => {
  it('puts what it is given before the tabs and after them', () => {
    const wrapper = mountStrip(
      {},
      { start: '<button data-start>Back</button>', end: '<button data-end>New</button>' }
    )
    const html = wrapper.html()
    expect(html.indexOf('data-start')).toBeLessThan(html.indexOf('data-tab-id="doc_1"'))
    expect(html.indexOf('data-end')).toBeGreaterThan(html.indexOf('data-tab-id="doc_2"'))
  })

  it('keeps the tab showing in view: as it comes forward, and as it is given another name', async () => {
    const original = window.HTMLElement.prototype.scrollIntoView
    const scrolled = vi.fn()
    window.HTMLElement.prototype.scrollIntoView = scrolled
    try {
      const wrapper = mountStrip()
      await wrapper.vm.$nextTick()
      /** The tabs brought into view so far, by their ids. */
      const shown = () => scrolled.mock.contexts.map(el => el.getAttribute('data-tab-id'))
      expect(shown()).toEqual(['doc_1'])

      await wrapper.setProps({ activeId: 'doc_2' })
      await wrapper.vm.$nextTick()
      expect(shown()).toEqual(['doc_1', 'doc_2'])

      // A longer name can put the tab's end past the strip's.
      await wrapper.setProps({ items: [items[0], { id: 'doc_2', title: 'A much longer name' }] })
      await wrapper.vm.$nextTick()
      expect(shown()).toEqual(['doc_1', 'doc_2', 'doc_2'])

      // Another tab's name moves nothing.
      await wrapper.setProps({
        items: [
          { id: 'doc_1', title: 'Renamed' },
          { id: 'doc_2', title: 'A much longer name' },
        ],
      })
      await wrapper.vm.$nextTick()
      expect(shown()).toHaveLength(3)
    } finally {
      window.HTMLElement.prototype.scrollIntoView = original
    }
  })

  it('marks a chat the model is working in, and one unread, to the eye and the ear', () => {
    const wrapper = mountStrip({
      items: [
        { id: 'chat_1', title: 'Plot', mark: 'busy' },
        { id: 'chat_2', title: 'Names', mark: 'unread' },
        { id: 'chat_3', title: 'Ideas' },
      ],
      activeId: 'chat_3',
    })
    expect(tab(wrapper, 'chat_1').find('[data-mark="busy"]').exists()).toBe(true)
    expect(tab(wrapper, 'chat_1').attributes('aria-label')).toBe('Plot, working')
    expect(tab(wrapper, 'chat_2').find('[data-mark="unread"]').exists()).toBe(true)
    expect(tab(wrapper, 'chat_2').attributes('aria-label')).toBe('Names, unread')
    expect(tab(wrapper, 'chat_3').find('[data-mark]').exists()).toBe(false)
  })

  it('puts a mark where the close button is, so the title moves for none', () => {
    const wrapper = mountStrip({
      items: [
        { id: 'chat_1', title: 'Plot', mark: 'busy' },
        { id: 'chat_2', title: 'Names' },
      ],
      activeId: 'chat_2',
    })
    const close = tab(wrapper, 'chat_1').find('[aria-label="Close Plot"]')
    expect(close.find('[data-mark="busy"]').exists()).toBe(true)
    // Showing, as the tab in front's cross is, rather than only on hover.
    expect(close.classes()).toContain('opacity-100')
  })

  it('says on hover what the tab is given to say', () => {
    const wrapper = mountStrip({
      items: [{ id: 'chat_1', title: 'Plot', tooltip: 'Plot · Roleplay' }],
      activeId: 'chat_1',
    })
    expect(tab(wrapper, 'chat_1').attributes('title')).toBe('Plot · Roleplay')
  })

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

  it("marks a chat's text as the chat's, and names it with the chat", () => {
    const wrapper = mountStrip({
      items: [items[0], { id: 'chat:chat_1:prompt', title: 'System prompt', chat: 'Heist' }],
    })
    const chatTab = tab(wrapper, 'chat:chat_1:prompt')
    expect(chatTab.find('[data-chat]').exists()).toBe(true)
    expect(chatTab.find('[data-plain]').exists()).toBe(false)
    expect(tab(wrapper, 'doc_1').find('[data-chat]').exists()).toBe(false)
    expect(chatTab.attributes('aria-label')).toBe('System prompt, Heist')
  })

  it('marks a terminal as one, with the terminal’s icon, and no other tab', () => {
    const wrapper = mountStrip({
      items: [
        items[0],
        { id: 'chat:chat_1:prompt', title: 'System prompt', chat: 'Heist' },
        { id: 'terminal:1', title: 'Terminal', terminal: true },
      ],
    })
    const terminalTab = tab(wrapper, 'terminal:1')
    expect(terminalTab.find('svg[data-terminal]').exists()).toBe(true)
    // Before its title, where a chat's text has the chat's mark.
    expect(terminalTab.html().indexOf('data-terminal')).toBeLessThan(
      terminalTab.html().indexOf('Terminal</span>')
    )
    expect(terminalTab.find('[data-chat]').exists()).toBe(false)
    expect(terminalTab.find('[data-plain]').exists()).toBe(false)
    expect(tab(wrapper, 'doc_1').find('[data-terminal]').exists()).toBe(false)
    expect(tab(wrapper, 'chat:chat_1:prompt').find('[data-terminal]').exists()).toBe(false)
  })

  it('shows a terminal that rang with a dot, as a chat unread, and its icon still', () => {
    const wrapper = mountStrip({
      items: [items[0], { id: 'terminal:1', title: 'Terminal', terminal: true, mark: 'unread' }],
    })
    const terminalTab = tab(wrapper, 'terminal:1')
    expect(terminalTab.find('[data-mark="unread"]').exists()).toBe(true)
    expect(terminalTab.find('[data-terminal]').exists()).toBe(true)
    expect(terminalTab.attributes('aria-label')).toBe('Terminal, unread')
  })

  it('says a terminal is one once a program has named its tab', () => {
    const wrapper = mountStrip({
      items: [
        { id: 'terminal:1', title: 'Terminal', terminal: true },
        { id: 'terminal:2', title: 'make watch', terminal: true },
      ],
    })
    expect(tab(wrapper, 'terminal:1').attributes('aria-label')).toBe('Terminal')
    expect(tab(wrapper, 'terminal:2').attributes('aria-label')).toBe('make watch, terminal')
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

  it('opens no menu on a tab the panel offers nothing for', async () => {
    const wrapper = mountStrip({ actions: id => (id === 'doc_1' ? [{ label: 'Copy' }] : []) })
    const menu = wrapper.findComponent({ name: 'ContextMenu' })

    await tab(wrapper, 'doc_2').trigger('contextmenu')

    expect(menu.emitted('before-show')).toBeUndefined()
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

  describe('dragging a tab', () => {
    /** The list the tabs are in, which says where one was let go of. */
    const list = wrapper => wrapper.findComponent({ name: 'Draggable' })

    /**
     * Press the mouse on something in the strip, and let it go again.
     * @returns {boolean[]} Which tabs the list took up to drag, while it was down
     */
    const press = (wrapper, target) => {
      const pressed = { bubbles: true, cancelable: true, button: 0 }
      target.element.dispatchEvent(new window.PointerEvent('pointerdown', pressed))
      const taken = wrapper.findAll('[role="tab"]').map(t => t.classes('sortable-chosen'))
      document.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true }))
      document.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true }))
      return taken
    }

    it('asks for a tab to be put where it was let go of', () => {
      const wrapper = mountStrip()
      list(wrapper).vm.$emit('change', { moved: { element: items[1], oldIndex: 1, newIndex: 0 } })
      expect(wrapper.emitted('move')).toEqual([['doc_2', 0]])
    })

    it('leaves the tabs as it was given them, for the panel to move', () => {
      const wrapper = mountStrip()
      list(wrapper).vm.$emit('change', { moved: { element: items[1], oldIndex: 1, newIndex: 0 } })
      expect(wrapper.findAll('[role="tab"]').map(t => t.attributes('data-tab-id'))).toEqual([
        'doc_1',
        'doc_2',
      ])
    })

    it('carries nothing a document would take as text', () => {
      const carried = new Map()
      const given = list(mountStrip()).vm.$attrs
      const setData = given.setData ?? given['set-data']
      setData({ setData: (type, value) => carried.set(type, value) })

      expect(carried.size).toBe(1)
      const [type] = [...carried.keys()]
      expect(type).not.toMatch(/^text/i)
      expect(carried.get(type)).not.toBe('')
    })

    it('takes up a tab pressed on, and none pressed on by its close button', () => {
      const wrapper = mount(TabStrip, {
        props: { items, activeId: 'doc_1' },
        global: { plugins: [PrimeVue] },
        attachTo: document.body,
      })

      expect(press(wrapper, tab(wrapper, 'doc_2'))).toEqual([false, true])
      expect(press(wrapper, tab(wrapper, 'doc_2').find('button'))).toEqual([false, false])
      // And nothing is still held once the mouse is up.
      expect(wrapper.find('.sortable-chosen').exists()).toBe(false)

      wrapper.unmount()
    })

    it('still closes a tab from its button', async () => {
      const wrapper = mountStrip()
      await tab(wrapper, 'doc_2').find('button').trigger('click')
      expect(wrapper.emitted('close')).toEqual([['doc_2']])
      expect(wrapper.emitted('move')).toBeUndefined()
    })
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
