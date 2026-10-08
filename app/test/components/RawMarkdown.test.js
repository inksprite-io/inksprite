import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { undo } from '@codemirror/commands'
import RawMarkdown from '@/components/writer/editor/RawMarkdown.vue'
import { useEditor, clearEditor, PROJECTION_DELAY } from '@/composables/useEditor.js'

const { mockApi, mockUpdateDocument } = vi.hoisted(() => {
  const documents = new Map([
    ['p_1', { id: 'p_1', title: 'Prompt', type: 'text', plain: true, content: '# One\n\n* a *b*' }],
    ['p_2', { id: 'p_2', title: 'Blank', type: 'text', plain: true, content: '' }],
  ])
  return {
    mockUpdateDocument: vi.fn(),
    mockApi: {
      init: vi.fn(async () => {}),
      keep: vi.fn(),
      get: vi.fn(id => documents.get(id) || null),
    },
  }
})

vi.mock('@/composables/useDocuments', () => ({ useDocuments: () => mockApi }))
vi.mock('@/stores/documentsStore.js', () => ({
  useDocumentsStore: () => ({ updateDocument: mockUpdateDocument, getDocument: vi.fn(() => ({})) }),
}))

// The bar's own workings are FindBar's business; here, what it is told.
const FindBar = {
  name: 'FindBar',
  props: ['query', 'count', 'current'],
  template: '<div data-find :data-count="count" :data-current="current" />',
  methods: { focus() {} },
}

const mountRaw = async documentId => {
  const wrapper = mount(RawMarkdown, {
    props: { storyId: 'story_1', documentId },
    attachTo: document.body,
    global: { stubs: { FindBar } },
  })
  await flushPromises()
  return wrapper
}

/** @returns {EditorView} */
const viewIn = wrapper => EditorView.findFromDOM(wrapper.find('.cm-editor').element)

/** What the view shows. */
const shown = wrapper => viewIn(wrapper).state.doc.toString()

/** Type over the whole text, the way a keystroke would come through. */
const type = async (wrapper, value) => {
  const view = viewIn(wrapper)
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: value },
    userEvent: 'input.type',
  })
  await flushPromises()
}

/** Type at the end of the text. */
const typeAtEnd = async (wrapper, value) => {
  const view = viewIn(wrapper)
  const end = view.state.doc.length
  view.dispatch({ changes: { from: end, insert: value }, userEvent: 'input.type' })
  await flushPromises()
}

