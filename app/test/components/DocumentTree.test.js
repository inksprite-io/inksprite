/* global File */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import ToastService from 'primevue/toastservice'
import Tooltip from 'primevue/tooltip'
import ContextMenu from 'primevue/contextmenu'
import Menu from 'primevue/menu'
import DocumentTree from '../../src/components/writer/tree/DocumentTree.vue'
import { useDocuments, clearDocumentInstances } from '../../src/composables/useDocuments'
import { clearChatsInstances } from '../../src/composables/useChats'
import { useApplicationState } from '../../src/composables/useApplicationState'

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

const { mockStory, deleteStory, push } = await vi.hoisted(async () => {
  const { reactive } = await import('vue')
  return {
    mockStory: reactive({ id: 'story_1', title: 'My Novel' }),
    deleteStory: vi.fn(async () => undefined),
    push: vi.fn(),
  }
})
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('../../src/stores/storiesStore', () => ({
  useStoriesStore: () => ({
    getStory: id => (id === 'story_1' ? mockStory : null),
    updateStory: vi.fn((_id, updates) => Object.assign(mockStory, updates)),
    deleteStory,
  }),
}))

const dropJobsForStory = vi.fn(async () => undefined)
vi.mock('../../src/jobs/index.js', async importOriginal => ({
  ...(await importOriginal()),
  dropJobsForStory: storyId => dropJobsForStory(storyId),
}))

