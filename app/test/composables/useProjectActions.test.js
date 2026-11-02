import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useProjectActions } from '@/composables/useProjectActions.js'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'

const { push, confirmed, projects, cloud, toast, exported, windows, stores, saveNow, people } =
  vi.hoisted(() => ({
    push: vi.fn(),
    confirmed: { asked: /** @type {any[]} */ ([]) },
    projects: {
      elsewhere: { value: new Set() },
      trash: vi.fn(async () => {}),
      nameOf: (/** @type {string} */ id) => `Name of ${id}`,
    },
    cloud: {
      account: { value: /** @type {any} */ (null) },
      keepOnThisDevice: vi.fn(async () => {}),
      syncProjectAgain: vi.fn(async () => {}),
      leaveProject: vi.fn(async () => {}),
    },
    toast: { error: vi.fn() },
    exported: { storyIds: /** @type {string[]} */ ([]), documentIds: /** @type {string[]} */ ([]) },
    windows: {
      taken: { held: true, stale: false, first: false },
      takeProject: vi.fn(),
      letGoOfProject: vi.fn(),
      askForProject: vi.fn(),
    },
    stores: {
      story: /** @type {any} */ ({ id: 'other' }),
      readAfresh: vi.fn(async () => {}),
      loadStory: vi.fn(async () => {}),
    },
    saveNow: vi.fn(async () => {}),
    people: { sharing: { value: { projects: /** @type {Record<string, any>} */ ({}) } } },
  }))

vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('primevue/useconfirm', () => ({
  useConfirm: () => ({
    require: (/** @type {any} */ options) => {
      confirmed.asked.push(options)
      return options.accept()
    },
  }),
}))
vi.mock('@/composables/useProjects', () => ({ useProjects: () => projects }))
vi.mock('@/composables/useProjects.js', () => ({ useProjects: () => projects }))
vi.mock('@/composables/useCloudSync.js', () => ({ useCloudSync: () => cloud }))
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))
vi.mock('@/composables/useSaveBeforeClosing.js', () => ({ saveNow }))
vi.mock('@/composables/useExport.js', () => ({
  useExport: (/** @type {string} */ storyId) => ({
    exportDocument: async (/** @type {string} */ documentId) => {
      exported.storyIds.push(storyId)
      exported.documentIds.push(documentId)
    },
  }),
}))
vi.mock('@/composables/useReveal.js', () => ({
  useReveal: () => ({
    revealItem: (/** @type {string} */ id) =>
      windows.desktop ? { label: 'Show in Finder', id, command: vi.fn() } : null,
  }),
}))
vi.mock('@/cloud/people.js', () => people)
vi.mock('@/platform/windows.js', () => windows)
vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: () => ({
    getStory: () => stores.story,
    readAfresh: stores.readAfresh,
  }),
}))
vi.mock('@/stores/documentsStore', () => ({
  useDocumentsStore: () => ({ loadStory: stores.loadStory }),
}))

