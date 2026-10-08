import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { computed } from 'vue'
import { useEditor, clearEditor, PROJECTION_DELAY } from '../../src/composables/useEditor'
import { serializeMarkdown } from '../../src/editor/markdown.js'

const { mockUpdateDocument, mockGetDocument } = vi.hoisted(() => ({
  mockUpdateDocument: vi.fn(),
  mockGetDocument: vi.fn(() => ({})),
}))

vi.mock('@/stores/documentsStore.js', () => ({
  useDocumentsStore: () => ({ updateDocument: mockUpdateDocument, getDocument: mockGetDocument }),
}))

/** Type at the caret in one document, the way its view would. */
const typeText = (editor, id, text) => editor.dispatch(id, editor.stateOf(id).tr.insertText(text))

const fakeView = () => ({ updateState: vi.fn(), focus: vi.fn() })

describe('useEditor', () => {
  /** @type {ReturnType<typeof useEditor>} */
  let editor

  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockGetDocument.mockReturnValue({})
    clearEditor()
    editor = useEditor()
  })

  afterEach(() => {
    clearEditor()
    vi.useRealTimers()
  })

  it('is one registry, app-wide', () => {
    useEditor().open('doc_1', 'Hello')
    expect(editor.holds('doc_1')).toBe(true)
    expect(useEditor().stateOf('doc_1')).toBe(editor.stateOf('doc_1'))
  })

  describe('open and close', () => {
    it('opens a document as editor state and knows which it holds', () => {
      editor.open('doc_1', '# Title\n\nText.')

      expect(serializeMarkdown(editor.stateOf('doc_1').doc)).toBe('# Title\n\nText.')
      expect(editor.holds('doc_1')).toBe(true)
      expect(editor.holds('doc_2')).toBe(false)
      expect(editor.holds(null)).toBe(false)
      expect(editor.openIds()).toEqual(['doc_1'])
    })

    it('holds several documents at once, in the order opened', () => {
      editor.open('doc_1', 'One')
      editor.open('doc_2', 'Two')

      expect(editor.openIds()).toEqual(['doc_1', 'doc_2'])
      expect(editor.markdown('doc_1')).toBe('One')
      expect(editor.markdown('doc_2')).toBe('Two')
    })

    it('resumes a document it holds rather than reopening it', () => {
      const first = editor.open('doc_1', 'One')
      typeText(editor, 'doc_1', '.')

      const again = editor.open('doc_1', 'Stale')

      expect(again).toBe(editor.stateOf('doc_1'))
      expect(again).not.toBe(first)
      expect(editor.markdown('doc_1')).toBe('One.')
    })

    it('holds nothing when closed', () => {
      editor.open('doc_1', 'x')
      editor.close('doc_1')

      expect(editor.stateOf('doc_1')).toBeNull()
      expect(editor.holds('doc_1')).toBe(false)
      expect(editor.markdown('doc_1')).toBe('')
      expect(editor.openIds()).toEqual([])
    })

    it('writes out what changed when it closes', () => {
      editor.open('doc_1', 'One')
      typeText(editor, 'doc_1', '.')
      editor.close('doc_1')

      expect(mockUpdateDocument).toHaveBeenCalledWith('doc_1', { content: 'One.' })
    })

    it('writes nothing out when nothing changed', () => {
      editor.open('doc_1', 'One')
      editor.close('doc_1')

      expect(mockUpdateDocument).not.toHaveBeenCalled()
    })

    it('closes one document and leaves the others', () => {
      editor.open('doc_1', 'One')
      editor.open('doc_2', 'Two')
      typeText(editor, 'doc_2', '!')

      editor.close('doc_1')

      expect(editor.holds('doc_1')).toBe(false)
      expect(editor.markdown('doc_2')).toBe('Two!')
      expect(mockUpdateDocument).not.toHaveBeenCalled()
    })

    it('discards a document without writing it out', () => {
      editor.open('doc_1', 'One')
      typeText(editor, 'doc_1', '.')

      editor.discard('doc_1')
      vi.advanceTimersByTime(PROJECTION_DELAY)

      expect(editor.holds('doc_1')).toBe(false)
      expect(mockUpdateDocument).not.toHaveBeenCalled()
    })

    it('is unbothered by closing what is not open', () => {
      expect(() => editor.close('doc_9')).not.toThrow()
      expect(() => editor.discard('doc_9')).not.toThrow()
    })
  })

  describe('dispatch', () => {
    it('applies the transaction and shows the view the new state', () => {
      const view = fakeView()
      editor.open('doc_1', 'One')
      editor.attach('doc_1', view)

      typeText(editor, 'doc_1', ' two')

      expect(editor.markdown('doc_1')).toBe('One two')
      expect(view.updateState).toHaveBeenCalledWith(editor.stateOf('doc_1'))
    })

    it('keeps documents apart', () => {
      const one = fakeView()
      const two = fakeView()
      editor.open('doc_1', 'One')
      editor.open('doc_2', 'Two')
      editor.attach('doc_1', one)
      editor.attach('doc_2', two)

      typeText(editor, 'doc_1', '!')

      expect(editor.markdown('doc_2')).toBe('Two')
      expect(one.updateState).toHaveBeenCalled()
      expect(two.updateState).not.toHaveBeenCalled()
    })

    it('ignores a transaction for a document that is not open', () => {
      editor.open('doc_1', 'One')
      const tr = editor.stateOf('doc_1').tr.insertText('!')
      editor.close('doc_1')

      expect(() => editor.dispatch('doc_1', tr)).not.toThrow()
    })
  })

  describe('the projection', () => {
    it('reaches the store after a pause in typing, once', () => {
      editor.open('doc_1', 'One')
      typeText(editor, 'doc_1', ' two')
      typeText(editor, 'doc_1', ' three')

      expect(mockUpdateDocument).not.toHaveBeenCalled()
      vi.advanceTimersByTime(PROJECTION_DELAY - 1)
      expect(mockUpdateDocument).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(mockUpdateDocument).toHaveBeenCalledTimes(1)
      expect(mockUpdateDocument).toHaveBeenCalledWith('doc_1', { content: 'One two three' })
    })

    it('waits while typing goes on', () => {
      editor.open('doc_1', 'One')
      typeText(editor, 'doc_1', ' two')
      vi.advanceTimersByTime(PROJECTION_DELAY - 100)
      typeText(editor, 'doc_1', ' three')
      vi.advanceTimersByTime(PROJECTION_DELAY - 100)

      expect(mockUpdateDocument).not.toHaveBeenCalled()
      vi.advanceTimersByTime(100)
      expect(mockUpdateDocument).toHaveBeenCalledWith('doc_1', { content: 'One two three' })
    })

    it('runs for each document on its own clock', () => {
      editor.open('doc_1', 'One')
      editor.open('doc_2', 'Two')
      typeText(editor, 'doc_1', '.')
      vi.advanceTimersByTime(PROJECTION_DELAY / 2)
      typeText(editor, 'doc_2', '.')
      vi.advanceTimersByTime(PROJECTION_DELAY / 2)

      expect(mockUpdateDocument).toHaveBeenCalledTimes(1)
      expect(mockUpdateDocument).toHaveBeenCalledWith('doc_1', { content: 'One.' })
      vi.advanceTimersByTime(PROJECTION_DELAY / 2)
      expect(mockUpdateDocument).toHaveBeenCalledWith('doc_2', { content: 'Two.' })
    })

    it('is not scheduled by a change of selection alone', () => {
      editor.open('doc_1', 'One')
      const state = editor.stateOf('doc_1')
      editor.dispatch('doc_1', state.tr.setSelection(state.selection))
      vi.advanceTimersByTime(PROJECTION_DELAY)

      expect(mockUpdateDocument).not.toHaveBeenCalled()
    })

    it('flushes one document at once when asked, and then has nothing to flush', () => {
      editor.open('doc_1', 'One')
      typeText(editor, 'doc_1', '.')

      editor.flush('doc_1')
      expect(mockUpdateDocument).toHaveBeenCalledWith('doc_1', { content: 'One.' })

      editor.flush('doc_1')
      vi.advanceTimersByTime(PROJECTION_DELAY)
      expect(mockUpdateDocument).toHaveBeenCalledTimes(1)
    })

    it('flushes every open document when asked for no one in particular', () => {
      editor.open('doc_1', 'One')
      editor.open('doc_2', 'Two')
      editor.open('doc_3', 'Three')
      typeText(editor, 'doc_1', '.')
      typeText(editor, 'doc_3', '.')

      editor.flush()

      expect(mockUpdateDocument).toHaveBeenCalledTimes(2)
      expect(mockUpdateDocument).toHaveBeenCalledWith('doc_1', { content: 'One.' })
      expect(mockUpdateDocument).toHaveBeenCalledWith('doc_3', { content: 'Three.' })
    })

    it('is nothing to flush when nothing is open', () => {
      expect(() => editor.flush()).not.toThrow()
      expect(() => editor.flush('doc_1')).not.toThrow()
      expect(mockUpdateDocument).not.toHaveBeenCalled()
    })

    it('writes nothing for a document the store no longer has', () => {
      editor.open('doc_1', 'One')
      typeText(editor, 'doc_1', '.')
      mockGetDocument.mockReturnValue(null)

      expect(() => editor.close('doc_1')).not.toThrow()
      expect(mockUpdateDocument).not.toHaveBeenCalled()
    })
  })

  describe('writes from outside', () => {
    it('replaces the content and writes it through at once', () => {
      editor.open('doc_1', 'Old.')
      editor.replaceContent('doc_1', '# New\n\nText.')

      expect(editor.markdown('doc_1')).toBe('# New\n\nText.')
      expect(mockUpdateDocument).toHaveBeenCalledWith('doc_1', { content: '# New\n\nText.' })
    })

    it('appends blocks and writes them through at once', () => {
      editor.open('doc_1', 'One.')
      editor.appendContent('doc_1', 'Two.')

      expect(editor.markdown('doc_1')).toBe('One.\n\nTwo.')
      expect(mockUpdateDocument).toHaveBeenCalledWith('doc_1', { content: 'One.\n\nTwo.' })
    })

    it('carries what was typed along with what was appended', () => {
      editor.open('doc_1', 'One')
      typeText(editor, 'doc_1', '.')
      editor.appendContent('doc_1', 'Two.')

      expect(mockUpdateDocument).toHaveBeenCalledTimes(1)
      expect(mockUpdateDocument).toHaveBeenCalledWith('doc_1', { content: 'One.\n\nTwo.' })
    })

    it('reaches a document that is open without a view', () => {
      editor.open('doc_1', 'One.')
      editor.open('doc_2', 'Two.')
      editor.attach('doc_1', fakeView())

      editor.appendContent('doc_2', 'More.')

      expect(editor.markdown('doc_2')).toBe('Two.\n\nMore.')
      expect(editor.markdown('doc_1')).toBe('One.')
    })

    it('does nothing for a document that is not open', () => {
      editor.replaceContent('doc_1', 'x')
      editor.appendContent('doc_1', 'x')
      expect(mockUpdateDocument).not.toHaveBeenCalled()
    })
  })

  describe('plain documents', () => {
    it('opens as its text, with no state', () => {
      expect(editor.open('p_1', '* a\n\n<x>', true)).toBeNull()
      expect(editor.holds('p_1')).toBe(true)
      expect(editor.stateOf('p_1')).toBeNull()
      expect(editor.markdown('p_1')).toBe('* a\n\n<x>')
    })

    it('takes what is typed, and the store hears after a pause, as typed', () => {
      editor.open('p_1', '', true)
      editor.setText('p_1', '* a')
      editor.setText('p_1', '* a\n* b')
      expect(editor.markdown('p_1')).toBe('* a\n* b')

      vi.advanceTimersByTime(PROJECTION_DELAY - 1)
      expect(mockUpdateDocument).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(mockUpdateDocument).toHaveBeenCalledTimes(1)
      expect(mockUpdateDocument).toHaveBeenCalledWith('p_1', { content: '* a\n* b' })
    })

    it('takes writes from outside as they are, at once', () => {
      editor.open('p_1', 'Old', true)
      editor.replaceContent('p_1', 'x *y* {{z}}')
      expect(editor.markdown('p_1')).toBe('x *y* {{z}}')
      expect(mockUpdateDocument).toHaveBeenLastCalledWith('p_1', { content: 'x *y* {{z}}' })

      editor.appendContent('p_1', '<tag>')
      expect(editor.markdown('p_1')).toBe('x *y* {{z}}\n\n<tag>')
      expect(mockUpdateDocument).toHaveBeenLastCalledWith('p_1', {
        content: 'x *y* {{z}}\n\n<tag>',
      })
    })

    it('writes out what was typed when it closes', () => {
      editor.open('p_1', 'One', true)
      editor.setText('p_1', 'One.')
      editor.close('p_1')
      expect(mockUpdateDocument).toHaveBeenCalledWith('p_1', { content: 'One.' })
      expect(editor.holds('p_1')).toBe(false)
    })

    it('has nothing to dispatch to, attach to, or focus', () => {
      editor.open('d_1', 'One')
      const tr = editor.stateOf('d_1').tr.insertText('!')
      editor.open('p_1', 'One', true)

      expect(() => editor.dispatch('p_1', tr)).not.toThrow()
      expect(() => editor.attach('p_1', fakeView())).not.toThrow()
      expect(() => editor.focus('p_1')).not.toThrow()
      expect(editor.markdown('p_1')).toBe('One')
    })

    it('ignores typing into a structured document', () => {
      editor.open('d_1', 'One')
      editor.setText('d_1', 'Two')
      expect(editor.markdown('d_1')).toBe('One')
    })
  })

  describe('convert', () => {
    it('makes a structured document plain, keeping what was typed', () => {
      editor.open('d_1', 'One')
      typeText(editor, 'd_1', '.')

      editor.convert('d_1', true)

      expect(editor.stateOf('d_1')).toBeNull()
      expect(editor.markdown('d_1')).toBe('One.')
      expect(mockUpdateDocument).toHaveBeenCalledWith('d_1', { content: 'One.' })
    })

    it('makes a plain document structured, settled, and says so to the store', () => {
      editor.open('p_1', '* a', true)

      editor.convert('p_1', false)

      expect(editor.stateOf('p_1')).not.toBeNull()
      expect(editor.markdown('p_1')).toBe('- a')
      expect(mockUpdateDocument).toHaveBeenCalledWith('p_1', { content: '- a' })
    })

    it('is nothing for a document already of that kind, or not open', () => {
      editor.open('d_1', 'One')
      editor.convert('d_1', false)
      editor.convert('d_9', true)
      expect(mockUpdateDocument).not.toHaveBeenCalled()
    })

    it('happens on opening a document as the other kind', () => {
      editor.open('p_1', '* a', true)
      expect(editor.open('p_1', 'ignored', false)).not.toBeNull()
      expect(editor.markdown('p_1')).toBe('- a')
    })
  })

  it('lets a computed follow a document as it changes', () => {
    const markdown = computed(() => editor.markdown('doc_1'))
    expect(markdown.value).toBe('')

    editor.open('doc_1', 'One')
    expect(markdown.value).toBe('One')

    typeText(editor, 'doc_1', '.')
    expect(markdown.value).toBe('One.')

    editor.appendContent('doc_1', 'Two.')
    expect(markdown.value).toBe('One.\n\nTwo.')

    editor.close('doc_1')
    expect(markdown.value).toBe('')

    editor.open('p_1', 'text', true)
    expect(markdown.value).toBe('')
    const plain = computed(() => editor.markdown('p_1'))
    expect(plain.value).toBe('text')
    editor.setText('p_1', 'text more')
    expect(plain.value).toBe('text more')
  })

  it('remembers where a document was scrolled to', () => {
    editor.open('doc_1', 'One')
    expect(editor.scrollTop('doc_1')).toBe(0)

    editor.rememberScroll('doc_1', 420)

    expect(editor.scrollTop('doc_1')).toBe(420)
    expect(editor.scrollTop('doc_9')).toBe(0)
    expect(() => editor.rememberScroll('doc_9', 1)).not.toThrow()
  })

  it("keeps a plain document's own anchor beside the offset, and not past a conversion", () => {
    const anchor = { at: 'line 300' }
    editor.open('p_1', 'text', true)
    editor.rememberScroll('p_1', 420, anchor)
    expect(editor.scrollAnchor('p_1')).toBe(anchor)

    editor.convert('p_1', false)
    expect(editor.scrollTop('p_1')).toBe(420)
    expect(editor.scrollAnchor('p_1')).toBeNull()
  })

  it('focuses the view a document has', () => {
    const view = fakeView()
    editor.open('doc_1', 'One')
    editor.attach('doc_1', view)
    editor.focus('doc_1')
    expect(view.focus).toHaveBeenCalled()
    editor.attach('doc_1', null)
    expect(() => editor.focus('doc_1')).not.toThrow()
    expect(() => editor.focus('doc_9')).not.toThrow()
  })
})
