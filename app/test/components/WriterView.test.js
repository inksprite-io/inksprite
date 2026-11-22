import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, shallowMount } from '@vue/test-utils'
import { reactive, ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'

// The writer's frame, with everything it lays out and everything it asks
// stood in for: what is tested is what the frame itself does for the desktop
// app's menu, the projects' table it holds and the chat it shows.

/** The one project there is, and where the writer left it. */
const view = reactive({ id: 'story_1', layout: undefined })
const updateView = vi.fn((_id, changes) => Object.assign(view, changes))
vi.mock('@/stores/projectViewsStore.js', () => ({
  useProjectViewsStore: () => ({
    ensureInitialized: async () => {},
    getView: id => (id === 'story_1' ? view : undefined),
    updateView,
    lastOpened: () => 'story_1',
  }),
}))

vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: () => ({
    ensureInitialized: async () => {},
    getStory: id => (id === 'story_1' ? { id, title: 'Thief' } : null),
    getAllStoriesOrdered: () => [{ id: 'story_1' }],
    stories: new Map([['story_1', {}]]),
    fresh: null,
    isFresh: () => false,
    dropFresh: vi.fn(),
    readAfresh: async () => {},
  }),
}))

vi.mock('@/stores/aiProvidersStore', () => ({ useAIProvidersStore: () => ({}) }))
vi.mock('@/ai/providers.js', async importOriginal => ({
  ...(await importOriginal()),
  signInOf: () => null,
}))
vi.mock('@/composables/useAIConfig', () => ({ useAIConfig: () => ({ init: async () => {} }) }))
vi.mock('@/composables/useChatPresets', () => ({
  stampEveryChat: async () => {},
  seedRecentModels: async () => {},
}))
vi.mock('@/composables/useToolChoices.js', () => ({
  giveToolChoices: async () => {},
  moveToolSwitches: async () => {},
}))
vi.mock('@/composables/useProjects', () => ({
  useProjects: () => ({ refresh: async () => {}, nameOf: () => 'Thief' }),
}))
vi.mock('@/composables/useLastOpened.js', () => ({ useLastOpened: vi.fn() }))
vi.mock('@/composables/useSaveBeforeClosing.js', () => ({ saveNow: async () => {} }))
vi.mock('@/platform/windows.js', () => ({
  askForProject: vi.fn(),
  bringWindowForward: vi.fn(),
  letGoOfProject: vi.fn(),
  onProjectAsked: () => () => {},
  projectsElsewhere: async () => new Set(),
  takeProject: async () => ({ held: true, stale: false, first: false }),
}))

const aiEnabled = ref(true)
vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => ({
    aiEnabled,
    showWelcomeDialog: ref(false),
    setShowWelcomeDialog: vi.fn(),
    checkAndShowWelcomeDialog: async () => {},
  }),
}))

const screen = { isMobile: ref(false), isNarrow: ref(false) }
vi.mock('@/composables/useScreenSize', () => ({ useScreenSize: () => screen }))

vi.mock('@/composables/useDocuments', () => ({
  useDocuments: () => ({
    init: async () => {},
    activeDocumentId: ref(''),
    tabs: ref({ open: [], active: null }),
    firstTextDocument: () => null,
    open: vi.fn(),
    releaseTabs: vi.fn(),
  }),
}))
vi.mock('@/composables/useChatTabs.js', () => ({
  useChatTabs: () => ({ activeChatId: ref(null), open: vi.fn() }),
}))
vi.mock('@/composables/useFocusMode.js', () => ({
  useFocusMode: () => ({ focused: ref(false) }),
  useFocusModeKeys: vi.fn(),
}))
vi.mock('@/composables/useProjectSearch.js', () => ({ useProjectSearchKey: vi.fn() }))
vi.mock('@/composables/usePrint.js', () => ({ usePrintKey: vi.fn() }))

/** What the frame gave the menu's commands to work with. */
let frame = null
vi.mock('@/composables/useMenuCommands.js', () => ({
  useMenuCommands: given => {
    frame = given
  },
}))