describe('useProjectActions', () => {
  const panel = useSettingsPanel()

  beforeEach(() => {
    vi.clearAllMocks()
    panel.close()
    panel.takeSection()
    panel.takePart()
    panel.requestedProject.value = null
    confirmed.asked = []
    exported.storyIds = []
    exported.documentIds = []
    projects.elsewhere.value = new Set()
    projects.trash.mockImplementation(async () => {})
    cloud.account.value = null
    people.sharing.value.projects = {}
    stores.story = { id: 'other' }
    stores.loadStory.mockImplementation(async () => {})
    windows.desktop = false
    windows.taken = { held: true, stale: false, first: false }
    windows.takeProject.mockImplementation(async () => windows.taken)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const labels = (/** @type {any[]} */ items) => items.map(item => item.label)
  const run = (/** @type {any[]} */ items, /** @type {string} */ label) =>
    items.find(item => item.label === label).command()

  it('offers the settings, an export and a delete, with the folder in the desktop app', () => {
    const { itemsFor } = useProjectActions()
    expect(labels(itemsFor('other'))).toEqual([
      'Project settings',
      'Export project',
      'Delete project',
    ])

    windows.desktop = true
    expect(labels(itemsFor('other'))).toEqual([
      'Project settings',
      'Export project',
      'Show in Finder',
      'Delete project',
    ])
    expect(itemsFor('other')[2].id).toBe('root_other')
  })

  it('puts the caller’s items above the delete', () => {
    const { itemsFor } = useProjectActions()
    const trash = { label: 'Trash' }
    expect(labels(itemsFor('other', { current: true, beforeDelete: [trash] })).slice(-2)).toEqual([
      'Trash',
      'Delete project',
    ])
  })

  it('offers sharing and keeping here while signed in, and syncing again when kept here', () => {
    const { itemsFor } = useProjectActions()
    cloud.account.value = { name: 'writer' }
    expect(labels(itemsFor('other'))).toEqual([
      'Project settings',
      'Export project',
      'Share…',
      'Keep on this device only…',
      'Delete project',
    ])

    stores.story = { id: 'other', syncOff: 5 }
    expect(labels(itemsFor('other'))).toEqual([
      'Project settings',
      'Export project',
      'Sync this project',
      'Delete project',
    ])
  })

  it('offers leaving in place of deleting and keeping, for a project shared with this account', () => {
    const { itemsFor } = useProjectActions()
    cloud.account.value = { name: 'writer' }
    people.sharing.value.projects = { other: { role: 'member' } }
    expect(labels(itemsFor('other'))).toEqual([
      'Project settings',
      'Export project',
      'People…',
      'Leave project…',
    ])
  })

  it('offers only its folder for a project open in another window', () => {
    const { itemsFor } = useProjectActions()
    projects.elsewhere.value = new Set(['other'])
    expect(itemsFor('other')).toEqual([])

    windows.desktop = true
    expect(labels(itemsFor('other'))).toEqual(['Show in Finder'])
  })

  describe('on the project open', () => {
    it('exports it without taking it, or reading it again', async () => {
      const { itemsFor } = useProjectActions()
      await run(itemsFor('mine', { current: true }), 'Export project')

      expect(windows.takeProject).not.toHaveBeenCalled()
      expect(stores.loadStory).not.toHaveBeenCalled()
      expect(exported).toEqual({ storyIds: ['mine'], documentIds: ['root_mine'] })
    })

    it('opens the settings on the project open, and its sharing', () => {
      const { itemsFor } = useProjectActions()
      cloud.account.value = { name: 'writer' }

      run(itemsFor('mine', { current: true }), 'Share…')

      expect(panel.visible.value).toBe(true)
      expect(panel.takeSection()).toBe('project')
      expect(panel.takePart()).toBe('sharing')
      expect(panel.requestedProject.value).toBeNull()
    })

    it('leaves it for another once deleted', async () => {
      const { itemsFor } = useProjectActions()
      await run(itemsFor('mine', { current: true }), 'Delete project')

      expect(projects.trash).toHaveBeenCalledWith('mine')
      expect(push).toHaveBeenCalledWith('/')
    })

    it('leaves it for another once left', async () => {
      const { itemsFor } = useProjectActions()
      cloud.account.value = { name: 'writer' }
      people.sharing.value.projects = { mine: { role: 'member' } }

      await run(itemsFor('mine', { current: true }), 'Leave project…')
      await vi.waitFor(() => expect(push).toHaveBeenCalledWith('/'))
      expect(cloud.leaveProject).toHaveBeenCalledWith('mine')
    })
  })

  describe('on another project', () => {
    it('reads it holding it, then lets go, before exporting it', async () => {
      const { itemsFor } = useProjectActions()
      await run(itemsFor('other'), 'Export project')

      expect(windows.takeProject).toHaveBeenCalledWith('other', 'read')
      expect(stores.loadStory).toHaveBeenCalledWith('other')
      expect(windows.letGoOfProject).toHaveBeenCalledWith('other', 'read')
      expect(exported).toEqual({ storyIds: ['other'], documentIds: ['root_other'] })
      expect(push).not.toHaveBeenCalled()
    })

    it('reads its story again, the first time this window holds it', async () => {
      const { itemsFor } = useProjectActions()
      windows.taken = { held: true, stale: false, first: true }
      await run(itemsFor('other'), 'Export project')

      expect(stores.readAfresh).toHaveBeenCalledWith('other')
    })

    it('opens the settings on it, without opening it', async () => {
      const { itemsFor } = useProjectActions()
      await run(itemsFor('other'), 'Project settings')

      expect(stores.loadStory).toHaveBeenCalledWith('other')
      expect(panel.visible.value).toBe(true)
      expect(panel.takeSection()).toBe('project')
      expect(panel.requestedProject.value).toBe('other')
      expect(push).not.toHaveBeenCalled()
    })

    it('shows it where it is, having gone to another window since the menu opened', async () => {
      const { itemsFor } = useProjectActions()
      windows.taken = { held: false, stale: false, first: false }

      await run(itemsFor('other'), 'Export project')
      await run(itemsFor('other'), 'Project settings')

      expect(windows.askForProject).toHaveBeenCalledWith('other')
      expect(windows.letGoOfProject).not.toHaveBeenCalled()
      expect(stores.loadStory).not.toHaveBeenCalled()
      expect(exported.storyIds).toEqual([])
      expect(panel.visible.value).toBe(false)
    })

    it('reads the page again rather than use what another window has left behind', async () => {
      const reload = vi.fn()
      vi.stubGlobal('location', { reload })
      const { itemsFor } = useProjectActions()
      windows.taken = { held: true, stale: true, first: false }

      await run(itemsFor('other'), 'Export project')

      expect(saveNow).toHaveBeenCalled()
      expect(reload).toHaveBeenCalled()
      expect(stores.loadStory).not.toHaveBeenCalled()
      expect(exported.storyIds).toEqual([])
    })

    it('says so when it can’t be read, and lets go', async () => {
      const { itemsFor } = useProjectActions()
      stores.loadStory.mockRejectedValue(new Error('no disk'))
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await run(itemsFor('other'), 'Export project')

      expect(toast.error).toHaveBeenCalledWith("The project couldn't be read.")
      expect(windows.letGoOfProject).toHaveBeenCalledWith('other', 'read')
      expect(exported.storyIds).toEqual([])
      vi.restoreAllMocks()
    })

    it('moves it to the trash and stays where it is', async () => {
      const { itemsFor } = useProjectActions()
      await run(itemsFor('other'), 'Delete project')

      expect(projects.trash).toHaveBeenCalledWith('other')
      expect(push).not.toHaveBeenCalled()
    })

    it('says so when it can’t be moved to the trash', async () => {
      const { itemsFor } = useProjectActions()
      projects.trash.mockRejectedValue(new Error('no'))
      vi.spyOn(console, 'error').mockImplementation(() => {})

      await run(itemsFor('other'), 'Delete project')

      expect(toast.error).toHaveBeenCalledWith("The project couldn't be moved to the trash.")
      vi.restoreAllMocks()
    })

    it('names it when asking to keep it here, and keeps it', async () => {
      const { itemsFor } = useProjectActions()
      cloud.account.value = { name: 'writer' }

      await run(itemsFor('other'), 'Keep on this device only…')
      await vi.waitFor(() => expect(cloud.keepOnThisDevice).toHaveBeenCalledWith('other'))

      expect(confirmed.asked[0].message).toContain('Name of other')
    })

    it('leaves it without going anywhere', async () => {
      const { itemsFor } = useProjectActions()
      cloud.account.value = { name: 'writer' }
      people.sharing.value.projects = { other: { role: 'member' } }

      await run(itemsFor('other'), 'Leave project…')
      await vi.waitFor(() => expect(cloud.leaveProject).toHaveBeenCalledWith('other'))

      expect(confirmed.asked[0].message).toContain('Name of other')
      expect(push).not.toHaveBeenCalled()
    })

    it('syncs it again, and says why not when it can’t', async () => {
      const { itemsFor } = useProjectActions()
      cloud.account.value = { name: 'writer' }
      stores.story = { id: 'other', keptElsewhere: true }

      await run(itemsFor('other'), 'Sync this project')
      expect(cloud.syncProjectAgain).toHaveBeenCalledWith('other')

      cloud.syncProjectAgain.mockRejectedValue(new Error('Offline.'))
      await run(itemsFor('other'), 'Sync this project')
      expect(toast.error).toHaveBeenCalledWith('Offline.')
    })
  })
})
