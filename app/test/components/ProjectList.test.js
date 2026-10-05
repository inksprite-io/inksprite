import { describe, it, expect, beforeEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import PrimeVue from 'primevue/config'
import Menu from 'primevue/menu'
import ProjectList from '@/components/writer/projects/ProjectList.vue'
import ProjectCard from '@/components/writer/projects/ProjectCard.vue'
import NewProjectDialog from '@/components/writer/projects/NewProjectDialog.vue'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useStoriesStore } from '@/stores/storiesStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

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
        stubs: { ScrollPanel: { template: '<div><slot /></div>' }, NewProjectDialog: true },
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

  it('lists projects most recently worked on first, named from their roots', async () => {
    const first = await storiesStore.createStory('First')
    const second = await storiesStore.createStory('Second')
    // Both were made in the same millisecond; the first is the one worked on since.
    storiesStore.stories.get(first.id).updated = second.updated + 1000

    const { wrapper } = await mountList()
    expect(titles(wrapper)).toEqual(['First', 'Second'])
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
