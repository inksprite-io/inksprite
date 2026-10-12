/* global KeyboardEvent, PointerEvent */
import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { EditorView } from '@codemirror/view'
import CodeView from '@/components/writer/editor/CodeView.vue'

// The bar's own workings are FindBar's business; here, what it is told.
const FindBar = {
  name: 'FindBar',
  props: ['query', 'count', 'current'],
  template: '<div data-find :data-count="count" :data-current="current" />',
  methods: { focus() {} },
}

const mountView = props =>
  mount(CodeView, { props, attachTo: document.body, global: { stubs: { FindBar } } })

/** @returns {EditorView} */
const viewIn = wrapper => EditorView.findFromDOM(wrapper.find('.cm-editor').element)

describe('CodeView', () => {
  it('shows the text read-only, with line numbers', async () => {
    const wrapper = mountView({ content: 'const a = 1\nconst b = 2\n', filename: 'index.js' })
    await flushPromises()

    const content = wrapper.find('.cm-content')
    expect(content.text()).toContain('const a = 1')
    expect(content.attributes('contenteditable')).toBe('false')
    expect(wrapper.findAll('.cm-lineNumbers .cm-gutterElement').map(n => n.text())).toEqual(
      expect.arrayContaining(['1', '2', '3'])
    )
    wrapper.unmount()
  })

  it('shows another file when the text changes', async () => {
    const wrapper = mountView({ content: 'one', filename: 'a.txt' })
    await wrapper.setProps({ content: 'two', filename: 'b.txt' })

    expect(wrapper.find('.cm-content').text()).toBe('two')
    wrapper.unmount()
  })

  it('shows a file no language claims as it is', async () => {
    const wrapper = mountView({ content: 'plain words', filename: 'NOTES' })
    await flushPromises()

    expect(wrapper.find('.cm-content').text()).toBe('plain words')
    wrapper.unmount()
  })

  describe('find', () => {
    // Far more lines than are drawn, with what is looked for near the end.
    const long = Array.from({ length: 3000 }, (_, at) =>
      at === 2900 ? 'const needle = 1' : `const line${at} = ${at}`
    ).join('\n')

    /** The find key, as it is off a Mac, which is what the tests run as. */
    const findKey = target =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
      )

    it('opens on the find key in the code', async () => {
      const wrapper = mountView({ content: long, filename: 'long.js' })
      await flushPromises()
      expect(wrapper.findComponent(FindBar).exists()).toBe(false)

      wrapper
        .find('.cm-content')
        .element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      findKey(document.body)
      await flushPromises()

      expect(wrapper.findComponent(FindBar).exists()).toBe(true)
      wrapper.unmount()
    })

    it('finds in the whole file, lines not drawn among them', async () => {
      const wrapper = mountView({ content: long, filename: 'long.js' })
      await flushPromises()

      expect(wrapper.vm.openFind()).toBe(true)
      await flushPromises()
      const bar = wrapper.findComponent(FindBar)
      bar.vm.$emit('update:query', 'needle')
      await flushPromises()

      expect(bar.props('count')).toBe(1)
      expect(bar.props('current')).toBe(0)
      const view = viewIn(wrapper)
      const { from } = view.state.selection.main
      expect(view.state.doc.lineAt(from).number).toBe(2901)
      wrapper.unmount()
    })

    it('goes round from the last match to the first', async () => {
      const wrapper = mountView({ content: 'a\nb a\nc a', filename: 'a.txt' })
      await flushPromises()
      wrapper.vm.openFind()
      await flushPromises()
      const bar = wrapper.findComponent(FindBar)
      bar.vm.$emit('update:query', 'a')
      await flushPromises()
      expect(bar.props('count')).toBe(3)

      for (const expected of [1, 2, 0]) {
        bar.vm.$emit('next')
        await flushPromises()
        expect(bar.props('current')).toBe(expected)
      }
      bar.vm.$emit('previous')
      await flushPromises()
      expect(bar.props('current')).toBe(2)
      wrapper.unmount()
    })

    it('puts the find away on Escape, with nothing left drawn and the code as it was', async () => {
      const wrapper = mountView({ content: 'one two one', filename: 'a.txt' })
      await flushPromises()
      wrapper.vm.openFind()
      await flushPromises()
      wrapper.findComponent(FindBar).vm.$emit('update:query', 'one')
      await flushPromises()
      expect(wrapper.findAll('.find-match').length).toBeGreaterThan(0)

      await wrapper.find('[data-find]').trigger('keydown', { key: 'Escape' })

      expect(wrapper.findComponent(FindBar).exists()).toBe(false)
      expect(wrapper.findAll('.find-match')).toHaveLength(0)
      expect(viewIn(wrapper).state.doc.toString()).toBe('one two one')
      wrapper.unmount()
    })
  })
})
