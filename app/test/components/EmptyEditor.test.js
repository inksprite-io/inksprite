import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import PrimeVue from 'primevue/config'
import EmptyEditor from '@/components/writer/editor/EmptyEditor.vue'

const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    ready: { value: true },
    firstTextDocument: vi.fn(() => null),
  },
}))

vi.mock('@/composables/useDocuments', () => ({ useDocuments: () => mockApi }))
vi.mock('@/composables/useNewDocument.js', () => ({ useNewDocument: () => vi.fn() }))

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

  it('shows nothing until the tree has loaded', () => {
    mockApi.ready = ref(false)
    expect(mountEmpty().text()).toBe('')
  })
})
