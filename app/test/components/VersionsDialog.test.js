import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'

const api = vi.hoisted(() => ({
  list: vi.fn(),
  current: vi.fn(() => 'The gate was open.'),
  restore: vi.fn(),
  keepNamed: vi.fn(),
  rename: vi.fn((version, name) => ({ ...version, name })),
  remove: vi.fn(),
}))
vi.mock('@/composables/useVersions.js', async () => {
  const { ref } = await import('vue')
  const showing = ref(null)
  const picking = ref(null)
  return {
    useVersions: () => api,
    useVersionsPanel: () => ({
      showing,
      picking,
      open: (id, versionId) => {
        picking.value = versionId ?? null
        showing.value = id
      },
      close: () => (showing.value = null),
    }),
  }
})

const chapter = vi.hoisted(() => ({
  id: 'doc_1',
  storyId: 'story_1',
  type: 'text',
  title: 'Chapter 1',
  plain: false,
  comments: undefined,
}))
vi.mock('@/stores/documentsStore', () => ({
  useDocumentsStore: () => ({ getDocument: id => (id === 'doc_1' ? chapter : null) }),
}))

vi.mock('@/composables/usePictures.js', () => ({
  usePictures: () => ({ describe: () => ({ kind: 'missing', label: '' }), open: vi.fn() }),
}))
vi.mock('@/composables/useDocumentLinks.js', () => ({
  useDocumentLinks: () => ({ copiedHref: href => href }),
}))

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/composables/useToast', () => ({ useToast: () => toast }))

import VersionsDialog from '@/components/writer/editor/VersionsDialog.vue'
import { useVersionsPanel } from '@/composables/useVersions.js'

const HOUR = 60 * 60_000
const versions = () => [
  {
    id: 'ver_2',
    storyId: 'story_1',
    documentId: 'doc_1',
    at: Date.now() - HOUR,
    title: 'Chapter 1',
    content: 'The gate was locked.',
    words: 4,
    by: 'model',
  },
  {
    id: 'ver_1',
    storyId: 'story_1',
    documentId: 'doc_1',
    at: Date.now() - 2 * HOUR,
    title: 'Chapter 1',
    content: 'The gate.',
    words: 2,
    name: 'First draft',
  },
]

const mountDialog = async (/** @type {string} */ versionId = undefined) => {
  const wrapper = mount(VersionsDialog, {
    props: { storyId: 'story_1' },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: {
        Dialog: {
          props: ['visible'],
          template: '<div v-if="visible"><slot /><slot name="footer" /></div>',
        },
      },
    },
  })
  useVersionsPanel().open('doc_1', versionId)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  useVersionsPanel().close()
  api.list.mockResolvedValue(versions())
  chapter.plain = false
  chapter.comments = undefined
})

