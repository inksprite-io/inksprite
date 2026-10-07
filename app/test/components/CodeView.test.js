import { describe, it, expect } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import CodeView from '@/components/writer/editor/CodeView.vue'

const mountView = props => mount(CodeView, { props, attachTo: document.body })

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
})
