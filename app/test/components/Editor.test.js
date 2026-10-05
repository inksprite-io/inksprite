import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import Editor from '@/components/writer/editor/Editor.vue'
import { useEditor, clearEditor } from '@/composables/useEditor.js'

const { mockUpdateDocument, mockGetDocument, mockApi } = vi.hoisted(() => {
  const documents = new Map([
    ['doc_1', { id: 'doc_1', title: 'Chapter 1', type: 'text', content: '# One\n\nSnow fell.' }],
  ])
  return {
    mockUpdateDocument: vi.fn(),
    mockGetDocument: vi.fn(id => documents.get(id) || null),
    mockApi: {
      init: vi.fn(async () => {}),
      keep: vi.fn(),
      get: vi.fn(id => documents.get(id) || null),
    },
  }
})

vi.mock('@/composables/useDocuments', () => ({ useDocuments: () => mockApi }))

const { mockNarration, mockAppState } = vi.hoisted(() => ({ mockNarration: {}, mockAppState: {} }))
vi.mock('@/composables/useNarration', () => ({ useNarration: () => mockNarration }))
vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => mockAppState,
}))
vi.mock('@/stores/documentsStore.js', () => ({
  useDocumentsStore: () => ({ updateDocument: mockUpdateDocument, getDocument: mockGetDocument }),
}))

// The view in front of the state. happy-dom carries it far enough to mount
// and render; the state layer is tested on its own.
describe('Editor', () => {
  const mountEditor = () =>
    mount(Editor, {
      props: { storyId: 'story_1', documentId: 'doc_1' },
      global: { stubs: { ScrollPanel: { template: '<div><slot /></div>' } } },
    })

  beforeEach(() => {
    vi.clearAllMocks()
    clearEditor()
    mockNarration.watching = ref(0)
    mockNarration.voices = ref([
      { id: 'riley', name: 'Riley', voice: 'af_nicole', color: '#3b82f6' },
    ])
    mockAppState.highlightSpeakers = ref(true)
  })

  it('opens the document into the editor on mount and renders it', async () => {
    const wrapper = mountEditor()
    await flushPromises()

    expect(mockApi.init).toHaveBeenCalled()
    expect(useEditor().holds('doc_1')).toBe(true)
    expect(wrapper.find('.ProseMirror').exists()).toBe(true)
    expect(wrapper.find('.ProseMirror h1').text()).toBe('One')
    expect(wrapper.find('.ProseMirror p').text()).toBe('Snow fell.')
  })

  it('leaves the caret in a field the writer is typing in', async () => {
    // Naming the document in the tree, asking the chat something: the
    // document opening beside them must not take the keystrokes.
    const field = document.createElement('input')
    document.body.appendChild(field)
    field.focus()

    const wrapper = mountEditor()
    await flushPromises()

    expect(document.activeElement).toBe(field)
    wrapper.unmount()
    field.remove()
  })

  it('writes out what changed on unmount, and keeps the document open', async () => {
    const wrapper = mountEditor()
    await flushPromises()

    const editor = useEditor()
    editor.dispatch('doc_1', editor.stateOf('doc_1').tr.insertText(' Hard.'))
    wrapper.unmount()

    expect(editor.holds('doc_1')).toBe(true)
    expect(mockUpdateDocument).toHaveBeenCalledWith('doc_1', {
      content: '# One\n\nSnow fell. Hard.',
    })
  })

  it('resumes what was typed when mounted again', async () => {
    const first = mountEditor()
    await flushPromises()
    const editor = useEditor()
    editor.dispatch('doc_1', editor.stateOf('doc_1').tr.insertText(' Hard.'))
    first.unmount()

    const second = mountEditor()
    await flushPromises()

    expect(second.find('.ProseMirror p').text()).toBe('Snow fell. Hard.')
    expect(editor.holds('doc_1')).toBe(true)
  })

  it('colours a speaker’s lines while the narration is showing, and only then', async () => {
    const original = mockApi.get.getMockImplementation()
    mockApi.get.mockImplementation(id => ({
      id,
      title: 'Chapter 1',
      type: 'text',
      content: 'Snow fell.\n\n"Cold," she said.',
      speakers: [{ text: '"Cold," she said.', index: 1, voiceId: 'riley' }],
    }))

    const wrapper = mountEditor()
    await flushPromises()
    // Nothing is written into the document, and nothing shows while the
    // writer is only writing.
    expect(wrapper.find('[data-speaker]').exists()).toBe(false)

    mockNarration.watching.value = 1
    await flushPromises()
    const marked = wrapper.findAll('[data-speaker="Riley"]')
    expect(marked.map(mark => mark.text())).toEqual(['"Cold," she said.'])
    expect(marked[0].attributes('style')).toContain('background-color')
    expect(useEditor().markdown('doc_1')).toBe('Snow fell.\n\n"Cold," she said.')

    // The colouring follows the text as it is typed.
    const editor = useEditor()
    editor.dispatch('doc_1', editor.stateOf('doc_1').tr.insertText('More snow. ', 1))
    await flushPromises()
    expect(wrapper.findAll('[data-speaker="Riley"]').map(mark => mark.text())).toEqual([
      '"Cold," she said.',
    ])

    mockAppState.highlightSpeakers.value = false
    await flushPromises()
    expect(wrapper.find('[data-speaker]').exists()).toBe(false)

    wrapper.unmount()
    mockApi.get.mockImplementation(original)
  })

  it('shows a transaction from outside in the view', async () => {
    const wrapper = mountEditor()
    await flushPromises()

    useEditor().appendContent('doc_1', 'Then hail.')
    await flushPromises()

    expect(wrapper.findAll('.ProseMirror p').map(p => p.text())).toEqual([
      'Snow fell.',
      'Then hail.',
    ])
    // The assistant writing in a preview is not the writer keeping it.
    expect(mockApi.keep).not.toHaveBeenCalled()
  })
})
