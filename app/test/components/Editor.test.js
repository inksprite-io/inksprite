/* global KeyboardEvent */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import Editor from '@/components/writer/editor/Editor.vue'
import { useEditor, clearEditor } from '@/composables/useEditor.js'
import {
  currentComment,
  goToComment,
  leaveComment,
  takeUpComment,
} from '@/composables/useComments.js'
import { commentRanges } from '@/editor/comments.js'
import { TextSelection } from 'prosemirror-state'

const { mockUpdateDocument, mockGetDocument, mockApi } = vi.hoisted(() => {
  const documents = new Map([
    ['doc_1', { id: 'doc_1', title: 'Chapter 1', type: 'text', content: '# One\n\nSnow fell.' }],
    ['doc_new', { id: 'doc_new', title: '', type: 'text', content: '' }],
    [
      'doc_2',
      {
        id: 'doc_2',
        title: 'Chapter 2',
        type: 'text',
        content: 'We had a {==cold==}{>>cabcd1: reword<<} attic.',
      },
    ],
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
  const mountEditor = (documentId = 'doc_1') =>
    mount(Editor, {
      props: { storyId: 'story_1', documentId },
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
    mockAppState.compactText = ref(true)
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

  it('shows where to start in an empty document, until something is written', async () => {
    const wrapper = mountEditor('doc_new')
    await flushPromises()
    expect(wrapper.find('.ProseMirror .placeholder').attributes('data-placeholder')).toBe(
      'Start writing…'
    )

    const editor = useEditor()
    editor.dispatch('doc_new', editor.stateOf('doc_new').tr.insertText('Once'))
    await flushPromises()
    expect(wrapper.find('.ProseMirror .placeholder').exists()).toBe(false)

    const full = mountEditor()
    await flushPromises()
    expect(full.find('.ProseMirror .placeholder').exists()).toBe(false)
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

  it('sets its text close or not as the setting says, while it is open', async () => {
    const wrapper = mountEditor()
    await flushPromises()
    const classes = () => wrapper.find('.ProseMirror').classes()

    expect(classes()).toContain('leading-normal!')
    mockAppState.compactText.value = false
    await flushPromises()
    expect(classes()).not.toContain('leading-normal!')
    expect(classes()).toContain('prose')

    wrapper.unmount()
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

  describe('find and replace', () => {
    /** The find key, as it is off a Mac, which is what the tests run as. */
    const findKey = target =>
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
      )

    const mountAttached = async () => {
      const wrapper = mount(Editor, {
        props: { storyId: 'story_1', documentId: 'doc_1' },
        attachTo: document.body,
        global: {
          plugins: [PrimeVue],
          stubs: { ScrollPanel: { template: '<div><slot /></div>' } },
        },
      })
      await flushPromises()
      return wrapper
    }

    it('opens on the find key in the document, and marks what it finds', async () => {
      const wrapper = await mountAttached()
      const page = wrapper.find('.ProseMirror').element
      page.focus()

      findKey(page)
      await flushPromises()
      expect(wrapper.find('[data-find-bar]').exists()).toBe(true)

      await wrapper.find('[data-find-query]').setValue('snow')
      expect(wrapper.find('[data-find-status]').text()).toBe('1 of 1')
      expect(wrapper.find('.ProseMirror .find-match-current').text()).toBe('Snow')
      wrapper.unmount()
    })

    it('puts the find and its marks away on Escape', async () => {
      const wrapper = await mountAttached()
      wrapper.vm.openFind()
      await flushPromises()
      await wrapper.find('[data-find-query]').setValue('snow')

      await wrapper.find('[data-find-query]').trigger('keydown', { key: 'Escape' })

      expect(wrapper.find('[data-find-bar]').exists()).toBe(false)
      expect(wrapper.find('.ProseMirror .find-match').exists()).toBe(false)
      wrapper.unmount()
    })

    it('asks for the list of keys on Mod-/', async () => {
      const wrapper = await mountAttached()
      const page = wrapper.find('.ProseMirror').element
      page.focus()

      const mod = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }
      page.dispatchEvent(
        new KeyboardEvent('keydown', { key: '/', ...mod, bubbles: true, cancelable: true })
      )

      expect(wrapper.emitted('shortcuts')).toHaveLength(1)
      wrapper.unmount()
    })

    it('leaves the key to the browser outside the editor', async () => {
      const wrapper = await mountAttached()
      const elsewhere = document.createElement('input')
      document.body.appendChild(elsewhere)
      elsewhere.focus()

      const event = new KeyboardEvent('keydown', {
        key: 'f',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      })
      elsewhere.dispatchEvent(event)
      await flushPromises()

      expect(event.defaultPrevented).toBe(false)
      expect(wrapper.find('[data-find-bar]').exists()).toBe(false)
      elsewhere.remove()
      wrapper.unmount()
    })

    it('replaces, as an edit that keeps a previewed tab', async () => {
      const wrapper = await mountAttached()
      wrapper.vm.openFind()
      await flushPromises()
      await wrapper.find('[data-find-query]').setValue('snow')
      await wrapper.find('[data-action="toggle-replace"]').trigger('click')
      await wrapper.find('[data-find-replacement]').setValue('Rain')

      await wrapper.find('[data-action="replace"]').trigger('click')

      expect(wrapper.find('.ProseMirror p').text()).toBe('Rain fell.')
      expect(wrapper.find('[data-find-status]').text()).toBe('No results')
      expect(mockApi.keep).toHaveBeenCalledWith('doc_1')
      wrapper.unmount()
    })
  })

  describe('comments', () => {
    const mountAttached = async documentId => {
      const wrapper = mount(Editor, {
        props: { storyId: 'story_1', documentId },
        attachTo: document.body,
        global: {
          plugins: [PrimeVue],
          directives: { tooltip: Tooltip },
          stubs: { ScrollPanel: { template: '<div><slot /></div>' } },
        },
      })
      await flushPromises()
      return wrapper
    }

    /** Select from `from` to `to` in the document, as the writer would. */
    const select = (documentId, from, to = from) => {
      const editor = useEditor()
      const state = editor.stateOf(documentId)
      editor.dispatch(documentId, state.tr.setSelection(TextSelection.create(state.doc, from, to)))
    }

    /** The comments on the open document, as its marks have them. */
    const marked = documentId =>
      commentRanges(useEditor().stateOf(documentId).doc).map(({ id, text }) => ({ id, text }))

    /** Write in the comment field and press Enter. */
    const write = async (wrapper, text) => {
      const field = wrapper.find('[data-comment-field]')
      await field.setValue(text)
      await field.trigger('keydown', { key: 'Enter' })
      await flushPromises()
    }

    it('offers to comment on selected text, and takes the comment under it', async () => {
      const wrapper = await mountAttached('doc_1')
      wrapper.find('.ProseMirror').element.focus()
      expect(wrapper.find('[data-comment-button]').exists()).toBe(false)

      // "Snow", in the paragraph under the heading.
      select('doc_1', 6, 10)
      await flushPromises()
      await wrapper.find('[data-comment-button]').trigger('click')
      await flushPromises()

      expect(wrapper.find('[data-comment-button]').exists()).toBe(false)
      expect(document.activeElement).toBe(wrapper.find('[data-comment-field]').element)
      // The passage stays marked while the selection does not show.
      expect(wrapper.find('.ProseMirror .field-target').text()).toBe('Snow')

      await write(wrapper, '  colder?  ')

      expect(marked('doc_1')).toEqual([{ id: expect.any(String), text: 'colder?' }])
      expect(wrapper.find('[data-comment-field]').exists()).toBe(false)
      expect(document.activeElement).toBe(wrapper.find('.ProseMirror').element)
      wrapper.unmount()
    })

    it('puts the button, the field and the comment in a bar at the bottom on a phone', async () => {
      const phone = vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(390)
      const wrapper = await mountAttached('doc_1')
      const bar = () => wrapper.find('[data-comment-bar]')
      wrapper.find('.ProseMirror').element.focus()
      expect(bar().exists()).toBe(false)

      select('doc_1', 6, 10)
      await flushPromises()
      // In the bar, and not over the text as well.
      expect(bar().find('[data-comment-button]').exists()).toBe(true)
      expect(wrapper.findAll('[data-comment-button]')).toHaveLength(1)

      await bar().find('[data-comment-button]').trigger('click')
      await flushPromises()
      expect(bar().find('[data-comment-field]').exists()).toBe(true)
      expect(wrapper.find('.ProseMirror .field-target').text()).toBe('Snow')

      await write(wrapper, 'colder?')

      expect(marked('doc_1')).toEqual([{ id: expect.any(String), text: 'colder?' }])
      // The caret, against the end of the passage, is in the comment.
      expect(bar().find('[data-comment-text]').text()).toBe('colder?')
      expect(wrapper.findAll('[data-comment-popover]')).toHaveLength(1)
      wrapper.unmount()
      phone.mockRestore()
    })

    it('opens the field on the selection with Mod-Shift-M, and Escape goes back', async () => {
      const wrapper = await mountAttached('doc_1')
      const page = wrapper.find('.ProseMirror').element
      page.focus()
      select('doc_1', 6, 10)

      page.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'M', metaKey: true, shiftKey: true, bubbles: true })
      )
      await flushPromises()
      const field = wrapper.find('[data-comment-field]')
      expect(field.exists()).toBe(true)

      await field.trigger('keydown', { key: 'Escape' })
      await flushPromises()

      expect(wrapper.find('[data-comment-field]').exists()).toBe(false)
      expect(marked('doc_1')).toEqual([])
      expect(document.activeElement).toBe(page)
      wrapper.unmount()
    })

    it('shows the comment the caret is in, until the writer types', async () => {
      const wrapper = await mountAttached('doc_2')
      wrapper.find('.ProseMirror').element.focus()

      // Inside "cold".
      select('doc_2', 12)
      await flushPromises()
      expect(wrapper.find('[data-comment-popover] [data-comment-text]').text()).toBe('reword')

      const editor = useEditor()
      editor.dispatch('doc_2', editor.stateOf('doc_2').tr.insertText('e'))
      await flushPromises()
      expect(wrapper.find('[data-comment-popover]').exists()).toBe(false)

      select('doc_2', 11)
      await flushPromises()
      expect(wrapper.find('[data-comment-popover]').exists()).toBe(true)
      select('doc_2', 3)
      await flushPromises()
      expect(wrapper.find('[data-comment-popover]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('changes what was said in the comment the caret is in', async () => {
      const wrapper = await mountAttached('doc_2')
      wrapper.find('.ProseMirror').element.focus()
      select('doc_2', 12)
      await flushPromises()

      await wrapper.find('[data-action="edit-comment"]').trigger('click')
      await flushPromises()
      const field = wrapper.find('[data-comment-field]')
      expect(field.element.value).toBe('reword')
      expect(wrapper.find('[data-action="save-comment"]').attributes('aria-label')).toBe('Save')

      await write(wrapper, 'colder')

      expect(marked('doc_2')).toEqual([{ id: 'cabcd1', text: 'colder' }])
      wrapper.unmount()
    })

    it('resolves the comment the caret is in, leaving the passage', async () => {
      const wrapper = await mountAttached('doc_2')
      wrapper.find('.ProseMirror').element.focus()
      select('doc_2', 12)
      await flushPromises()

      await wrapper.find('[data-action="resolve-comment"]').trigger('click')
      await flushPromises()

      expect(marked('doc_2')).toEqual([])
      expect(wrapper.find('.ProseMirror p').text()).toBe('We had a cold attic.')
      expect(wrapper.find('[data-comment-popover]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('makes the comment the caret is in the current one, until the caret leaves', async () => {
      const wrapper = await mountAttached('doc_2')
      wrapper.find('.ProseMirror').element.focus()

      select('doc_2', 12)
      await flushPromises()
      expect(currentComment.value).toMatchObject({ documentId: 'doc_2', id: 'cabcd1' })
      // Already in view: nothing is left for a view to scroll to.
      expect(takeUpComment('doc_2')).toBe(null)

      select('doc_2', 3)
      await flushPromises()
      expect(currentComment.value).toBe(null)
      wrapper.unmount()
    })

    it('leaves the comment the list went to current until the writer moves on', async () => {
      const wrapper = await mountAttached('doc_2')
      goToComment('doc_2', 'cabcd1')
      await flushPromises()

      // The model writing before the caret carries it along; the writer has
      // not moved it.
      const editor = useEditor()
      editor.dispatch('doc_2', editor.stateOf('doc_2').tr.insertText('So ', 1))
      await flushPromises()

      expect(currentComment.value).toMatchObject({ id: 'cabcd1' })
      leaveComment('doc_2')
      wrapper.unmount()
    })

    it('puts the field away when the text changes under it', async () => {
      const wrapper = await mountAttached('doc_1')
      wrapper.find('.ProseMirror').element.focus()
      select('doc_1', 6, 10)
      await flushPromises()
      await wrapper.find('[data-comment-button]').trigger('click')
      await flushPromises()

      // The model writing to the document, say.
      const editor = useEditor()
      editor.dispatch('doc_1', editor.stateOf('doc_1').tr.insertText('Deep ', 6))
      await flushPromises()

      expect(wrapper.find('[data-comment-field]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('offers nothing for a caret, or once the editor has lost the focus', async () => {
      const wrapper = await mountAttached('doc_1')
      const page = wrapper.find('.ProseMirror').element
      page.focus()

      select('doc_1', 6, 6)
      await flushPromises()
      expect(wrapper.find('[data-comment-button]').exists()).toBe(false)

      select('doc_1', 6, 10)
      await flushPromises()
      expect(wrapper.find('[data-comment-button]').exists()).toBe(true)
      page.blur()
      await flushPromises()
      expect(wrapper.find('[data-comment-button]').exists()).toBe(false)
      wrapper.unmount()
    })

    it('marks the comment gone to, until the writer moves on', async () => {
      const wrapper = await mountAttached('doc_2')
      expect(wrapper.find('.ProseMirror .comment-current').exists()).toBe(false)

      goToComment('doc_2', 'cabcd1')
      await flushPromises()
      expect(wrapper.find('.ProseMirror .comment-current').text()).toBe('cold')

      leaveComment('doc_2')
      await flushPromises()
      expect(wrapper.find('.ProseMirror .comment-current').exists()).toBe(false)
      wrapper.unmount()
    })

    it('takes up a comment gone to before its document opened', async () => {
      goToComment('doc_2', 'cabcd1')
      const wrapper = await mountAttached('doc_2')
      expect(wrapper.find('.ProseMirror .comment-current').text()).toBe('cold')
      leaveComment('doc_2')
      wrapper.unmount()
    })
  })
})