const { default: WriterView } = await import('@/components/writer/WriterView.vue')
const { default: ProjectsDialog } = await import('@/components/writer/projects/ProjectsDialog.vue')
const { useProjectsDialog } = await import('@/composables/useProjectsDialog.js')
const { DEFAULT_LAYOUT } = await import('@/components/writer/layout/layout.js')
const { useSidebarTab } = await import('@/composables/useSidebarTab.js')
const { default: MobileTopBar } = await import('@/components/writer/layout/MobileTopBar.vue')

describe('WriterView', () => {
  /** The frame, on its project. */
  const mountFrame = async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/project/:storyId', component: { template: '<div />' } },
      ],
    })
    await router.push('/project/story_1')
    const wrapper = shallowMount(WriterView, { global: { plugins: [router] } })
    await flushPromises()
    return wrapper
  }

  beforeEach(() => {
    vi.clearAllMocks()
    frame = null
    view.layout = undefined
    aiEnabled.value = true
    screen.isMobile.value = false
    screen.isNarrow.value = false
    useProjectsDialog().visible.value = false
  })

  it('holds the projects’ table, which opens from anywhere that asks', async () => {
    const wrapper = await mountFrame()
    const table = wrapper.findComponent(ProjectsDialog)
    expect(table.props()).toMatchObject({ visible: false, storyId: 'story_1' })

    useProjectsDialog().open()
    await flushPromises()
    expect(table.props('visible')).toBe(true)

    await table.vm.$emit('update:visible', false)
    expect(useProjectsDialog().visible.value).toBe(false)
  })

  it('tells the menu’s commands which project is open', async () => {
    await mountFrame()
    expect(frame.storyId()).toBe('story_1')
  })

  it('shows a hidden chat for the menu, and leaves a layout that has it showing alone', async () => {
    await mountFrame()
    frame.showChat()
    expect(updateView).not.toHaveBeenCalled()

    view.layout = { ...DEFAULT_LAYOUT, chat: false }
    await flushPromises()
    frame.showChat()
    expect(updateView).toHaveBeenLastCalledWith('story_1', {
      layout: { ...DEFAULT_LAYOUT, chat: true },
    })
  })

  it('closes the sidebar to show the chat in a narrow window, where it folds away', async () => {
    screen.isNarrow.value = true
    await mountFrame()

    frame.showChat()

    expect(updateView).toHaveBeenLastCalledWith('story_1', {
      layout: { ...DEFAULT_LAYOUT, sidebar: false },
    })
  })

  it('shows a hidden editor for the menu', async () => {
    view.layout = { ...DEFAULT_LAYOUT, editor: false }
    await mountFrame()

    frame.showEditor()

    expect(updateView).toHaveBeenLastCalledWith('story_1', { layout: DEFAULT_LAYOUT })
  })

  it('shows a list asked for from deeper in, opening the sidebar for it unless asked not to', async () => {
    view.layout = { ...DEFAULT_LAYOUT, sidebar: false }
    await mountFrame()
    const sidebarTab = useSidebarTab()

    sidebarTab.show('comments', { open: false })
    await flushPromises()
    expect(updateView).not.toHaveBeenCalled()

    sidebarTab.show('comments')
    await flushPromises()
    expect(updateView).toHaveBeenLastCalledWith('story_1', {
      layout: { ...DEFAULT_LAYOUT, sidebarTab: 'comments' },
    })

    // With the sidebar showing, one not to open it for still turns it.
    sidebarTab.show('outline', { open: false })
    await flushPromises()
    expect(updateView).toHaveBeenLastCalledWith('story_1', { layout: DEFAULT_LAYOUT })
  })

  it('leaves a phone on its tab for a list asked for without opening it', async () => {
    screen.isMobile.value = true
    const wrapper = await mountFrame()
    const tab = () => wrapper.findComponent(MobileTopBar).props('activeMobileTab')
    const sidebarTab = useSidebarTab()

    sidebarTab.show('comments', { open: false })
    await flushPromises()
    expect(tab()).toBe('write')

    sidebarTab.show('comments')
    await flushPromises()
    expect(tab()).toBe('comments')
  })
})
