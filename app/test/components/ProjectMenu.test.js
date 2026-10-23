import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import PrimeVue from 'primevue/config'
import TieredMenu from 'primevue/tieredmenu'
import ProjectMenu from '@/components/writer/projects/ProjectMenu.vue'
import NewProjectDialog from '@/components/writer/projects/NewProjectDialog.vue'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useStoriesStore } from '@/stores/storiesStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

// What the database holds of each project's documents and chats, by story id,
// for working out when a project was last edited.
const { rows } = vi.hoisted(() => ({ rows: { documents: {}, chats: {} } }))

vi.mock('@/stores/db', () => {
  const byStory = table => ({
    where: vi.fn(() => ({
      equals: vi.fn(storyId => {
        const found = rows[table]?.[storyId] || []
        return {
          toArray: vi.fn(async () => found),
          each: vi.fn(async callback => found.forEach(callback)),
        }
      }),
    })),
  })
  return {
    default: {
      stories: { toArray: vi.fn(async () => []) },
      documents: {
        ...byStory('documents'),
        bulkGet: vi.fn(async () => []),
        get: vi.fn(async () => undefined),
      },
      chats: byStory('chats'),
      messages: byStory('messages'),
    },
  }
})

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const { backup, toast } = vi.hoisted(() => ({
  backup: {
    readProjectFile: vi.fn(),
    importProject: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/composables/useBackup', () => ({ useBackup: () => backup }))
vi.mock('@/composables/useToast', () => ({ useToast: () => toast }))

// The app's other windows: which projects they have open, and the one asked
// to show a project or opened beside this one.
const windows = vi.hoisted(() => ({
  elsewhere: new Set(),
  askForProject: vi.fn(),
  openWindow: vi.fn(),
}))
vi.mock('@/platform/windows.js', async importOriginal => ({
  ...(await importOriginal()),
  projectsElsewhere: async () => new Set(windows.elsewhere),
  askForProject: windows.askForProject,
  openWindow: windows.openWindow,
}))
const platform = vi.hoisted(() => ({ desktop: false }))
vi.mock('@/platform/desktop.js', async importOriginal => ({
  ...(await importOriginal()),
  isDesktop: () => platform.desktop,
}))

describe('ProjectMenu', () => {
  /** @type {ReturnType<typeof useStoriesStore>} */
  let storiesStore
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let documentsStore
  let router

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    rows.documents = {}
    rows.chats = {}
    windows.elsewhere.clear()
    platform.desktop = false
    storiesStore = useStoriesStore()
    documentsStore = useDocumentsStore()
    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/project/:storyId', component: { template: '<div />' } },
      ],
    })
  })

  const mountMenu = async (storyId, projectItems) => {
    const wrapper = mount(ProjectMenu, {
      props: { storyId, ...(projectItems && { projectItems }) },
      global: {
        plugins: [router, PrimeVue],
        directives: { tooltip: {} },
        stubs: { NewProjectDialog: true },
      },
    })
    await flushPromises()
    return { wrapper, push: vi.spyOn(router, 'push') }
  }

  /** What the menu offers, in order. */
  const items = wrapper => wrapper.findComponent(TieredMenu).props('model')

  /** The projects, under Switch project. */
  const listed = wrapper => items(wrapper).find(item => item.label === 'Switch project').items

  const titles = wrapper => listed(wrapper).map(item => item.label)

  /** Choose something in the menu, or a project under Switch project. */
  const pick = (wrapper, label) =>
    [...items(wrapper), ...listed(wrapper)].find(item => item.label === label).command()

  const shape = wrapper => items(wrapper).map(item => (item.separator ? '—' : item.label))

  it('is one button, for a menu with the projects beside it, then a new one or an import', async () => {
    await storiesStore.createStory('Mine')

    const { wrapper } = await mountMenu('')
    expect(wrapper.findAll('button').map(button => button.attributes('aria-label'))).toEqual([
      'Projects',
    ])
    expect(shape(wrapper)).toEqual(['Switch project', 'New project…', 'Import project…'])
    expect(titles(wrapper)).toEqual(['Mine'])
  })

  it('ends with what can be done to the project open, as it is given', async () => {
    const story = await storiesStore.createStory('Mine')
    const settings = vi.fn()
    const projectItems = [
      { label: 'Project settings', icon: 'pi pi-cog', command: settings },
      { label: 'Delete project', icon: 'pi pi-trash', command: vi.fn() },
    ]

    const { wrapper } = await mountMenu(story.id, projectItems)
    expect(shape(wrapper)).toEqual([
      'Switch project',
      'New project…',
      'Import project…',
      '—',
      'Project settings',
      'Delete project',
    ])
    pick(wrapper, 'Project settings')
    expect(settings).toHaveBeenCalled()
  })

  it('lists projects by name, numbers as numbers and case aside, named from their roots', async () => {
    for (const title of ['Zebra', 'Draft 10', 'apple', 'Draft 2']) {
      await storiesStore.createStory(title)
    }

    const { wrapper } = await mountMenu('')
    expect(titles(wrapper)).toEqual(['apple', 'Draft 2', 'Draft 10', 'Zebra'])
  })

  it('keeps a project where it is when it is worked on', async () => {
    const first = await storiesStore.createStory('First')
    const second = await storiesStore.createStory('Second')
    storiesStore.stories.get(second.id).updated = first.updated + 1000

    const { wrapper } = await mountMenu(first.id)
    expect(titles(wrapper)).toEqual(['First', 'Second'])
  })

  it('marks the project open', async () => {
    const story = await storiesStore.createStory('Mine')
    await storiesStore.createStory('Other')

    const { wrapper } = await mountMenu(story.id)
    expect(listed(wrapper).map(item => item.open)).toEqual([true, false])
  })

  it('switches to another project, and stays on the one open', async () => {
    const mine = await storiesStore.createStory('Mine')
    const other = await storiesStore.createStory('Other')
    const { wrapper, push } = await mountMenu(mine.id)

    pick(wrapper, 'Mine')
    await flushPromises()
    expect(push).not.toHaveBeenCalled()

    pick(wrapper, 'Other')
    await flushPromises()
    expect(push).toHaveBeenCalledWith(`/project/${other.id}`)
  })

  it('says which projects are open in another window, once it is opened', async () => {
    const mine = await storiesStore.createStory('Mine')
    const other = await storiesStore.createStory('Other')
    windows.elsewhere.add(other.id)
    platform.desktop = true
    const { wrapper } = await mountMenu(mine.id)

    await wrapper.find('button').trigger('click')
    await flushPromises()
    const [, there] = listed(wrapper)
    expect(there.detail).toBe('Open in another window')
    expect(there.icon).toBe('pi pi-clone')
  })

  it('shows a project open in another window there, rather than here', async () => {
    const mine = await storiesStore.createStory('Mine')
    const other = await storiesStore.createStory('Other')
    windows.elsewhere.add(other.id)
    platform.desktop = true
    const { wrapper, push } = await mountMenu(mine.id)

    pick(wrapper, 'Other')
    await flushPromises()
    expect(push).not.toHaveBeenCalled()
    expect(windows.askForProject).toHaveBeenCalledWith(other.id)
  })

  it('opens a project in a new window when picked with Command or Ctrl held', async () => {
    const mine = await storiesStore.createStory('Mine')
    const other = await storiesStore.createStory('Other')
    const { wrapper, push } = await mountMenu(mine.id)

    const item = listed(wrapper).find(item => item.label === 'Other')
    item.command({ originalEvent: new window.MouseEvent('click', { metaKey: true }) })
    await flushPromises()
    expect(windows.openWindow).toHaveBeenCalledWith(`/project/${other.id}`)
    expect(push).not.toHaveBeenCalled()
  })

  it('offers a new window in the desktop app', async () => {
    const mine = await storiesStore.createStory('Mine')
    platform.desktop = true
    const { wrapper } = await mountMenu(mine.id)

    expect(shape(wrapper)).toEqual([
      'Switch project',
      'New project…',
      'Import project…',
      'New window',
    ])
    pick(wrapper, 'New window')
    await flushPromises()
    expect(windows.openWindow).toHaveBeenCalledWith()
  })

  it('says when each project was last edited, as its root keeps it', async () => {
    const story = await storiesStore.createStory('Mine')
    const root = documentsStore.getRoot(story.id)
    documentsStore.documents.set(root.id, { ...root, edited: Date.now() - 3 * 3600000 })

    const { wrapper } = await mountMenu(story.id)
    expect(listed(wrapper)[0].detail).toBe('3h ago')
  })

  it('works out when an older project was last edited, from its documents and chats, once', async () => {
    const story = await storiesStore.createStory('Older')
    const root = documentsStore.getRoot(story.id)
    const { edited, ...unmarked } = root
    expect(edited).toBeTypeOf('number')
    documentsStore.documents.set(root.id, unmarked)
    const now = Date.now()
    rows.documents[story.id] = [
      { id: root.id, updated: now - 9 * 86400000 },
      { id: 'doc_a', updated: now - 5 * 86400000 },
    ]
    rows.chats[story.id] = [{ id: 'chat_a', updated: now - 2 * 86400000 }]

    const { wrapper } = await mountMenu(story.id)

    expect(documentsStore.getRoot(story.id).edited).toBe(now - 2 * 86400000)
    expect(listed(wrapper)[0].detail).toBe('2d ago')

    // Kept: a second list reads nothing.
    const { default: db } = await import('@/stores/db')
    db.documents.where.mockClear()
    await mountMenu(story.id)
    expect(db.documents.where).not.toHaveBeenCalled()
  })

  it('starts a project empty, named on its root, and opens it', async () => {
    const { wrapper, push } = await mountMenu('')

    const dialog = wrapper.findComponent(NewProjectDialog)
    expect(dialog.props('visible')).toBe(false)
    pick(wrapper, 'New project…')
    await flushPromises()
    expect(dialog.props('visible')).toBe(true)

    dialog.vm.$emit('create', { title: 'My Novel' })
    await flushPromises()

    const storyId = [...storiesStore.stories.keys()][0]
    expect(documentsStore.getRoot(storyId).title).toBe('My Novel')
    expect(documentsStore.getChildren(rootIdFor(storyId))).toEqual([])
    expect(push).toHaveBeenCalledWith(`/project/${storyId}`)
  })

  /**
   * Pick a file in the menu's hidden input.
   * @param {import('@vue/test-utils').VueWrapper} wrapper
   * @param {File} file
   */
  const pickFile = async (wrapper, file) => {
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
  }

  it('asks for a file to import', async () => {
    const { wrapper } = await mountMenu('')
    const click = vi.spyOn(wrapper.find('input[type="file"]').element, 'click')

    pick(wrapper, 'Import project…')
    expect(click).toHaveBeenCalled()
  })

  it('imports a project file and opens it', async () => {
    const file = new window.File(['{}'], 'inksprite-project-draft.json')
    const rows = {
      story: { id: 'story_from_file' },
      documents: [{ id: 'root_story_from_file', title: 'Imported' }],
    }
    backup.readProjectFile.mockResolvedValue(rows)
    backup.importProject.mockImplementation(() => storiesStore.createStory('Imported'))
    const { wrapper, push } = await mountMenu('')

    await pickFile(wrapper, file)

    expect(backup.readProjectFile).toHaveBeenCalledWith(file)
    expect(backup.importProject).toHaveBeenCalledWith(rows, { title: 'Imported' })
    const storyId = [...storiesStore.stories.keys()][0]
    expect(toast.success).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledWith(`/project/${storyId}`)
  })

  it('spins while a project file is read', async () => {
    let finish
    backup.readProjectFile.mockReturnValue(new Promise(resolve => (finish = resolve)))
    backup.importProject.mockImplementation(() => storiesStore.createStory('Imported'))
    const { wrapper } = await mountMenu('')
    const button = wrapper.find('[data-action="projects"]')

    await pickFile(wrapper, new window.File(['{}'], 'inksprite-project-draft.json'))
    expect(button.find('i').classes()).toContain('pi-spinner')

    finish({ story: { id: 'story_from_file' }, documents: [] })
    await flushPromises()
    expect(button.find('i').classes()).toContain('pi-bars')
  })

  it('says why a file could not be imported, and opens nothing', async () => {
    backup.readProjectFile.mockRejectedValue(
      new Error('This file holds one chat, not one project.')
    )
    const { wrapper, push } = await mountMenu('')

    await pickFile(wrapper, new window.File(['{}'], 'chat.json'))

    expect(backup.importProject).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('This file holds one chat, not one project.')
    expect(push).not.toHaveBeenCalled()
  })
})
