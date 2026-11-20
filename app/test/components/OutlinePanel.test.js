import { describe, it, expect, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import OutlinePanel from '@/components/writer/tree/OutlinePanel.vue'
import { hideSearch, showSearch } from '@/composables/useProjectSearch.js'

// The outline and the search stand in as what they are given and what they
// say: the panel only chooses between them and passes both on.
const treeMounted = vi.fn()
const DocumentTree = {
  name: 'DocumentTree',
  props: ['storyId', 'documentId', 'chatId'],
  emits: ['open', 'select-chat'],
  mounted: () => treeMounted(),
  template: '<div data-tree />',
}
const SearchPanel = {
  name: 'SearchPanel',
  props: ['storyId', 'documentId'],
  emits: ['open-document'],
  template: '<div data-search />',
}

const mountPanel = () =>
  mount(OutlinePanel, {
    props: { storyId: 'story_1', documentId: 'doc_1', chatId: 'chat_1' },
    global: { stubs: { DocumentTree, SearchPanel } },
  })

/** Whether the outline is hidden where it stands, as `v-show` hides. */
const outlineHidden = wrapper => wrapper.find('[data-tree]').element.style.display === 'none'

describe('OutlinePanel', () => {
  afterEach(() => {
    hideSearch('story_1')
    vi.clearAllMocks()
  })

  it('shows the outline of its project, on the document and the chat open', () => {
    const wrapper = mountPanel()

    expect(wrapper.findComponent(DocumentTree).props()).toEqual({
      storyId: 'story_1',
      documentId: 'doc_1',
      chatId: 'chat_1',
    })
    expect(outlineHidden(wrapper)).toBe(false)
    expect(wrapper.find('[data-search]').exists()).toBe(false)
  })

  it('shows the search in the outline’s place, on the same project and document', async () => {
    const wrapper = mountPanel()
    showSearch('story_1')
    await nextTick()

    expect(wrapper.findComponent(SearchPanel).props()).toEqual({
      storyId: 'story_1',
      documentId: 'doc_1',
    })
  })

  it('hides the outline while the search shows, without taking it down', async () => {
    const wrapper = mountPanel()
    showSearch('story_1')
    await nextTick()

    // Still there, so it comes back as it was left.
    expect(wrapper.find('[data-tree]').exists()).toBe(true)
    expect(outlineHidden(wrapper)).toBe(true)

    hideSearch('story_1')
    await nextTick()

    expect(outlineHidden(wrapper)).toBe(false)
    expect(wrapper.find('[data-search]').exists()).toBe(false)
    expect(treeMounted).toHaveBeenCalledTimes(1)
  })

  it('keeps to its own project’s search', async () => {
    const wrapper = mountPanel()
    showSearch('story_2')
    await nextTick()

    expect(wrapper.find('[data-search]').exists()).toBe(false)
    hideSearch('story_2')
  })

  it('passes on what is picked in the outline, and what is picked in the search', async () => {
    const wrapper = mountPanel()
    wrapper.findComponent(DocumentTree).vm.$emit('open', 'doc_2')
    wrapper.findComponent(DocumentTree).vm.$emit('select-chat', 'chat_2')
    showSearch('story_1')
    await nextTick()
    wrapper.findComponent(SearchPanel).vm.$emit('open-document', 'doc_3')

    expect(wrapper.emitted('open-document')).toEqual([['doc_2'], ['doc_3']])
    expect(wrapper.emitted('select-chat')).toEqual([['chat_2']])
  })
})