// Every deletion is confirmed; anything else asked is answered as the test says.
const { confirmed } = vi.hoisted(() => ({ confirmed: { answer: 'accept', asked: [] } }))
vi.mock('primevue/useconfirm', () => ({
  useConfirm: () => ({
    require: options => {
      confirmed.asked.push(options)
      return confirmed.answer === 'reject' ? options.reject() : options.accept()
    },
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

const importFolder = vi.fn(async () => ({
  folderId: 'doc_repository',
  name: 'app',
  files: 3,
  left: { never: 0, ignored: 0, binary: [], large: [] },
}))
vi.mock('../../src/composables/useRepositoryImport.js', async importOriginal => ({
  ...(await importOriginal()),
  useRepositoryImport: () => ({ importFolder, importGitHub: vi.fn(), refresh: vi.fn() }),
}))

const writeProject = vi.fn(async () => ({
  documents: 5,
  folders: 2,
  cards: 0,
  scans: 0,
  skipped: [],
}))
vi.mock('../../src/scrivener/project.js', async importOriginal => ({
  ...(await importOriginal()),
  writeProject: (...args) => writeProject(...args),
}))

const toastAdd = vi.fn()
vi.mock('primevue/usetoast', () => ({ useToast: () => ({ add: toastAdd }) }))

const downloadProject = vi.fn()
vi.mock('../../src/composables/useBackup', () => ({ useBackup: () => ({ downloadProject }) }))

const ProjectMenu = {
  name: 'ProjectMenu',
  props: ['storyId', 'projectItems'],
  template: '<div data-project-menu :data-story="storyId" />',
}

const mountTree = () =>
  mount(DocumentTree, {
    props: { storyId: 'story_1' },
    global: {
      plugins: [PrimeVue, ConfirmationService, ToastService],
      directives: { tooltip: Tooltip },
      stubs: { ProjectMenu },
    },
  })

/** A file as a folder chooser hands it over. */
const chosen = path => {
  const file = new File(['x'], path.split('/').pop(), { type: 'text/markdown' })
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file
}

/** A binder with nothing in it but its Draft folder. */
const BINDER =
  '<ScrivenerProject><Binder><BinderItem UUID="D" Type="DraftFolder"><Title>Draft</Title></BinderItem></Binder></ScrivenerProject>'

/**
 * A file with something in it, as a folder chooser hands it over.
 * @param {string} path
 * @param {string} text
 */
const chosenWith = (path, text) => {
  const file = new File([text], path.split('/').pop())
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
    confirmed.answer = 'accept'
    confirmed.asked = []
    api = useDocuments('story_1')
    await api.init()
  })

  describe('a character card chosen with roleplay off', () => {
    const CARD = { spec: 'chara_card_v2', data: { name: 'Elara', first_mes: 'Well?' } }
    const cardFile = () =>
      new File([JSON.stringify(CARD)], 'elara.json', { type: 'application/json' })

    afterEach(() => useApplicationState().resetState())

    it('asks first, and imports it as a file when told to', async () => {
      confirmed.answer = 'reject'
      const wrapper = mountTree()
      wrapper.findComponent({ name: 'DocumentNode' }).vm.$emit('import', api.root.value.id)

      await choose(wrapper.find('input[multiple]'), [cardFile()])

      expect(confirmed.asked.map(asked => asked.message)).toEqual([
        'elara.json is a character card. Turn on Roleplay to import it as one, or import it as a file.',
      ])
      expect(api.childrenOf(api.root.value.id).map(child => [child.title, child.type])).toEqual([
        ['elara.json', 'file'],
      ])
      expect(useApplicationState().roleplay.value).toBe(false)
    })

    it("switches roleplay on and asks the card's questions when told to", async () => {
      const wrapper = mountTree()
      wrapper.findComponent({ name: 'DocumentNode' }).vm.$emit('import', api.root.value.id)

      await choose(wrapper.find('input[multiple]'), [cardFile()])

      expect(useApplicationState().roleplay.value).toBe(true)
      const dialog = wrapper.findComponent({ name: 'CardImportDialog' })
      expect(dialog.props('visible')).toBe(true)
      expect(dialog.props('found')).toMatchObject({ shape: 'card', title: 'Elara' })
    })

    it('asks nothing with the AI off, and imports it as a file', async () => {
      useApplicationState().setAiEnabled(false)
      const wrapper = mountTree()
      wrapper.findComponent({ name: 'DocumentNode' }).vm.$emit('import', api.root.value.id)

      await choose(wrapper.find('input[multiple]'), [cardFile()])

      expect(confirmed.asked).toEqual([])
      expect(api.childrenOf(api.root.value.id).map(child => child.type)).toEqual(['file'])
    })
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
      expect.objectContaining({ detail: 'Imported 2 documents, 1 new folder.' })
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
    // Writing is not asked about.
    expect(confirmed.asked).toEqual([])
  })

  /** A codebase as the folder chooser hands it over. */
  const codebase = () => [
    chosen('app/src/foo.cpp'),
    chosen('app/src/foo.h'),
    chosen('app/Makefile'),
    chosen('app/.gitignore'),
  ]

  it('asks about a folder of code, and imports it as files when told to', async () => {
    confirmed.answer = 'reject'
    const wrapper = mountTree()
    wrapper.findComponent({ name: 'DocumentNode' }).vm.$emit('import-folder', api.root.value.id)

    await choose(wrapper.find('input[webkitdirectory]'), codebase())

    expect(confirmed.asked).toHaveLength(1)
    expect(confirmed.asked[0]).toMatchObject({
      header: 'Import as a repository?',
      message: 'app looks like a codebase.',
    })
    expect(importFolder).not.toHaveBeenCalled()
    const [gathered] = importMany.mock.calls[0]
    expect(gathered.map(g => g.file.name)).toEqual(['foo.cpp', 'foo.h', 'Makefile'])
  })

  it('hands a folder of code to the repository import, dotfiles and all', async () => {
    const wrapper = mountTree()
    wrapper.findComponent({ name: 'DocumentNode' }).vm.$emit('import-folder', api.root.value.id)

    await choose(wrapper.find('input[webkitdirectory]'), codebase())

    expect(importMany).not.toHaveBeenCalled()
    expect(importFolder).toHaveBeenCalledTimes(1)
    const [listed, options] = importFolder.mock.calls[0]
    expect(listed.map(g => g.file.name)).toContain('.gitignore')
    expect(options.parentId).toBe(api.root.value.id)
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'app imported: 3 files.' })
    )
  })

  it('asks the same of a folder of code dropped on the tree', async () => {
    const wrapper = mountTree()
    const notes = api.createFolder(api.root.value.id, 'Notes')
    await wrapper.vm.$nextTick()
    const entry = name => ({
      isFile: true,
      isDirectory: false,
      name,
      file: resolve => resolve(new File(['x'], name)),
    })
    const folder = {
      isFile: false,
      isDirectory: true,
      name: 'app',
      createReader: () => {
        const batches = [[entry('a.go'), entry('b.go'), entry('go.mod'), entry('main.go')], []]
        return { readEntries: resolve => resolve(batches.shift() || []) }
      },
    }
    const dataTransfer = {
      types: ['Files'],
      items: [{ kind: 'file', webkitGetAsEntry: () => folder }],
      files: [],
      dropEffect: '',
    }

    await wrapper.find(`[data-document-id="${notes.id}"]`).trigger('drop', { dataTransfer })
    await flushPromises()

    expect(confirmed.asked).toHaveLength(1)
    expect(importFolder.mock.calls[0][1].parentId).toBe(notes.id)
  })

  it('imports a Scrivener project chosen as a folder into a folder of its own, asking nothing', async () => {
    const wrapper = mountTree()
    wrapper.findComponent({ name: 'DocumentNode' }).vm.$emit('import-folder', api.root.value.id)

    await choose(wrapper.find('input[webkitdirectory]'), [
      chosenWith('Harbour.scriv/Harbour.scrivx', BINDER),
      chosenWith('Harbour.scriv/Files/version.txt', '23'),
    ])

    expect(importMany).not.toHaveBeenCalled()
    expect(confirmed.asked).toEqual([])
    expect(writeProject).toHaveBeenCalledWith(
      'story_1',
      expect.objectContaining({ name: 'Harbour' }),
      { parentId: api.root.value.id, asFolder: true }
    )
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ detail: 'Imported 5 documents, 2 new folders.' })
    )
  })

  it('imports a zipped Scrivener project chosen on its own', async () => {
    const { strToU8, zipSync } = await import('fflate')
    const wrapper = mountTree()
    const notes = api.createFolder(api.root.value.id, 'Notes')
    await wrapper.vm.$nextTick()
    wrapper.findComponent({ name: 'DocumentNode' }).vm.$emit('import', notes.id)
    const zip = new File(
      [zipSync({ 'Harbour.scriv/Harbour.scrivx': strToU8(BINDER) })],
      'Harbour.zip'
    )

    await choose(wrapper.find('input[multiple]'), [zip])

    expect(writeProject).toHaveBeenCalledWith(
      'story_1',
      expect.objectContaining({ name: 'Harbour' }),
      { parentId: notes.id, asFolder: true }
    )
  })

  it('says why a Scrivener project cannot be imported, and writes nothing', async () => {
    const wrapper = mountTree()
    wrapper.findComponent({ name: 'DocumentNode' }).vm.$emit('import-folder', api.root.value.id)

    await choose(wrapper.find('input[webkitdirectory]'), [
      chosenWith('Old.scriv/Old.scrivx', BINDER),
      chosenWith('Old.scriv/Files/Docs/3.rtf', '{\\rtf1 x}'),
    ])

    expect(writeProject).not.toHaveBeenCalled()
    expect(importMany).not.toHaveBeenCalled()
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'error',
        detail:
          'Nothing imported: This project is from an older Scrivener. Open it in Scrivener 3, then import it again.',
      })
    )
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

