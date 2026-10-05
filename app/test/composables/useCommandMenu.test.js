import { describe, it, expect, vi, afterEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { useCommandMenu } from '../../src/composables/useCommandMenu.js'

/** @type {import('@vue/test-utils').VueWrapper[]} */
const mounted = []

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
})

/**
 * A field in a row the way the chat lays it out: the row hears keys on the
 * way down, for the menu, and the field has an Enter of its own that stands
 * for sending the message.
 */
const setup = async () => {
  const sent = vi.fn()
  let menu

  const Host = defineComponent({
    setup() {
      const field = ref(null)
      const draft = ref('')
      menu = useCommandMenu(field, draft)
      return { field, draft }
    },
    render() {
      return h('div', { onKeydownCapture: menu.onKeydown }, [
        h('textarea', {
          ref: 'field',
          value: this.draft,
          onInput: event => (this.draft = event.target.value),
        }),
      ])
    },
  })

  const wrapper = mount(Host, { attachTo: document.body })
  mounted.push(wrapper)
  await nextTick()
  const field = /** @type {HTMLTextAreaElement} */ (wrapper.find('textarea').element)
  field.focus()

  // The field's Enter, added natively. Vue drops an event on a handler it
  // attached in the same millisecond the event was made, which is every event
  // in a test this quick; a writer's keys come long after the chat mounted.
  field.addEventListener('keydown', event => {
    if (event.key === 'Enter') sent(event)
  })

  /** Type the draft whole, with the caret where it says (the end, unless told). */
  const type = async (text, caret = text.length) => {
    field.value = text
    field.setSelectionRange(caret, caret)
    field.dispatchEvent(new window.Event('input'))
    await nextTick()
  }

  /** Press a key in the field, and say whether anything stopped it. */
  const press = async (key, modifiers = {}) => {
    const event = new window.KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...modifiers,
    })
    field.dispatchEvent(event)
    await nextTick()
    await nextTick()
    return event
  }

  return {
    field,
    type,
    press,
    sent,
    draft: () => wrapper.vm.draft,
    open: () => menu.open.value,
    names: () => menu.entries.value.map(entry => entry.name),
    active: () => menu.entries.value[menu.active.value]?.name,
    pick: menu.pick,
  }
}

describe('useCommandMenu', () => {
  it('opens on a slash at the start of a line, with every command', async () => {
    const chat = await setup()
    await chat.type('/')

    expect(chat.open()).toBe(true)
    expect(chat.names()).toContain('oracle')
    expect(chat.active()).toBe('compact')
  })

  it('narrows to what the name could be as it is typed', async () => {
    const chat = await setup()
    await chat.type('/ro')

    expect(chat.names()).toEqual(['roll', 'roll-table'])
  })

  it('stays shut for anything that is not a command being named', async () => {
    const chat = await setup()

    await chat.type('I push the door and/or window.')
    expect(chat.open()).toBe(false)

    await chat.type('/roll 3d6')
    expect(chat.open()).toBe(false)

    await chat.type('/xyz')
    expect(chat.open()).toBe(false)
  })

  it('opens on a later line of the draft too', async () => {
    const chat = await setup()
    await chat.type('I reach for the handle.\n/ora')

    expect(chat.names()).toEqual(['oracle'])
  })

  it('shuts when the field loses the focus', async () => {
    const chat = await setup()
    await chat.type('/')
    chat.field.blur()
    await nextTick()

    expect(chat.open()).toBe(false)
  })

  it('moves the highlight with the arrows, round the ends, and keeps them from the field', async () => {
    const chat = await setup()
    await chat.type('/ro')

    const down = await chat.press('ArrowDown')
    expect(chat.active()).toBe('roll-table')
    expect(down.defaultPrevented).toBe(true)

    await chat.press('ArrowDown')
    expect(chat.active()).toBe('roll')

    await chat.press('ArrowUp')
    expect(chat.active()).toBe('roll-table')
  })

  it('finishes the highlighted name on Enter, instead of sending', async () => {
    const chat = await setup()
    await chat.type('/ro')
    await chat.press('ArrowDown')
    await chat.press('Enter')

    expect(chat.draft()).toBe('/roll-table ')
    expect(chat.field.selectionStart).toBe('/roll-table '.length)
    expect(chat.sent).not.toHaveBeenCalled()
    expect(chat.open()).toBe(false)
  })

  it('finishes a name that takes a setting without a space, and stays shut on it', async () => {
    // The caret is still in the name, where the writer types `(` or a space;
    // a menu that opened there again would have the next Enter.
    const chat = await setup()
    await chat.type('/ora')
    await chat.press('Tab')

    expect(chat.draft()).toBe('/oracle')
    expect(chat.open()).toBe(false)

    await chat.type('/oracl')
    expect(chat.open()).toBe(true)
  })

  it('lets Enter send a name that is already typed out in full', async () => {
    const chat = await setup()
    await chat.type('/tarot')

    expect(chat.open()).toBe(true)
    const enter = await chat.press('Enter')

    expect(enter.defaultPrevented).toBe(false)
    expect(chat.sent).toHaveBeenCalledOnce()
    expect(chat.draft()).toBe('/tarot')
  })

  it('still finishes a name typed out in full on Tab', async () => {
    const chat = await setup()
    await chat.type('/roll')
    await chat.press('Tab')

    expect(chat.draft()).toBe('/roll ')
  })

  it('leaves Enter with a modifier to mean what it already means', async () => {
    const chat = await setup()
    await chat.type('/ro')
    const enter = await chat.press('Enter', { ctrlKey: true })

    expect(enter.defaultPrevented).toBe(false)
    expect(chat.sent).toHaveBeenCalledOnce()
    expect(chat.draft()).toBe('/ro')
  })

  it('shuts on Escape for the rest of that command, and keeps the key', async () => {
    const chat = await setup()
    await chat.type('/ora')
    const escape = await chat.press('Escape')

    expect(chat.open()).toBe(false)
    expect(escape.defaultPrevented).toBe(true)

    await chat.type('/orac')
    expect(chat.open()).toBe(false)

    // Out of the name and back into it: a fresh start.
    await chat.type('/orac ')
    await chat.type('/orac')
    expect(chat.open()).toBe(true)
  })

  it('replaces all of a name the caret is inside, and does not double a space', async () => {
    const chat = await setup()

    await chat.type('/ora Is the door locked?', 4)
    await chat.press('Enter')
    expect(chat.draft()).toBe('/oracle Is the door locked?')

    await chat.type('/ro 3d6', 3)
    await chat.press('Enter')
    expect(chat.draft()).toBe('/roll 3d6')
    expect(chat.field.selectionStart).toBe('/roll'.length)
  })

  it('keeps the rest of the draft as it was', async () => {
    const chat = await setup()
    const text = 'I reach for the handle.\n/ora\nThen I wait.'
    await chat.type(text, text.indexOf('\nThen'))
    await chat.press('Enter')

    expect(chat.draft()).toBe('I reach for the handle.\n/oracle\nThen I wait.')
  })

  it('finishes whichever entry is picked with the mouse', async () => {
    const chat = await setup()
    await chat.type('/')
    await chat.pick(chat.names().indexOf('write'))

    expect(chat.draft()).toBe('/write ')
  })

  it('lets every key through while it is shut', async () => {
    const chat = await setup()
    await chat.type('Hello')
    const enter = await chat.press('Enter')

    expect(enter.defaultPrevented).toBe(false)
    expect(chat.sent).toHaveBeenCalledOnce()
  })
})
