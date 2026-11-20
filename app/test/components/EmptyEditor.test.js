import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import PrimeVue from 'primevue/config'
import EmptyEditor from '@/components/writer/editor/EmptyEditor.vue'

const { mockApi, newDocument, forStory } = vi.hoisted(() => ({
  mockApi: {
    ready: { value: true },
    firstTextDocument: vi.fn(() => null),
  },
  newDocument: vi.fn(),
  forStory: vi.fn(),
}))

vi.mock('@/composables/useDocuments', () => ({ useDocuments: () => mockApi }))
vi.mock('@/composables/useNewDocument.js', () => ({
  useNewDocument: storyId => {
    forStory(storyId)
    return newDocument
  },
}))

describe('EmptyEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.ready = ref(true)
    mockApi.firstTextDocument.mockReturnValue(null)
  })

  const mountEmpty = () =>
    mount(EmptyEditor, { props: { storyId: 'story_1' }, global: { plugins: [PrimeVue] } })

  it('offers a first document to a project with none', () => {
    const wrapper = mountEmpty()
    expect(wrapper.text()).toContain('Nothing to write in yet')
    expect(wrapper.find('button').exists()).toBe(true)
  })

  it('says nothing is open in a project whose tabs are all closed', () => {
    mockApi.firstTextDocument.mockReturnValue({ id: 'doc_1', type: 'text' })
    const wrapper = mountEmpty()
    expect(wrapper.text()).toContain('Nothing open')
    expect(wrapper.find('button').exists()).toBe(true)
  })

  it('makes a document in its project on New document, as the editor’s strip does', async () => {
    const wrapper = mountEmpty()
    expect(wrapper.find('button').text()).toBe('New document')
    await wrapper.find('button').trigger('click')

    expect(forStory).toHaveBeenCalledWith('story_1')
    expect(newDocument).toHaveBeenCalledTimes(1)
  })

  it('shows nothing until the tree has loaded', () => {
    mockApi.ready = ref(false)
    expect(mountEmpty().text()).toBe('')
  })
})
