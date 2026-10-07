import { describe, it, expect } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { rangesIn, useChatFind } from '@/composables/useChatFind.js'
import { renderMarkdown } from '@/utils/markdown.js'

/**
 * A chat laid out the way Chat.vue lays it out, as far as a find looks: a block
 * for each turn, a message element for each message, its text in the page.
 * Every turn is in the page, unless `away` names it.
 */
const chat = (turns, away = new Set()) => {
  const list = ref(turns)
  let find
  const Host = defineComponent({
    setup() {
      const root = ref(null)
      find = useChatFind(list, () => root.value)
      return () =>
        h(
          'div',
          { ref: root },
          h(
            'div',
            list.value.map(turn =>
              h(
                'div',
                { 'data-turn': turn.id },
                away.has(turn.id)
                  ? []
                  : turn.messages.map(message =>
                      h('div', { 'data-message-id': message.id }, [
                        h('div', {
                          'data-find-text': '',
                          innerHTML: renderMarkdown(message.content),
                        }),
                      ])
                    )
              )
            )
          )
        )
    },
  })
  const wrapper = mount(Host, { attachTo: document.body })
  return { wrapper, find, list }
}

/** A turn of one message. */
const turn = (id, content, extra = {}) => ({
  id,
  messages: [{ id: `${id}-m`, content, ...extra }],
})

const TURNS = [
  turn('t0', 'The **brass** lantern swung.'),
  turn('t1', 'Nothing here.'),
  turn('t2', 'A lantern, and another lantern.'),
  turn('t3', 'And a `lantern` in code.'),
]

describe('useChatFind', () => {
  it('counts every match in the chat, in the page or not, as the text reads', async () => {
    const { find, wrapper } = chat(TURNS, new Set(['t0', 't2']))
    find.openFind()
    find.lookFor('lantern')
    expect(find.count.value).toBe(4)

    // Across the bold, which the markdown has and the reader does not.
    find.lookFor('brass lantern')
    expect(find.count.value).toBe(1)
    wrapper.unmount()
  })

  it('reads a turn taken in pieces as the prose of each piece', () => {
    const pieces = turn('t0', 'assembled', {
      segments: [
        { type: 'text', content: 'I raise the lantern.' },
        { type: 'command', command: { name: 'roll', input: '1d6', result: 'lantern 4' } },
        {
          type: 'command',
          command: { name: 'mara', input: '', result: 'Mara takes the lantern.', character: true },
        },
      ],
    })
    const { find, wrapper } = chat([pieces])
    find.openFind()
    find.lookFor('lantern')

    // The roll answers in a box of its own, not in prose, and is not counted.
    expect(find.count.value).toBe(2)
    wrapper.unmount()
  })

  it('keeps the turn of the match it is on in the page, and lets it go on closing', async () => {
    const { find, wrapper } = chat(TURNS)
    find.openFind()
    find.lookFor('lantern')
    const first = find.current.value

    find.step(1)
    await nextTick()
    const order = ['t0', 't2', 't2', 't3']
    expect(find.holding.value).toBe(order[(first + 1) % 4])

    find.closeFind()
    expect(find.holding.value).toBe(null)
    expect(find.count.value).toBe(0)
    wrapper.unmount()
  })

  it('goes round at either end', () => {
    const { find, wrapper } = chat(TURNS)
    find.openFind()
    find.lookFor('lantern')
    find.current.value = 3

    find.step(1)
    expect(find.current.value).toBe(0)
    find.step(-1)
    expect(find.current.value).toBe(3)
    wrapper.unmount()
  })

  it('stays in the turn it was in while the query grows', () => {
    const { find, wrapper } = chat(TURNS)
    find.openFind()
    find.lookFor('lantern')
    find.current.value = 1

    find.lookFor('lantern,')

    expect(find.count.value).toBe(1)
    expect(find.current.value).toBe(0)
    expect(find.holding.value).toBe('t2')
    wrapper.unmount()
  })

  it('starts from what is selected in the chat', () => {
    const { find, wrapper } = chat(TURNS)
    const code = wrapper.find('code').element
    const range = document.createRange()
    range.selectNodeContents(code)
    window.getSelection().removeAllRanges()
    window.getSelection().addRange(range)

    find.openFind()

    expect(find.query.value).toBe('lantern')
    window.getSelection().removeAllRanges()
    wrapper.unmount()
  })
})

describe('rangesIn', () => {
  it('finds across the text nodes a match runs over', () => {
    const element = document.createElement('div')
    element.innerHTML = 'The <strong>brass</strong> lantern, a Brass Lantern.'

    const ranges = rangesIn(element, /brass lantern/giu)

    expect(ranges.map(range => range.toString())).toEqual(['brass lantern', 'Brass Lantern'])
  })
})
