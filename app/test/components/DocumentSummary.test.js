import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import Tooltip from 'primevue/tooltip'
import DocumentSummary from '@/components/writer/tree/DocumentSummary.vue'
import { useDocumentsStore } from '@/stores/documentsStore'

vi.mock('@/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
    },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

// Generation is a request to a model; none of that is under test here. The
// flags are real refs so the template unwraps them as it would the composable's.
const { isGenerating, providerSetupDialogVisible } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { isGenerating: ref(false), providerSetupDialogVisible: ref(false) }
})

vi.mock('@/composables/useAISummarize', () => ({
  useAISummarize: () => ({
    handleSummarize: vi.fn(),
    isGenerating,
    stopGeneration: vi.fn(),
  }),
}))

vi.mock('@/composables/useProviderSetup.js', () => ({
  useProviderSetup: () => ({
    providerSetupDialogVisible,
    handleDontShowAgain: vi.fn(),
    isProviderSetupDialogEnabled: () => false,
  }),
}))

vi.mock('@/components/common/InitialProviderSetup.vue', () => ({
  default: { name: 'InitialProviderSetup', template: '<div />' },
}))

const mountSummary = documentId =>
  mount(DocumentSummary, {
    props: { documentId },
    global: {
      plugins: [PrimeVue, ToastService],
      directives: { tooltip: Tooltip },
    },
  })

describe('DocumentSummary', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store
  /** @type {string} */
  let documentId

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useDocumentsStore()
    documentId = store.createDocument({
      storyId: 'story_1',
      parentId: 'root_story_1',
      type: 'text',
      title: 'Mara',
      content: 'Mara is thirty-one.',
    }).id
  })

  /** Open the field and type into it. */
  const draft = async (wrapper, text) => {
    await wrapper.find('.cursor-pointer').trigger('click')
    const field = wrapper.find('textarea')
    await field.setValue(text)
    return field
  }

  it('keeps a draft left by clicking away', async () => {
    const wrapper = mountSummary(documentId)
    const field = await draft(wrapper, 'The visitor.')

    await field.trigger('blur')

    expect(store.getDocument(documentId).summary).toBe('The visitor.')
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('drops a draft that was cancelled', async () => {
    const wrapper = mountSummary(documentId)
    await draft(wrapper, 'Discarded')

    await wrapper.find('[aria-label="Cancel"]').trigger('click')

    expect(store.getDocument(documentId).summary).toBeFalsy()
    expect(wrapper.find('textarea').exists()).toBe(false)
  })

  it('keeps a draft when the panel goes', async () => {
    const wrapper = mountSummary(documentId)
    await draft(wrapper, 'Kept.')

    wrapper.unmount()

    expect(store.getDocument(documentId).summary).toBe('Kept.')
  })

  it('writes nothing for a draft that did not change', async () => {
    store.updateDocument(documentId, { summary: 'As it was.' })
    const wrapper = mountSummary(documentId)
    const updated = store.getDocument(documentId).updated
    const field = await draft(wrapper, 'As it was.')

    await field.trigger('blur')

    expect(store.getDocument(documentId).updated).toBe(updated)
  })
})
