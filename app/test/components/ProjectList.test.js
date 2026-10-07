import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import PrimeVue from 'primevue/config'
import Menu from 'primevue/menu'
import ProjectList from '@/components/writer/projects/ProjectList.vue'
import ProjectCard from '@/components/writer/projects/ProjectCard.vue'
import NewProjectDialog from '@/components/writer/projects/NewProjectDialog.vue'
import ProjectDialog from '@/components/writer/tree/ProjectDialog.vue'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useStoriesStore } from '@/stores/storiesStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

// A real ref, so the template unwraps it. Shared, so a test can be on a phone.
const { screen } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { screen: { isMobile: ref(false) } }
})
vi.mock('@/composables/useScreenSize', () => ({ useScreenSize: () => screen }))

vi.mock('@/stores/db', () => {
  const byIndex = () => ({
    where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
  })
  return {
    default: {
      stories: { toArray: vi.fn(async () => []) },
      documents: {
        ...byIndex(),
        bulkGet: vi.fn(async () => []),
        get: vi.fn(async () => undefined),
      },
      chats: byIndex(),
      messages: byIndex(),
      jobs: { ...byIndex(), bulkDelete: vi.fn(async () => undefined) },
    },
  }
})

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const { backup, toast } = vi.hoisted(() => ({
  backup: {
    downloadProject: vi.fn(),
    readProjectFile: vi.fn(),
    importProject: vi.fn(),
  },
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@/composables/useBackup', () => ({ useBackup: () => backup }))
vi.mock('@/composables/useToast', () => ({ useToast: () => toast }))

// Every deletion is confirmed.
vi.mock('primevue/useconfirm', () => ({
  useConfirm: () => ({ require: options => options.accept() }),
}))

describe('ProjectList', () => {
  /** @type {ReturnType<typeof useStoriesStore>} */
  let storiesStore
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let documentsStore
  let router

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    screen.isMobile.value = false
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

  const mountList = async (props = {}) => {
    const wrapper = mount(ProjectList, {
      props,
      global: {
        plugins: [router, PrimeVue],
        directives: { tooltip: {} },
        stubs: {
          ScrollPanel: { template: '<div><slot /></div>' },
          NewProjectDialog: true,
          ProjectDialog: true,
        },
      },
    })
    await flushPromises()
    return { wrapper, push: vi.spyOn(router, 'push') }
  }

  const titles = wrapper => wrapper.findAllComponents(ProjectCard).map(card => card.props('title'))

  const menuCommand = (card, label) =>
    card
      .findComponent(Menu)
      .props('model')
      .find(item => item.label === label)
      .command()

  it('lists projects by name, numbers as numbers and case aside, named from their roots', async () => {
    for (const title of ['Zebra', 'Draft 10', 'apple', 'Draft 2']) {
      await storiesStore.createStory(title)
    }

    const { wrapper } = await mountList()
    expect(titles(wrapper)).toEqual(['apple', 'Draft 2', 'Draft 10', 'Zebra'])
  })

  it('keeps a project where it is when it is worked on', async () => {
    const first = await storiesStore.createStory('First')
    const second = await storiesStore.createStory('Second')
    storiesStore.stories.get(second.id).updated = first.updated + 1000

    const { wrapper } = await mountList()
    expect(titles(wrapper)).toEqual(['First', 'Second'])
  })

  it('opens a project’s settings from its card', async () => {
    await storiesStore.createStory('Draft')
    const { wrapper } = await mountList()
    const card = wrapper.findComponent(ProjectCard)

    expect(card.findComponent(ProjectDialog).props('visible')).toBe(false)
    await menuCommand(card, 'Project settings')
    await flushPromises()
    expect(card.findComponent(ProjectDialog).props('visible')).toBe(true)
  })

  it('offers the card’s menu on right-click, and a button for it only on a phone', async () => {
    await storiesStore.createStory('Draft')
    const { wrapper } = await mountList()
    expect(wrapper.find('[aria-label="Project actions"]').exists()).toBe(false)
    expect(wrapper.findComponent(ProjectCard).findComponent(Menu).exists()).toBe(true)

    screen.isMobile.value = true
    await flushPromises()
    expect(wrapper.find('[aria-label="Project actions"]').exists()).toBe(true)
  })

  it('has no link to the docs under the list', async () => {
    const { wrapper } = await mountList()
    expect(wrapper.find('a[href*="docs.inksprite.io"]').exists()).toBe(false)
  })

  it('marks the project open', async () => {
    const story = await storiesStore.createStory('Mine')
    await storiesStore.createStory('Other')

    const { wrapper } = await mountList({ storyId: story.id })
    const flags = wrapper.findAllComponents(ProjectCard).map(card => card.props('active'))
    expect(flags.filter(Boolean)).toHaveLength(1)
    expect(
      wrapper
        .findAllComponents(ProjectCard)
        .find(c => c.props('active'))
        .props('title')
    ).toBe('Mine')
  })

  it('opens a project', async () => {
    const story = await storiesStore.createStory('Mine')
    const { wrapper, push } = await mountList()

    await wrapper.findComponent(ProjectCard).trigger('click')

    expect(push).toHaveBeenCalledWith(`/project/${story.id}`)
  })

  it('starts a project empty, named on its root, and opens it', async () => {
    const { wrapper, push } = await mountList()

    wrapper.findComponent(NewProjectDialog).vm.$emit('create', { title: 'My Novel' })
    await flushPromises()

    const storyId = [...storiesStore.stories.keys()][0]
    expect(documentsStore.getRoot(storyId).title).toBe('My Novel')
    expect(documentsStore.getChildren(rootIdFor(storyId))).toEqual([])
    expect(push).toHaveBeenCalledWith(`/project/${storyId}`)
  })

  it('renames a project from its card', async () => {
    const story = await storiesStore.createStory('Draft')
    const { wrapper } = await mountList()
    const card = wrapper.findComponent(ProjectCard)

    await menuCommand(card, 'Rename')
    await flushPromises()
    const input = card.find('input')
    await input.setValue('Final')
    await input.trigger('keyup.enter')
    await flushPromises()

    expect(documentsStore.getRoot(story.id).title).toBe('Final')
  })

  it('exports a project from its card', async () => {
    const story = await storiesStore.createStory('Draft')
    backup.downloadProject.mockResolvedValue({ filename: 'inksprite-project-draft.json', bytes: 1 })
    const { wrapper } = await mountList()

    await menuCommand(wrapper.findComponent(ProjectCard), 'Export')
    await flushPromises()

    expect(backup.downloadProject).toHaveBeenCalledWith(story.id)
    expect(toast.success).toHaveBeenCalledWith('Saved inksprite-project-draft.json')
  })

  it('says why an export failed', async () => {
    await storiesStore.createStory('Draft')
    backup.downloadProject.mockRejectedValue(new Error('Quota exceeded'))
    const { wrapper } = await mountList()

    await menuCommand(wrapper.findComponent(ProjectCard), 'Export')
    await flushPromises()

    expect(toast.error).toHaveBeenCalledWith('Export failed: Quota exceeded')
  })

  /**
   * Pick a file in the list's hidden input.
   * @param {import('@vue/test-utils').VueWrapper} wrapper
   * @param {File} file
   */
  const pickFile = async (wrapper, file) => {
    const input = wrapper.find('input[type="file"]')
    Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
    await input.trigger('change')
    await flushPromises()
  }

  it('imports a project file and opens it', async () => {
    const file = new window.File(['{}'], 'inksprite-project-draft.json')
    const rows = { story: { id: 'story_from_file' } }
    backup.readProjectFile.mockResolvedValue(rows)
    backup.importProject.mockImplementation(() => storiesStore.createStory('Imported'))
    const { wrapper, push } = await mountList()

    await pickFile(wrapper, file)

    expect(backup.readProjectFile).toHaveBeenCalledWith(file)
    expect(backup.importProject).toHaveBeenCalledWith(rows)
    const storyId = [...storiesStore.stories.keys()][0]
    expect(toast.success).toHaveBeenCalledWith('Imported "Imported"')
    expect(push).toHaveBeenCalledWith(`/project/${storyId}`)
  })

  it('says why a file could not be imported, and opens nothing', async () => {
    backup.readProjectFile.mockRejectedValue(
      new Error('This file holds one chat, not one project.')
    )
    const { wrapper, push } = await mountList()

    await pickFile(wrapper, new window.File(['{}'], 'chat.json'))

    expect(backup.importProject).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('This file holds one chat, not one project.')
    expect(push).not.toHaveBeenCalled()
  })

  it('deletes a project, and leaves it when it was the one open', async () => {
    const story = await storiesStore.createStory('Doomed')
    const { wrapper, push } = await mountList({ storyId: story.id })

    await menuCommand(wrapper.findComponent(ProjectCard), 'Delete')

    // The cascade behind a deletion loads modules as it goes.
    await vi.waitFor(() => expect(storiesStore.getStory(story.id)).toBeNull())
    await flushPromises()
    expect(push).toHaveBeenCalledWith('/')
    // Its jobs went with it.
    const { default: db } = await import('@/stores/db')
    expect(db.jobs.where).toHaveBeenCalledWith('storyId')
    expect(db.jobs.bulkDelete).toHaveBeenCalled()
  })
})