describe('DocumentTree header', () => {
  /** @type {ReturnType<typeof useDocuments>} */
  let api

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    clearChatsInstances()
    vi.clearAllMocks()
    confirmed.answer = 'accept'
    confirmed.asked = []
    api = useDocuments('story_1')
    await api.init()
  })

  /** What the header's Import offers. */
  const importOffered = wrapper =>
    wrapper.findComponent({ name: 'PanelHeader' }).findComponent(Menu).props('model')

  it("offers at Import what the project's own Import offers", async () => {
    const wrapper = mountTree()
    await flushPromises()

    const own = wrapper
      .findComponent({ name: 'DocumentNode' })
      .findComponent(ContextMenu)
      .props('model')
      .find(item => item.label === 'Import')
    expect(importOffered(wrapper).map(item => item.label)).toEqual(
      own.items.map(item => item.label)
    )
  })

  it('imports files chosen from the header into the top of the project', async () => {
    const wrapper = mountTree()
    await flushPromises()
    const input = wrapper.find('input[multiple]')
    const click = vi.spyOn(input.element, 'click')

    importOffered(wrapper)
      .find(item => item.label === 'Files…')
      .command()
    expect(click).toHaveBeenCalled()
    await choose(input, [chosen('a.md'), chosen('b.md')])

    expect(importMany.mock.calls[0][1].parentId).toBe(api.root.value.id)
  })

  it('starts a document at the top of the project, open and waiting for its name', async () => {
    const wrapper = mountTree()
    await flushPromises()

    await wrapper.find('[data-action="new-document"]').trigger('click')
    await flushPromises()

    const [created] = api.childrenOf(api.root.value.id)
    expect(created.type).toBe('text')
    expect(api.activeDocumentId.value).toBe(created.id)
    expect(wrapper.find(`[data-document-id="${created.id}"] input`).exists()).toBe(true)
  })
})

