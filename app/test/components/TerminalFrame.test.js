/* global MessageEvent, MouseEvent */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import TerminalFrame from '@/components/writer/terminal/TerminalFrame.vue'
import { appearanceFrom, appearanceOf } from '../../electron/terminal/appearance.js'

/** Where a terminal's frame is: the desktop app's own page, which nothing here loads. */
const FRAME = 'terminal://frame'

/** A colour as the frame is told one, and as its address carries one. */
const COLOUR = /^#[0-9a-f]{6}$/
const IN_ADDRESS = /^[0-9a-f]{6}$/

/**
 * A terminal's frame set in a panel, and a stand-in for the window of the
 * page inside the frame: what the page around it can ask of that window.
 *
 * @param {object} [props]
 */
const mountFrame = async (props = {}) => {
  const panel = document.createElement('div')
  const wrapper = mount(TerminalFrame, {
    props: { terminalId: 'terminal:1', active: true, ...props },
    attachTo: panel,
  })
  await flushPromises()
  const frame = wrapper.find('iframe')
  const inside = { postMessage: vi.fn(), focus: vi.fn() }
  Object.defineProperty(frame.element, 'contentWindow', { value: inside })
  /** The frame's place in the panel, which what it says is played on. */
  const place = wrapper.find('[data-terminal-frame]').element
  return { wrapper, panel, place, frame, inside }
}

/**
 * Something said to the page, as the frame's page says it: from the frame's
 * window, at the frame's origin.
 *
 * @param {object} data
 * @param {{source: object, origin?: string}} from
 */
const say = (data, { source, origin = FRAME }) =>
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }))

/** What reaches the panel around the frame, by the kinds of event named. */
const hear = (panel, types) => {
  /** @type {any[]} */
  const heard = []
  for (const type of types) panel.addEventListener(type, event => heard.push(event))
  return heard
}

const CLICK = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']

/** A pointer's event, from somewhere in the page. */
const pointer = (type, init = {}) =>
  document.body.dispatchEvent(new MouseEvent(type, { bubbles: true, ...init }))

