import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reactive } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'

const route = vi.hoisted(() => ({ params: { storyId: 'story_1' } }))
vi.mock('vue-router', () => ({ useRoute: () => route }))

const mockStory = reactive(/** @type {Record<string, any>} */ ({ id: 'story_1' }))
const updateStory = vi.fn(async (_id, updates) => Object.assign(mockStory, updates))
vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: () => ({
    getStory: (/** @type {string} */ id) => (id === 'story_1' ? mockStory : null),
    updateStory,
  }),
}))
vi.mock('@/stores/documentsStore', () => ({
  useDocumentsStore: () => ({ getRoot: () => ({ title: 'Thief' }) }),
}))

import DictionaryDialog from '@/components/writer/settings/DictionaryDialog.vue'
import { useApplicationState } from '@/composables/useApplicationState'

const mountDialog = () =>
  mount(DictionaryDialog, {
    props: { visible: true },
    global: {
      plugins: [PrimeVue],
      stubs: { Dialog: { props: ['visible'], template: '<div v-if="visible"><slot /></div>' } },
    },
  })

/** @param {ReturnType<typeof mountDialog>} wrapper */
const listed = wrapper => wrapper.findAll('[data-word]').map(word => word.text())

/**
 * Type into the add field and press Enter.
 * @param {ReturnType<typeof mountDialog>} wrapper
 * @param {string} text
 */
const add = async (wrapper, text) => {
  const field = wrapper.find('[data-add-word]')
  await field.setValue(text)
  await field.trigger('keydown', { key: 'Enter' })
}

beforeEach(() => {
  useApplicationState().resetState()
  for (const key of Object.keys(mockStory)) if (key !== 'id') delete mockStory[key]
  route.params.storyId = 'story_1'
  vi.clearAllMocks()
})

describe('DictionaryDialog', () => {
  it("lists the writer's words in order, and takes one out", async () => {
    const app = useApplicationState()
    app.addWord('Velmora')
    app.addWord('quellith')
    app.addWord('Tavrek')
    const wrapper = mountDialog()
    expect(listed(wrapper)).toEqual(['quellith', 'Tavrek', 'Velmora'])
    await wrapper.find('[aria-label="Remove Tavrek"]').trigger('click')
    expect(app.spelling.value.words).toEqual(['Velmora', 'quellith'])
  })

  it('adds what is typed, a word at a time, without possessives', async () => {
    const wrapper = mountDialog()
    await add(wrapper, 'Tavrek’s  Wi-Fi')
    expect(useApplicationState().spelling.value.words).toEqual(['Tavrek', 'Wi-Fi'])
    expect(/** @type {HTMLInputElement} */ (wrapper.find('[data-add-word]').element).value).toBe('')
  })

  it("shows the project's words on its tab, and changes those there", async () => {
    useApplicationState().addWord('Quellith')
    mockStory.spelling = { words: ['Tavrek'], ignored: ['42'] }
    const wrapper = mountDialog()
    await wrapper.find('[data-tab="project"]').trigger('click')
    expect(listed(wrapper)).toEqual(['Tavrek'])

    await add(wrapper, 'Velmora')
    expect(mockStory.spelling).toEqual({ words: ['Tavrek', 'Velmora'], ignored: ['42'] })
    await wrapper.find('[aria-label="Remove Tavrek"]').trigger('click')
    expect(mockStory.spelling.words).toEqual(['Velmora'])
    expect(useApplicationState().spelling.value.words).toEqual(['Quellith'])
  })

  it('says when there are no words', () => {
    expect(mountDialog().find('[data-no-words]').exists()).toBe(true)
  })

  it('has no project tab without a project open', () => {
    route.params.storyId = ''
    const wrapper = mountDialog()
    expect(wrapper.find('[data-tab="project"]').exists()).toBe(false)
    expect(wrapper.find('[data-add-word]').exists()).toBe(true)
  })
})