describe('DocumentTree project menu', () => {
  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    clearChatsInstances()
    vi.clearAllMocks()
    await useDocuments('story_1').init()
  })

  /** The root's menu, which is also what a right-click on the space below it opens. */
  const projectCommand = (wrapper, label) =>
    wrapper
      .findComponent({ name: 'DocumentNode' })
      .props('extraMenuItems')
      .find(item => item.label === label)
      .command()

  it('offers the project settings, an export, and a delete, in that order', async () => {
    const wrapper = mountTree()
    await flushPromises()

    const labels = wrapper
      .findComponent({ name: 'DocumentNode' })
      .props('extraMenuItems')
      .map(item => item.label)
    expect(labels).toEqual(['Project settings', 'Export project', 'Delete project'])
  })

  it('has the projects menu at the start of the header, for the project open, before the Outline title', () => {
    const wrapper = mountTree()
    const header = wrapper.findComponent({ name: 'PanelHeader' })
    expect(header.props('title')).toBe('Outline')
    expect(header.find('h2').text()).toBe('Outline')
    const menu = header.find('[data-project-menu]')
    expect(menu.attributes('data-story')).toBe('story_1')
    expect(menu.element.nextElementSibling?.textContent?.trim()).toBe('Outline')
  })

  it('offers the same under Projects in the header', async () => {
    const wrapper = mountTree()
    await flushPromises()

    const own = wrapper.findComponent({ name: 'DocumentNode' }).props('extraMenuItems')
    expect(wrapper.findComponent(ProjectMenu).props('projectItems')).toBe(own)
  })

  it('deletes the project with its jobs, and leaves it', async () => {
    const wrapper = mountTree()
    await flushPromises()

    await projectCommand(wrapper, 'Delete project')
    await flushPromises()

    expect(dropJobsForStory).toHaveBeenCalledWith('story_1')
    expect(deleteStory).toHaveBeenCalledWith('story_1')
    expect(push).toHaveBeenCalledWith('/')
  })

  it('exports the project, and says where it went', async () => {
    downloadProject.mockResolvedValue({ filename: 'inksprite-project-my-novel.json', bytes: 1 })
    const wrapper = mountTree()
    await flushPromises()

    await projectCommand(wrapper, 'Export project')
    await flushPromises()

    expect(downloadProject).toHaveBeenCalledWith('story_1')
    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({
        severity: 'success',
        detail: 'Saved inksprite-project-my-novel.json',
      })
    )
  })

  it('says why an export failed', async () => {
    downloadProject.mockRejectedValue(new Error('Quota exceeded'))
    const wrapper = mountTree()
    await flushPromises()

    await projectCommand(wrapper, 'Export project')
    await flushPromises()

    expect(toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ severity: 'error', detail: 'Export failed: Quota exceeded' })
    )
  })
})
