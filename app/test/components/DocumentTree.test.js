/* global File */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import ToastService from 'primevue/toastservice'
import Tooltip from 'primevue/tooltip'
import DocumentTree from '../../src/components/writer/tree/DocumentTree.vue'
import { useDocuments, clearDocumentInstances } from '../../src/composables/useDocuments'
import { clearChatsInstances } from '../../src/composables/useChats'

vi.mock('../../src/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
    },
    files: { put: vi.fn(async () => undefined), get: vi.fn(async () => undefined) },
    chatProfiles: { toArray: vi.fn(async () => []) },
  },
}))
vi.mock('../../src/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

const { mockStory } = await vi.hoisted(async () => {
  const { reactive } = await import('vue')
  return { mockStory: reactive({ id: 'story_1', title: 'My Novel' }) }
})
vi.mock('../../src/stores/storiesStore', () => ({
  useStoriesStore: () => ({
    getStory: id => (id === 'story_1' ? mockStory : null),
    updateStory: vi.fn((_id, updates) => Object.assign(mockStory, updates)),
    deleteStory: vi.fn(),
  }),
}))
vi.mock('../../src/composables/useScreenSize', () => ({
  useScreenSize: () => ({ isMobile: { value: false } }),
}))
vi.mock('../../src/components/writer/tree/DocumentSummary.vue', () => ({
  default: { name: 'DocumentSummary', template: '<div class="summary-stub" />' },
}))

const importMany = vi.fn(async () => ({
  documents: 2,
  folders: 1,
  cards: 0,
  scans: 0,
  skipped: [],
}))
vi.mock('../../src/composables/useBulkImport', async importOriginal => {
  const original = await importOriginal()
  return { ...original, useBulkImport: () => ({ importMany }) }
})

const toastAdd = vi.fn()
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: toastAdd }) }))

const mountTree = () =>
  mount(DocumentTree, {
    props: { storyId: 'story_1' },
    global: {
      plugins: [PrimeVue, ConfirmationService, ToastService],
      directives: { tooltip: Tooltip },
    },
  })

/** A file as a folder chooser hands it over. */
const chosen = path => {
  const file = new File(['x'], path.split('/').pop(), { type: 'text/markdown' })
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file
}

/** Put files on a hidden input and fire its change. */
const choose = async (input, files) => {
  Object.defineProperty(input.element, 'files', { value: files, configurable: true })
  await input.trigger('change')
  await flushPromises()
}

describe('DocumentTree importing', () => {
  /** @type {ReturnType<typeof useDocuments>} */
  let api

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    clearChatsInstances()
    vi.clearAllMocks()
    api = useDocuments('story_1')
    await api.init()
  })

  it('has one chooser for files together and one for a folder whole', () => {
    const wrapper = mountTree()

    const files = wrapper.find('input[type="file"][multiple]')
    const folder = wrapper.find('input[type="file"][webkitdirectory]')
    expect(files.exists()).toBe(true)
    expect(folder.exists()).toBe(true)
  })

  it('writes several chosen files as a batch, into the folder asked for', async () => {
    const wrapper = mountTree()
    const notes = api.createFolder(api.root.value.id, 'Notes')
    await wrapper.vm.$nextTick()
    // The folder's menu says where; the tree opens the chooser.
    wrapper.findComponent({ name: 'DocumentNode' }).vm.$emit('import', notes.id)

    await choose(wrapper.find('input[multiple]'), [chosen('a.md'), chosen('b.md')])

    expect(importMany).toHaveBeenCalledTimes(1)
    const [gathered, options] = importMany.mock.calls[0]
    expect(gathered.map(g => g.file.name)).toEqual(['a.md', 'b.md'])
    expect(options.parentId).toBe(notes.id)
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ summary: 'Imported 2 documents, 1 new folder' })
    )
  })

  it('writes a chosen folder with the folders inside it', async () => {
    const wrapper = mountTree()
    wrapper.findComponent({ name: 'DocumentNode' }).vm.$emit('import-folder', api.root.value.id)

    await choose(wrapper.find('input[webkitdirectory]'), [
      chosen('papers/a.md'),
      chosen('papers/2011/b.md'),
    ])

    const [gathered] = importMany.mock.calls[0]
    expect(gathered.map(g => g.folders)).toEqual([['papers'], ['papers', '2011']])
  })

  it('shows where a drag of files would land, and imports them there on drop', async () => {
    const wrapper = mountTree()
    const notes = api.createFolder(api.root.value.id, 'Notes')
    await wrapper.vm.$nextTick()
    const tree = wrapper.find('[data-document-tree]')
    const row = wrapper.find(`[data-document-id="${notes.id}"]`)
    const files = [new File(['x'], 'dropped.md', { type: 'text/markdown' })]
    const dataTransfer = { types: ['Files'], items: [], files, dropEffect: '' }

    await row.trigger('dragenter', { dataTransfer })
    await row.trigger('dragover', { dataTransfer })
    expect(wrapper.find('[data-drop-hint]').text()).toBe('Drop to import into Notes')

    await row.trigger('drop', { dataTransfer })
    await flushPromises()

    expect(wrapper.find('[data-drop-hint]').exists()).toBe(false)
    expect(importMany).toHaveBeenCalledTimes(1)
    const [gathered, options] = importMany.mock.calls[0]
    expect(gathered.map(g => g.file.name)).toEqual(['dropped.md'])
    expect(options.parentId).toBe(notes.id)
    expect(tree.exists()).toBe(true)
  })

  it('lands a drop on the space below the documents in the project', async () => {
    const wrapper = mountTree()
    const files = [new File(['x'], 'dropped.md', { type: 'text/markdown' })]
    const dataTransfer = { types: ['Files'], items: [], files, dropEffect: '' }

    await wrapper.find('[data-document-tree]').trigger('drop', { dataTransfer })
    await flushPromises()

    expect(importMany.mock.calls[0][1].parentId).toBe(api.root.value.id)
  })

  it('leaves a drag of a document within the tree alone', async () => {
    const wrapper = mountTree()
    const dataTransfer = { types: ['text/plain'], items: [], files: [] }

    await wrapper.find('[data-document-tree]').trigger('dragover', { dataTransfer })
    await wrapper.find('[data-document-tree]').trigger('drop', { dataTransfer })

    expect(wrapper.find('[data-drop-hint]').exists()).toBe(false)
    expect(importMany).not.toHaveBeenCalled()
  })
})