describe('VersionsDialog', () => {
  it('lists the versions, newest first, with a name or what each was taken before', async () => {
    const wrapper = await mountDialog()

    const listed = wrapper.findAll('[data-version]').map(item => item.text())
    expect(listed[0]).toContain('Before the model’s edits')
    expect(listed[0]).toContain('4 words')
    expect(listed[1]).toContain('First draft')
    expect(wrapper.find('[data-version="ver_2"]').attributes('aria-pressed')).toBe('true')
  })

  it('starts on the version it was opened on, as a clash’s notice opens it', async () => {
    const wrapper = await mountDialog('ver_1')
    expect(wrapper.find('[data-version="ver_1"]').attributes('aria-pressed')).toBe('true')
    expect(useVersionsPanel().picking.value).toBeNull()
  })

  it('marks what a restore would bring back and what it would take out', async () => {
    const wrapper = await mountDialog()

    const text = wrapper.find('[data-version-text]')
    expect(text.text()).toBe('The gate was openlocked.')
    expect(text.find('del[data-suggestion-id="~restore"]').text()).toBe('open')
    expect(text.find('ins[data-suggestion-id="~restore"]').text()).toBe('locked')
  })

  it('shows the version as the editor shows text, its comments with it', async () => {
    api.current.mockReturnValueOnce('# The gate\n\nIt was open.')
    chapter.comments = { c1abcd: { status: 'open', posts: [] } }
    api.list.mockResolvedValue([
      {
        ...versions()[0],
        content: '# The gate\n\nIt was {==*locked*==}{>>c1abcd<<}.\n\n- a key\n- a lamp',
      },
    ])
    const wrapper = await mountDialog()

    const text = wrapper.find('[data-version-text]')
    expect(text.find('h1').text()).toBe('The gate')
    expect(text.find('mark.comment em').text()).toBe('locked')
    expect(text.findAll('li ins[data-suggestion-id="~restore"]').map(item => item.text())).toEqual([
      'a key',
      'a lamp',
    ])
    expect(text.text()).not.toContain('{==')
  })

  it('shows a plain document’s versions as they are written', async () => {
    chapter.plain = true
    api.current.mockReturnValueOnce('**The gate** was open.')
    const wrapper = await mountDialog()

    const text = wrapper.find('[data-version-written]')
    expect(text.text()).toBe('**TheThe gate**gate was open.locked.')
    expect(text.findAll('[data-goes]').map(piece => piece.text())).toEqual([
      '**The',
      'gate**',
      'open.',
    ])
  })

  it('restores the one picked, and closes onto it', async () => {
    const wrapper = await mountDialog()
    await wrapper.find('[data-version="ver_1"]').trigger('click')

    await wrapper.find('[data-action="restore-version"]').trigger('click')

    expect(api.restore).toHaveBeenCalledWith(expect.objectContaining({ id: 'ver_1' }))
    expect(toast.success).not.toHaveBeenCalled()
    expect(useVersionsPanel().showing.value).toBeNull()
  })

  it('offers no restore of a version the same as the text now', async () => {
    api.current.mockReturnValueOnce('The gate was locked.')
    const wrapper = await mountDialog()

    expect(wrapper.find('[data-version-same]').exists()).toBe(true)
    expect(wrapper.find('[data-action="restore-version"]').attributes('disabled')).toBeDefined()
  })

  it('takes a version written otherwise but reading the same for the text now', async () => {
    api.current.mockReturnValueOnce('* The gate was locked.')
    api.list.mockResolvedValue([{ ...versions()[0], content: '- The gate was locked.' }])
    const wrapper = await mountDialog()

    expect(wrapper.find('[data-version-same]').exists()).toBe(true)
    expect(wrapper.find('[data-action="restore-version"]').attributes('disabled')).toBeDefined()
  })

  it('names a version, and deletes one', async () => {
    const wrapper = await mountDialog()

    await wrapper.find('[data-action="name-version"]').trigger('click')
    await wrapper.find('[data-field="version-name"]').setValue('Kept')
    await wrapper.find('[data-field="version-name"]').trigger('keydown', { key: 'Enter' })
    expect(api.rename).toHaveBeenCalledWith(expect.objectContaining({ id: 'ver_2' }), 'Kept')
    expect(wrapper.find('[data-version="ver_2"]').text()).toContain('Kept')

    await wrapper.find('[data-action="delete-version"]').trigger('click')
    expect(api.remove).toHaveBeenCalled()
    expect(wrapper.findAll('[data-version]').map(item => item.attributes('data-version'))).toEqual([
      'ver_1',
    ])
  })

  it('keeps the text now under a name', async () => {
    api.keepNamed.mockResolvedValue({ ...versions()[0], id: 'ver_3', name: 'Now' })
    const wrapper = await mountDialog()

    await wrapper.find('[data-action="keep-version"]').trigger('click')
    await wrapper.find('[data-field="keep-name"]').setValue('Now')
    await wrapper.find('[data-action="keep-now"]').trigger('click')
    await flushPromises()

    expect(api.keepNamed).toHaveBeenCalledWith('doc_1', 'Now')
    expect(api.list).toHaveBeenCalledTimes(2)
  })

  it('says when there are none', async () => {
    api.list.mockResolvedValue([])
    const wrapper = await mountDialog()
    expect(wrapper.find('[data-no-versions]').exists()).toBe(true)
  })
})
