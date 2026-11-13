import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ConvertDialog from '@/components/writer/tree/ConvertDialog.vue'

const starting = ref({ providerId: 'openrouter', model: 'sonnet' })
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ startingPreset: starting }),
}))

const workflows = ref({ convert: { providerId: null, model: null, reasoningEffort: null } })
const setWorkflow = vi.fn((name, patch) => {
  workflows.value = { ...workflows.value, [name]: { ...workflows.value[name], ...patch } }
})
vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => ({ workflows, setWorkflow }),
}))
vi.mock('@/composables/useDocuments', () => ({
  useDocuments: () => ({ get: () => ({ id: 'doc_1', content: 'Words.', wordCount: 1200 }) }),
}))
const convert = vi.fn(async () => ({ id: 'job_1' }))
vi.mock('@/composables/useJobs.js', () => ({ useJobs: () => ({ convert }) }))
vi.mock('@/composables/useJobsToast.js', () => ({ useJobsToast: () => ({ show: vi.fn() }) }))
const error = vi.fn()
vi.mock('@/composables/useToast.js', () => ({ useToast: () => ({ error }) }))
vi.mock('@/jobs/index.js', () => ({ requestsFor: () => 3 }))
vi.mock('@/composables/useModelLists', () => ({
  useModelLists: () => ({
    listOf: id =>
      id === 'openrouter' ? { models: [{ id: 'sonnet', name: 'Claude Sonnet' }] } : undefined,
    load: vi.fn(async () => []),
  }),
}))

/** The picker, as Change… opens it. */
const ModelPickerDialog = {
  name: 'ModelPickerDialog',
  props: ['providerId', 'model'],
  emits: ['use', 'close'],
  template: '<div data-picker />',
}

const mountDialog = () =>
  mount(ConvertDialog, {
    props: { storyId: 'story_1', documentId: 'doc_1' },
    global: {
      plugins: [PrimeVue],
      stubs: {
        ModelPickerDialog,
        Dialog: { template: '<div><slot /><slot name="footer" /></div>' },
      },
    },
  })

describe('ConvertDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    workflows.value = { convert: { providerId: null, model: null, reasoningEffort: null } }
  })

  it('says how big it is, and starts the first time on what new chats start on', () => {
    const wrapper = mountDialog()

    expect(wrapper.find('[data-convert-size]').text()).toBe(
      '1,200 words, about 3 requests. The Markdown goes in a new document under it.'
    )
    expect(wrapper.find('[data-convert-model]').text()).toBe('Claude Sonnet')
  })

  it('starts on the model last converted with', () => {
    workflows.value = { convert: { providerId: 'p_box', model: 'qwen' } }

    expect(mountDialog().find('[data-convert-model]').text()).toBe('qwen')
  })

  it('converts on the model chosen in the picker, and keeps it for next time', async () => {
    const wrapper = mountDialog()
    await wrapper.find('[data-action="change-model"]').trigger('click')
    const picker = wrapper.findComponent(ModelPickerDialog)
    expect(picker.props()).toEqual({ providerId: 'openrouter', model: 'sonnet' })
    picker.vm.$emit('use', { providerId: 'p_box', model: 'qwen' })
    await flushPromises()

    await wrapper.find('[data-action="convert-confirm"]').trigger('click')
    await flushPromises()

    expect(setWorkflow).toHaveBeenCalledWith('convert', { providerId: 'p_box', model: 'qwen' })
    expect(convert).toHaveBeenCalledWith('story_1', 'doc_1')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('says why a conversion could not start, and stays open', async () => {
    convert.mockRejectedValueOnce(new Error('No AI provider is connected.'))
    const wrapper = mountDialog()

    await wrapper.find('[data-action="convert-confirm"]').trigger('click')
    await flushPromises()

    expect(error).toHaveBeenCalledWith(
      "The conversion couldn't start. No AI provider is connected."
    )
    expect(wrapper.emitted('close')).toBeUndefined()
  })
})
