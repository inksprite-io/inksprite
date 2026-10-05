import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
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

const mountRaw = async documentId => {
  const wrapper = mount(RawMarkdown, {
    props: { storyId: 'story_1', documentId },
    attachTo: document.body,
    global: { stubs: { ScrollPanel: { template: '<div><slot /></div>' } } },
  })
  await flushPromises()
  return wrapper
}

const field = wrapper => wrapper.find('textarea')

/** Type into the field, the way a keystroke would. */
const type = async (wrapper, value) => {
  field(wrapper).element.value = value
  await field(wrapper).trigger('input')
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

    expect(field(wrapper).element.value).toBe('# One\n\n* a *b*')
    expect(useEditor().holds('p_1')).toBe(true)
    expect(useEditor().stateOf('p_1')).toBeNull()
  })

  it('shows the text the registry already holds rather than the store', async () => {
    useEditor().open('p_1', 'Typed, unflushed.', true)
    const wrapper = await mountRaw('p_1')
    expect(field(wrapper).element.value).toBe('Typed, unflushed.')
  })

  it('is empty for a document with nothing in it, with no placeholder', async () => {
    const wrapper = await mountRaw('p_2')
    expect(field(wrapper).element.value).toBe('')
    expect(field(wrapper).attributes('placeholder')).toBeUndefined()
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

    expect(field(wrapper).element.value).toBe('* item')
    expect(useEditor().markdown('p_1')).toBe('* item')
  })

  it('writes out at once on blur', async () => {
    const wrapper = await mountRaw('p_1')
    await type(wrapper, 'Leaving the field.')
    await field(wrapper).trigger('blur')

    expect(mockUpdateDocument).toHaveBeenCalledWith('p_1', { content: 'Leaving the field.' })
  })

  it('follows the document as the assistant writes to it', async () => {
    const wrapper = await mountRaw('p_1')

    useEditor().appendContent('p_1', '{{then}}')
    await flushPromises()

    expect(field(wrapper).element.value).toBe('# One\n\n* a *b*\n\n{{then}}')
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
    await field(wrapper).trigger('blur')
    wrapper.unmount()
    expect(mockUpdateDocument).not.toHaveBeenCalled()
  })
})