describe('TerminalFrame', () => {
  afterEach(() => {
    document.documentElement.classList.remove('dark')
    pointer('pointerup')
  })

  it('sets the frame at the terminal’s own origin, at an address naming the terminal and how it looks', async () => {
    document.documentElement.classList.add('dark')
    const { frame } = await mountFrame({ terminalId: 'terminal:7' })
    const address = new URL(frame.attributes('src'))

    expect(frame.attributes('src').startsWith(`${FRAME}/?`)).toBe(true)
    expect(Object.fromEntries(address.searchParams)).toEqual({
      id: 'terminal:7',
      dark: '1',
      background: expect.stringMatching(IN_ADDRESS),
      foreground: expect.stringMatching(IN_ADDRESS),
      fontSize: '13',
    })
    // As the frame's own page reads it, for its first paint.
    expect(appearanceOf(address.searchParams)).toMatchObject({
      dark: true,
      background: `#${address.searchParams.get('background')}`,
      foreground: `#${address.searchParams.get('foreground')}`,
    })
  })

  it('tells the frame how to look when the app goes dark or light, without setting it again', async () => {
    const { wrapper, frame, inside } = await mountFrame()
    const address = frame.attributes('src')
    expect(new URL(address).searchParams.get('dark')).toBe('0')

    document.documentElement.classList.add('dark')
    await flushPromises()

    expect(inside.postMessage).toHaveBeenCalledTimes(1)
    const [said, to] = inside.postMessage.mock.calls[0]
    expect(to).toBe(FRAME)
    expect(said).toEqual({
      type: 'appearance',
      appearance: {
        dark: true,
        background: expect.stringMatching(COLOUR),
        foreground: expect.stringMatching(COLOUR),
        fontSize: 13,
      },
    })
    // Every part of it is one the frame takes from the page.
    const other = { dark: false, background: '#010203', foreground: '#040506', fontSize: 20 }
    expect(appearanceFrom(said.appearance, other)).toEqual(said.appearance)

    // The frame it was, at the address it had: set again, it would load
    // again, and its screen with it.
    expect(wrapper.find('iframe').element).toBe(frame.element)
    expect(frame.attributes('src')).toBe(address)

    document.documentElement.classList.remove('dark')
    await flushPromises()

    expect(inside.postMessage).toHaveBeenCalledTimes(2)
    expect(inside.postMessage.mock.calls[1][0].appearance.dark).toBe(false)
    expect(frame.attributes('src')).toBe(address)
  })

  it('lets the frame read the clipboard and write to it, which copying and pasting there need', async () => {
    const { frame } = await mountFrame()
    expect(frame.attributes('allow')).toBe('clipboard-read; clipboard-write')
  })

  it('plays a click in the frame on the panel, down and up', async () => {
    const { panel, place, inside } = await mountFrame()
    const heard = hear(panel, CLICK)

    say({ type: 'pointer' }, { source: inside })

    expect(heard.map(event => event.type)).toEqual(CLICK)
    expect(heard.every(event => event.target === place)).toBe(true)
  })

  it('plays one of the app’s shortcuts pressed in the frame on the panel', async () => {
    const { panel, place, inside } = await mountFrame()
    const heard = hear(panel, ['keydown'])

    say({ type: 'key', key: 't', code: 'KeyT', metaKey: true, shiftKey: true }, { source: inside })

    expect(heard).toHaveLength(1)
    const [{ key, code, metaKey, ctrlKey, shiftKey, altKey, target }] = heard
    expect({ key, code, metaKey, ctrlKey, shiftKey, altKey }).toEqual({
      key: 't',
      code: 'KeyT',
      metaKey: true,
      ctrlKey: false,
      shiftKey: true,
      altKey: false,
    })
    expect(target).toBe(place)
  })

  it('plays no key without Command held: those are the shell’s', async () => {
    const { panel, inside } = await mountFrame()
    const heard = hear(panel, ['keydown'])

    say({ type: 'key', key: 'c', code: 'KeyC', metaKey: false, ctrlKey: true }, { source: inside })
    say({ type: 'key', key: 'Enter', code: 'Enter' }, { source: inside })

    expect(heard).toEqual([])
  })

  it('plays nothing said from anywhere but its own frame', async () => {
    const { panel, inside } = await mountFrame()
    const heard = hear(panel, [...CLICK, 'keydown'])
    const key = { type: 'key', key: 't', code: 'KeyT', metaKey: true }

    // The frame's window, were it taken somewhere else.
    say({ type: 'pointer' }, { source: inside, origin: 'https://example.com' })
    say(key, { source: inside, origin: 'https://example.com' })
    // Another window, the page's own among them.
    say({ type: 'pointer' }, { source: window })
    say(key, { source: { postMessage: vi.fn() } })

    expect(heard).toEqual([])
  })

  it('gives the terminal the keys when its tab becomes the one showing', async () => {
    const { wrapper, inside } = await mountFrame({ active: false })
    expect(inside.focus).not.toHaveBeenCalled()

    await wrapper.setProps({ active: true })
    await flushPromises()
    expect(inside.focus).toHaveBeenCalledTimes(1)

    // Going behind another tab asks for nothing.
    await wrapper.setProps({ active: false })
    await flushPromises()
    expect(inside.focus).toHaveBeenCalledTimes(1)
  })

  it('gives the terminal the keys once its page has loaded, if its tab is showing', async () => {
    const showing = await mountFrame()
    await showing.frame.trigger('load')
    expect(showing.inside.focus).toHaveBeenCalledTimes(1)

    const behind = await mountFrame({ active: false })
    await behind.frame.trigger('load')
    expect(behind.inside.focus).not.toHaveBeenCalled()
  })

  it('gives the terminal the keys when the panel asks, and never behind another tab', async () => {
    const showing = await mountFrame()
    showing.wrapper.vm.focus()
    expect(showing.inside.focus).toHaveBeenCalledTimes(1)

    const behind = await mountFrame({ active: false })
    behind.wrapper.vm.focus()
    expect(behind.inside.focus).not.toHaveBeenCalled()
  })

  it('steps out of the pointer’s way while a press that began in the page is held', async () => {
    const { frame } = await mountFrame()
    const outOfTheWay = () => frame.classes().includes('pointer-events-none')
    expect(outOfTheWay()).toBe(false)

    // A panel's edge pressed, and dragged across the terminal.
    pointer('pointerdown')
    await nextTick()
    expect(outOfTheWay()).toBe(true)

    pointer('pointermove', { buttons: 1 })
    await nextTick()
    expect(outOfTheWay()).toBe(true)

    pointer('pointerup')
    await nextTick()
    expect(outOfTheWay()).toBe(false)
  })
})
