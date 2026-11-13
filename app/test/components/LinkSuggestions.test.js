/* global MouseEvent */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LinkSuggestions from '@/components/writer/editor/LinkSuggestions.vue'

const entries = [
  { key: 'd1', title: 'Harbour', detail: 'Places', href: 'Places/Harbour.md' },
  { key: 'f1', title: 'Places', detail: '', href: 'Places', folder: true },
  {
    key: 'd1#h',
    title: 'The market',
    detail: 'Harbour',
    href: 'Places/Harbour.md#the-market',
    heading: true,
  },
]

const show = (props = {}) => mount(LinkSuggestions, { props: { id: 'links', entries, ...props } })

const options = wrapper => wrapper.findAll('[role="option"]')

describe('LinkSuggestions', () => {
  it('lists each entry by its name, with where it is beside it', () => {
    const wrapper = show()

    expect(wrapper.attributes('role')).toBe('listbox')
    expect(wrapper.attributes('id')).toBe('links')
    expect(options(wrapper).map(option => option.find('.truncate').text())).toEqual([
      'Harbour',
      'Places',
      'The market',
    ])
    expect(options(wrapper)[0].text()).toContain('Places')
    expect(options(wrapper).map(option => option.attributes('id'))).toEqual([
      'links-0',
      'links-1',
      'links-2',
    ])
  })

  it('draws a document, a folder and a heading each as what it is', () => {
    const icons = options(show()).map(option => option.find('i.pi').classes())

    expect(icons[0]).toContain('pi-file')
    expect(icons[1]).toContain('pi-folder')
    expect(icons[2]).toContain('pi-hashtag')
  })

  it('marks the one highlighted, and no other', () => {
    const wrapper = show({ active: 1 })

    expect(options(wrapper).map(option => option.attributes('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
    ])
  })

  it('says which was picked, and which the pointer moved onto', async () => {
    const wrapper = show({ active: 0 })

    await options(wrapper)[2].trigger('click')
    expect(wrapper.emitted('pick')).toEqual([[2]])

    await options(wrapper)[1].trigger('mousemove')
    // Not the one already highlighted: a pointer resting on it says nothing.
    await options(wrapper)[0].trigger('mousemove')
    expect(wrapper.emitted('hover')).toEqual([[1]])
  })

  it('leaves the caret where it is when a row is pressed', () => {
    const wrapper = show()
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true })

    options(wrapper)[0].element.dispatchEvent(press)

    expect(press.defaultPrevented).toBe(true)
  })

  it('says how long a document is where it is to be attached, and nothing where it is linked', () => {
    const wrapper = show({
      entries: [
        { key: 'a', title: 'Harbour', detail: 'Places', href: 'Places/Harbour.md', words: 1240 },
        { key: 'b', title: 'Note', detail: '', href: 'Note.md', words: 1 },
        { key: 'c', title: 'Empty', detail: '', href: 'Empty.md', words: 0 },
        { key: 'd', title: 'Linked', detail: '', href: 'Linked.md' },
      ],
    })
    const [long, one, none, linked] = options(wrapper).map(option => option.text())

    expect(long).toContain(`${(1240).toLocaleString()} words`)
    expect(one).toContain('1 word')
    expect(one).not.toContain('1 words')
    expect(none).toContain('0 words')
    expect(linked).not.toContain('word')
  })
})