describe('RawMarkdown', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    clearEditor()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('shows the document as the text it is, and holds it as text', async () => {
    const wrapper = await mountRaw('p_1')

    expect(shown(wrapper)).toBe('# One\n\n* a *b*')
    expect(useEditor().holds('p_1')).toBe(true)
    expect(useEditor().stateOf('p_1')).toBeNull()
  })

  it('shows the text the registry already holds rather than the store', async () => {
    useEditor().open('p_1', 'Typed, unflushed.', true)
    const wrapper = await mountRaw('p_1')
    expect(shown(wrapper)).toBe('Typed, unflushed.')
  })

  it('is empty for a document with nothing in it, with no placeholder', async () => {
    const wrapper = await mountRaw('p_2')
    expect(shown(wrapper)).toBe('')
    expect(wrapper.find('.cm-placeholder').exists()).toBe(false)
  })

  it('puts every keystroke into the document, and the store hears after a pause', async () => {
    const wrapper = await mountRaw('p_1')
    await type(wrapper, '* item one')
    await type(wrapper, '* item one\n<tag>')

    expect(useEditor().markdown('p_1')).toBe('* item one\n<tag>')
    expect(mockUpdateDocument).not.toHaveBeenCalled()

    vi.advanceTimersByTime(PROJECTION_DELAY)
    expect(mockUpdateDocument).toHaveBeenCalledTimes(1)
    expect(mockUpdateDocument).toHaveBeenCalledWith('p_1', { content: '* item one\n<tag>' })
  })

  it('keeps its tab once something is typed, and not before', async () => {
    const wrapper = await mountRaw('p_1')
    expect(mockApi.keep).not.toHaveBeenCalled()

    await type(wrapper, 'x')
    expect(mockApi.keep).toHaveBeenCalledWith('p_1')
  })

  it('leaves what was typed as typed', async () => {
    const wrapper = await mountRaw('p_1')
    await type(wrapper, '* item')
    vi.advanceTimersByTime(PROJECTION_DELAY)
    await flushPromises()

    expect(shown(wrapper)).toBe('* item')
    expect(useEditor().markdown('p_1')).toBe('* item')
  })

  it('writes out at once on blur', async () => {
    const wrapper = await mountRaw('p_1')
    await type(wrapper, 'Leaving the field.')
    await wrapper.find('.cm-content').trigger('blur')

    expect(mockUpdateDocument).toHaveBeenCalledWith('p_1', { content: 'Leaving the field.' })
  })

  it('follows the document as the assistant writes to it', async () => {
    const wrapper = await mountRaw('p_1')

    useEditor().appendContent('p_1', '{{then}}')
    await flushPromises()

    expect(shown(wrapper)).toBe('# One\n\n* a *b*\n\n{{then}}')
    expect(mockApi.keep).not.toHaveBeenCalled()
  })

  it('keeps the caret on its text when the assistant writes ahead of it', async () => {
    const wrapper = await mountRaw('p_1')
    const view = viewIn(wrapper)
    // After "# One".
    view.dispatch({ selection: EditorSelection.cursor(5) })

    useEditor().replaceContent('p_1', 'Before.\n\n# One\n\n* a *b*')
    await flushPromises()

    expect(view.state.selection.main.head).toBe(5 + 'Before.\n\n'.length)
  })

  it("undoes the writer's typing and leaves the assistant's writing", async () => {
    const wrapper = await mountRaw('p_1')
    await typeAtEnd(wrapper, '!')
    useEditor().appendContent('p_1', 'Added.')
    await flushPromises()

    undo(viewIn(wrapper))
    await flushPromises()

    expect(shown(wrapper)).toBe('# One\n\n* a *b*\n\nAdded.')
    expect(useEditor().markdown('p_1')).toBe('# One\n\n* a *b*\n\nAdded.')
  })

  it('writes out on the way out, and keeps the document open', async () => {
    const wrapper = await mountRaw('p_1')
    await type(wrapper, 'Going.')

    wrapper.unmount()

    expect(mockUpdateDocument).toHaveBeenCalledWith('p_1', { content: 'Going.' })
    expect(useEditor().holds('p_1')).toBe(true)
  })

  it('writes nothing when nothing was typed', async () => {
    const wrapper = await mountRaw('p_1')
    await wrapper.find('.cm-content').trigger('blur')
    wrapper.unmount()
    expect(mockUpdateDocument).not.toHaveBeenCalled()
  })

  describe('find', () => {
    // The focus goes to the find button in the header, as a click there takes
    // it. happy-dom, unlike a browser, reports a selection change while the
    // view is still drawing it, which the view refuses.
    const away = wrapper => viewIn(wrapper).contentDOM.blur()

    it('opens on what is selected, and counts the matches', async () => {
      const wrapper = await mountRaw('p_1')
      const view = viewIn(wrapper)
      // "One"
      away(wrapper)
      view.dispatch({ selection: EditorSelection.range(2, 5) })

      expect(wrapper.vm.openFind()).toBe(true)
      await flushPromises()

      const bar = wrapper.findComponent(FindBar)
      expect(bar.props('query')).toBe('One')
      expect(bar.props('count')).toBe(1)
      expect(bar.props('current')).toBe(0)
    })

    it('replaces what it finds as the writer typing would', async () => {
      const wrapper = await mountRaw('p_1')
      away(wrapper)
      wrapper.vm.openFind()
      await flushPromises()
      const bar = wrapper.findComponent(FindBar)

      bar.vm.$emit('update:query', '*')
      await flushPromises()
      expect(bar.props('count')).toBe(3)

      bar.vm.$emit('update:replacement', '_')
      bar.vm.$emit('replace-all')
      await flushPromises()

      expect(shown(wrapper)).toBe('# One\n\n_ a _b_')
      expect(useEditor().markdown('p_1')).toBe('# One\n\n_ a _b_')
      expect(mockApi.keep).toHaveBeenCalledWith('p_1')
    })

    it('puts the find away on Escape, with nothing left drawn', async () => {
      const wrapper = await mountRaw('p_1')
      away(wrapper)
      wrapper.vm.openFind()
      await flushPromises()
      wrapper.findComponent(FindBar).vm.$emit('update:query', 'a')
      await flushPromises()
      expect(wrapper.findAll('.find-match').length).toBeGreaterThan(0)

      await wrapper.find('[data-find]').trigger('keydown', { key: 'Escape' })

      expect(wrapper.findComponent(FindBar).exists()).toBe(false)
      expect(wrapper.findAll('.find-match')).toHaveLength(0)
    })
  })
})
