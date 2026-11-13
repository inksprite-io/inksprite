import { describe, it, expect, vi, afterEach } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { linkAtCaret, useLinkMenu } from '../../src/composables/useLinkMenu.js'

/** @type {import('@vue/test-utils').VueWrapper[]} */
const mounted = []

afterEach(() => {
  while (mounted.length) mounted.pop().unmount()
})

const DOCUMENTS = [
  { key: 'cast', title: 'Cast list', detail: 'Notes', href: 'Notes/Cast%20list.md' },
  { key: 'plan', title: 'Plan', detail: '', href: 'Plan.md' },
]

/** A field in a row as the chat lays it out, its keys heard on the way down. */
const setup = async () => {
  const sent = vi.fn()
  const suggest = vi.fn(query =>
    DOCUMENTS.filter(entry => entry.title.toLowerCase().includes(query.toLowerCase()))
  )
  const textFor = vi.fn((entry, before, attach) =>
    before.startsWith('/') ? entry.href : `${attach ? '@' : ''}[${entry.title}](</${entry.href}>)`
  )
  let menu

  const Host = defineComponent({
    setup() {
      const field = ref(null)
      const draft = ref('')
      menu = useLinkMenu(field, draft, { suggest, textFor })
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

  /** Press a key in the field. */
  const press = async key => {
    const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
    field.dispatchEvent(event)
    await nextTick()
    await nextTick()
    return event
  }

  return {
    type,
    press,
    sent,
    suggest,
    draft: () => wrapper.vm.draft,
    open: () => menu.open.value,
    titles: () => menu.entries.value.map(entry => entry.title),
    active: () => menu.entries.value[menu.active.value]?.title,
  }
}

describe('linkAtCaret', () => {
  it('finds the `[[` before the caret, and what was typed since', () => {
    expect(linkAtCaret('See [[Cast li', 13)).toEqual({ start: 4, query: 'Cast li' })
    expect(linkAtCaret('See [[Cast li and more', 13)).toEqual({ start: 4, query: 'Cast li' })
    expect(linkAtCaret('See [[Cast]] here', 17)).toBeNull()
    expect(linkAtCaret('See [Cast', 9)).toBeNull()
    expect(linkAtCaret('See [[Cast\nlist', 15)).toBeNull()
  })

  it('finds an `@` at the start of a word, which attaches what is picked', () => {
    expect(linkAtCaret('@', 1)).toEqual({ start: 0, query: '', attach: true })
    expect(linkAtCaret('Read @Cast li', 13)).toEqual({ start: 5, query: 'Cast li', attach: true })
    expect(linkAtCaret('Read (@Ca', 9)).toEqual({ start: 6, query: 'Ca', attach: true })
  })

  it('takes no `@` in an address, on its own between words, or before a link', () => {
    expect(linkAtCaret('me@example', 10)).toBeNull()
    expect(linkAtCaret('meet @ five', 11)).toBeNull()
    expect(linkAtCaret('Read @[Cast](</Cast.md>)', 24)).toBeNull()
    expect(linkAtCaret('Read @[Cast', 11)).toBeNull()
  })
})

describe('useLinkMenu', () => {
  it('lists what the name after `[[` could be, as it is typed', async () => {
    const chat = await setup()
    await chat.type('Can you read [[')
    expect(chat.open()).toBe(true)
    expect(chat.titles()).toEqual(['Cast list', 'Plan'])
    await chat.type('Can you read [[ca')
    expect(chat.titles()).toEqual(['Cast list'])
    expect(chat.suggest).toHaveBeenLastCalledWith('ca')
  })

  it('puts in the one picked with Enter, instead of sending, and the caret after it', async () => {
    const chat = await setup()
    await chat.type('Read [[ and tell me.', 7)
    await chat.press('ArrowDown')
    expect(chat.active()).toBe('Plan')
    const enter = await chat.press('Enter')
    expect(enter.defaultPrevented).toBe(true)
    expect(chat.sent).not.toHaveBeenCalled()
    expect(chat.draft()).toBe('Read [Plan](</Plan.md>) and tell me.')
    expect(chat.open()).toBe(false)
  })

  it('lists what the name after `@` could be, and attaches the one picked', async () => {
    const chat = await setup()
    await chat.type('Is @ca')
    expect(chat.titles()).toEqual(['Cast list'])
    expect(chat.suggest).toHaveBeenLastCalledWith('ca', true)
    await chat.press('Enter')
    expect(chat.draft()).toBe('Is @[Cast list](</Notes/Cast%20list.md>)')
    expect(chat.open()).toBe(false)
  })

  it('puts in what the command takes after one', async () => {
    const chat = await setup()
    await chat.type('/explore [[cas')
    await chat.press('Tab')
    expect(chat.draft()).toBe('/explore Notes/Cast%20list.md')
  })

  it('puts the list away on Escape, until the `[[` is typed again', async () => {
    const chat = await setup()
    await chat.type('Read [[ca')
    await chat.press('Escape')
    expect(chat.open()).toBe(false)
    await chat.type('Read [[cas')
    expect(chat.open()).toBe(false)
    // Enter is the field's again.
    await chat.press('Enter')
    expect(chat.sent).toHaveBeenCalled()
    await chat.type('Read [[cas and [[')
    expect(chat.open()).toBe(true)
  })

  it('stays shut when nothing could be meant', async () => {
    const chat = await setup()
    await chat.type('Read [[zz')
    expect(chat.open()).toBe(false)
    await chat.press('Enter')
    expect(chat.sent).toHaveBeenCalled()
  })
})
