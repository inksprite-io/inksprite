import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import PrimeVue from 'primevue/config'
import TieredMenu from 'primevue/tieredmenu'
import ProjectMenu from '@/components/writer/projects/ProjectMenu.vue'
import NewProjectDialog from '@/components/writer/projects/NewProjectDialog.vue'
import ProjectsDialog from '@/components/writer/projects/ProjectsDialog.vue'
import { LONG_PRESS_MS } from '@/composables/useLongPress.js'
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
// What a project's menu offers, which has tests of its own.
const actions = vi.hoisted(() => ({
  itemsFor: vi.fn(storyId => [{ label: `Actions on ${storyId}` }]),
}))
vi.mock('@/composables/useProjectActions.js', () => ({ useProjectActions: () => actions }))
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
        stubs: { NewProjectDialog: true, ProjectsDialog: true },
      },
    })
    await flushPromises()
    return { wrapper, push: vi.spyOn(router, 'push') }
  }

  /** What the menu offers, in order. */
  const items = wrapper => wrapper.findComponent(TieredMenu).props('model')

  /** The projects, under Recent projects. */
  const listed = wrapper => items(wrapper).find(item => item.label === 'Recent projects').items

  const titles = wrapper => listed(wrapper).map(item => item.label)

  /** Choose something in the menu, or a project under Recent projects. */
  const pick = (wrapper, label) =>
    [...items(wrapper), ...listed(wrapper)].find(item => item.label === label).command()

  const shape = wrapper => items(wrapper).map(item => (item.separator ? '—' : item.label))

  it('is one button, for a menu with the projects beside it, then a new one or an import', async () => {
    await storiesStore.createStory('Mine')

    const { wrapper } = await mountMenu('')
    expect(wrapper.findAll('button').map(button => button.attributes('aria-label'))).toEqual([
      'Projects',
    ])
    expect(shape(wrapper)).toEqual([
      'Recent projects',
      'Switch project…',
      'New project…',
      'Import project…',
    ])
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
      'Recent projects',
      'Switch project…',
      'New project…',
      'Import project…',
      '—',
      'Project settings',
      'Delete project',
    ])
    pick(wrapper, 'Project settings')
    expect(settings).toHaveBeenCalled()
  })

  /** Say a project was last edited so long ago. */
  const editedAgo = (story, ms) => {
    const root = documentsStore.getRoot(story.id)
    documentsStore.documents.set(root.id, { ...root, edited: Date.now() - ms })
  }

  it('lists the projects edited most recently, the latest first, named from their roots', async () => {
    const stories = {}
    for (const title of ['Zebra', 'Draft 10', 'apple']) {
      stories[title] = await storiesStore.createStory(title)
    }
    editedAgo(stories.Zebra, 2 * 3600000)
    editedAgo(stories['Draft 10'], 3 * 3600000)
    editedAgo(stories.apple, 3600000)

    const { wrapper } = await mountMenu('')
    expect(titles(wrapper)).toEqual(['apple', 'Zebra', 'Draft 10'])
  })

  it('lists only the most recent of many, and all of them in the table', async () => {
    for (let at = 0; at < 12; at++) {
      const story = await storiesStore.createStory(`Project ${at}`)
      editedAgo(story, (at + 1) * 3600000)
    }

    const { wrapper } = await mountMenu('')
    expect(titles(wrapper)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map(at => `Project ${at}`))

    const table = wrapper.findComponent(ProjectsDialog)
    expect(table.props('visible')).toBe(false)
    pick(wrapper, 'Switch project…')
    await flushPromises()
    expect(table.props('visible')).toBe(true)
  })

  it('marks the project open', async () => {
    const story = await storiesStore.createStory('Mine')
    await storiesStore.createStory('Other')

    const { wrapper } = await mountMenu(story.id)
    expect(listed(wrapper).find(item => item.open).label).toBe('Mine')
    expect(listed(wrapper).find(item => !item.open).label).toBe('Other')
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
    const there = listed(wrapper).find(item => item.label === 'Other')
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
      'Recent projects',
      'Switch project…',
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

  describe('a project’s own menu', () => {
    const show = vi.fn()
    const hide = vi.fn()

    /** The menu with its projects drawn in one list, as they are once it is open. */
    const mountDrawn = async (storyId, projectItems) => {
      const wrapper = mount(ProjectMenu, {
        props: { storyId, ...(projectItems && { projectItems }) },
        global: {
          plugins: [router, PrimeVue],
          directives: { tooltip: {} },
          stubs: {
            NewProjectDialog: true,
            ProjectsDialog: true,
            ContextMenu: {
              name: 'ContextMenu',
              props: ['model'],
              methods: { show, hide },
              template: '<div />',
            },
            TieredMenu: {
              name: 'TieredMenu',
              props: ['model'],
              data: () => ({ visible: false, menubar: null }),
              methods: { toggle() {} },
              computed: {
                drawn() {
                  return this.model.flatMap(item => (item.items ? [item, ...item.items] : [item]))
                },
              },
              template: `<ul><li v-for="item in drawn" :key="item.label"><slot
                name="item" :item="item" :has-submenu="false" :props="{ action: {}, submenuicon: {} }"
              /></li></ul>`,
            },
          },
        },
      })
      await flushPromises()
      return wrapper
    }

    const row = (wrapper, label) => wrapper.findAll('a').find(link => link.text().startsWith(label))
    const offered = wrapper => wrapper.findComponent({ name: 'ContextMenu' }).props('model')

    beforeEach(() => {
      show.mockClear()
      hide.mockClear()
    })

    it('offers the outline’s items on the project open', async () => {
      const mine = await storiesStore.createStory('Mine')
      const own = [{ label: 'Trash' }]
      const wrapper = await mountDrawn(mine.id, own)

      await row(wrapper, 'Mine').trigger('contextmenu')

      expect(show).toHaveBeenCalledTimes(1)
      expect(offered(wrapper)).toEqual(own)
      expect(actions.itemsFor).not.toHaveBeenCalled()
    })

    it('offers the same on another project, for that project', async () => {
      const mine = await storiesStore.createStory('Mine')
      const other = await storiesStore.createStory('Other')
      const wrapper = await mountDrawn(mine.id)

      await row(wrapper, 'Other').trigger('contextmenu')

      expect(actions.itemsFor).toHaveBeenCalledWith(other.id)
      expect(offered(wrapper)).toEqual([{ label: `Actions on ${other.id}` }])
    })

    it('offers nothing on what isn’t a project', async () => {
      const wrapper = await mountDrawn('')

      await row(wrapper, 'New project…').trigger('contextmenu')

      expect(show).not.toHaveBeenCalled()
    })

    it('offers it for a project right-clicked in the table', async () => {
      const wrapper = await mountDrawn('')
      const event = { pageX: 1, pageY: 2 }

      wrapper.findComponent(ProjectsDialog).vm.$emit('project-menu', event, 'story_x')
      await flushPromises()

      expect(actions.itemsFor).toHaveBeenCalledWith('story_x')
      expect(show).toHaveBeenCalledWith(event)
    })

    it('gives the focus back to the menu when a project’s menu shuts', async () => {
      const wrapper = await mountDrawn('')
      const list = document.createElement('ul')
      list.tabIndex = 0
      document.body.append(list)
      const tiered = wrapper.findComponent({ name: 'TieredMenu' }).vm
      tiered.menubar = list

      wrapper.findComponent({ name: 'ContextMenu' }).vm.$emit('hide')
      expect(document.activeElement).not.toBe(list)

      tiered.visible = true
      wrapper.findComponent({ name: 'ContextMenu' }).vm.$emit('hide')
      expect(document.activeElement).toBe(list)
      list.remove()
    })

    it('gives the focus back to the table when it opened from there', async () => {
      const focusSearch = vi.fn()
      const wrapper = await mountDrawn('')
      wrapper.findComponent(ProjectsDialog).vm.focusSearch = focusSearch
      await wrapper.findComponent(ProjectsDialog).vm.$emit('update:visible', true)

      wrapper.findComponent({ name: 'ContextMenu' }).vm.$emit('hide')

      expect(focusSearch).toHaveBeenCalledTimes(1)
    })

    it('opens under a finger held on a project, where the finger is', async () => {
      const other = await storiesStore.createStory('Other')
      const wrapper = await mountDrawn('')
      vi.useFakeTimers()
      try {
        await row(wrapper, 'Other').trigger('touchstart', {
          touches: [{ clientX: 30, clientY: 40 }],
        })
        expect(show).not.toHaveBeenCalled()

        vi.advanceTimersByTime(LONG_PRESS_MS)

        expect(actions.itemsFor).toHaveBeenCalledWith(other.id)
        expect(show.mock.calls[0][0]).toMatchObject({ pageX: 30, pageY: 40 })
      } finally {
        vi.useRealTimers()
      }
    })

    it('leaves a finger held on what isn’t a project alone', async () => {
      const wrapper = await mountDrawn('')
      vi.useFakeTimers()
      try {
        await row(wrapper, 'New project…').trigger('touchstart', {
          touches: [{ clientX: 30, clientY: 40 }],
        })
        vi.advanceTimersByTime(LONG_PRESS_MS)
        expect(show).not.toHaveBeenCalled()
      } finally {
        vi.useRealTimers()
      }
    })
  })
})
