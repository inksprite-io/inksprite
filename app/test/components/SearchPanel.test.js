import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import SearchPanel from '@/components/writer/search/SearchPanel.vue'
import {
  goneTo,
  isSearchKey,
  requestSearchField,
  takeUpMatch,
} from '@/composables/useProjectSearch.js'

// A project of a folder with two chapters in it, and a note beside it.
const { tree } = vi.hoisted(() => ({
  tree: {
    documents: [
      { id: 'root', type: 'folder', title: '', parentId: null },
      { id: 'part', type: 'folder', title: 'Part One', parentId: 'root' },
      {
        id: 'one',
        type: 'text',
        title: 'The Gate',
        parentId: 'part',
        content: 'The gate was shut.\n\nShe knocked at the **gate** twice.',
      },
      { id: 'two', type: 'text', title: 'Inside', parentId: 'part', content: 'No way in.' },
      {
        id: 'notes',
        type: 'text',
        title: 'Notes',
        parentId: 'root',
        content: 'gate: iron, old',
        plain: true,
      },
    ],
  },
}))

vi.mock('@/stores/migrations/projectTree.js', () => ({ rootIdFor: () => 'root' }))
vi.mock('@/composables/useEditor.js', () => ({ useEditor: () => ({ stateOf: () => null }) }))
vi.mock('@/composables/useDocuments', () => {
  const get = id => tree.documents.find(document => document.id === id)
  const titlesOf = id => {
    const titles = []
    for (let at = get(id); at && at.id !== 'root'; at = get(at.parentId)) titles.unshift(at.title)
    return titles
  }
  const api = {
    get,
    childrenOf: parentId => tree.documents.filter(document => document.parentId === parentId),
    isPlain: id => !!get(id)?.plain,
    displayTitle: document => document?.title || 'Untitled',
    currentContent: id => get(id)?.content || '',
    titlesOf,
    pathOf: id => titlesOf(id).join('/'),
  }
  return { useDocuments: () => api }
})

let story = 0

const mountPanel = () =>
  mount(SearchPanel, {
    // A project of its own each time, since each keeps its search.
    props: { storyId: `story_${++story}`, documentId: 'one' },
    attachTo: document.body,
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: Tooltip },
      stubs: { ScrollPanel: { template: '<div><slot /></div>' } },
    },
  })

/** Type into the field and let the search run. */
const search = async (wrapper, text) => {
  await wrapper.find('[data-search-query]').setValue(text)
  vi.advanceTimersByTime(500)
  await nextTick()
}

/** Each document listed, and the lines under it as they read. */
const listed = wrapper =>
  wrapper.findAll('[data-search-document]').map(section => ({
    id: section.attributes('data-search-document'),
    lines: section.findAll('[data-search-line]').map(line => line.text()),
  }))

describe('SearchPanel', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('lists what it finds by document in the outline’s order, each match on its line', async () => {
    const wrapper = mountPanel()
    await search(wrapper, 'gate')

    expect(listed(wrapper)).toEqual([
      { id: 'one', lines: ['The gate was shut.', 'She knocked at the gate twice.'] },
      { id: 'notes', lines: ['gate: iron, old'] },
    ])
    expect(wrapper.find('[data-search-status]').text()).toBe('3 results in 2 documents')
    // The match is marked, and so is a title the query is in.
    const first = wrapper.find('[data-search-document="one"]')
    expect(first.find('[data-search-line] mark').text()).toBe('gate')
    expect(first.find('[data-action="open-document"] mark').text()).toBe('Gate')
    expect(first.find('[data-action="open-document"]').text()).toContain('Part One')
  })

  it('says when nothing has it', async () => {
    const wrapper = mountPanel()
    await search(wrapper, 'portcullis')
    expect(listed(wrapper)).toEqual([])
    expect(wrapper.find('[data-search-status]').text()).toBe('No results')
  })

  it('looks again matching case', async () => {
    const wrapper = mountPanel()
    await search(wrapper, 'Gate')
    await wrapper.find('[data-action="match-case"]').trigger('click')
    vi.advanceTimersByTime(500)
    await nextTick()
    // The title still has it; no text does.
    expect(listed(wrapper)).toEqual([{ id: 'one', lines: [] }])
    expect(wrapper.find('[data-search-status]').text()).toBe('1 title')
  })

  it('goes to a match picked, opening its document', async () => {
    const wrapper = mountPanel()
    await search(wrapper, 'gate')
    await wrapper.find('[data-search-document="one"] [data-search-line="1"]').trigger('click')

    expect(wrapper.emitted('open-document')).toEqual([['one']])
    expect(goneTo.value).toMatchObject({ documentId: 'one', query: 'gate', index: 1 })
    // Taken up once, by the view that shows it.
    expect(takeUpMatch('two')).toBeNull()
    expect(takeUpMatch('one')).toMatchObject({ index: 1 })
    expect(takeUpMatch('one')).toBeNull()
  })

  it('says where a match is in a plain document', async () => {
    const wrapper = mountPanel()
    await search(wrapper, 'iron')
    await wrapper.find('[data-search-line="0"]').trigger('click')
    expect(goneTo.value).toMatchObject({ documentId: 'notes', index: 0, at: 6 })
  })

  it('steps through every match with Enter, going round, and back with Shift-Enter', async () => {
    const wrapper = mountPanel()
    await search(wrapper, 'gate')
    const field = wrapper.find('[data-search-query]')
    const at = () => [goneTo.value.documentId, goneTo.value.index]

    await field.trigger('keydown', { key: 'Enter' })
    expect(at()).toEqual(['one', 0])
    await field.trigger('keydown', { key: 'Enter' })
    await field.trigger('keydown', { key: 'Enter' })
    expect(at()).toEqual(['notes', 0])
    await field.trigger('keydown', { key: 'Enter' })
    expect(at()).toEqual(['one', 0])
    await field.trigger('keydown', { key: 'Enter', shiftKey: true })
    expect(at()).toEqual(['notes', 0])
  })

  it('folds a document’s matches away', async () => {
    const wrapper = mountPanel()
    await search(wrapper, 'gate')
    await wrapper.find('[data-search-document="one"] [data-action="collapse"]').trigger('click')
    expect(listed(wrapper)[0]).toEqual({ id: 'one', lines: [] })
  })

  it('puts the caret in its field when asked', async () => {
    requestSearchField()
    const wrapper = mountPanel()
    await nextTick()
    expect(document.activeElement).toBe(wrapper.find('[data-search-query]').element)
  })
})

describe('isSearchKey', () => {
  const mod = /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }

  it('is Shift with the find key', () => {
    expect(isSearchKey({ key: 'F', shiftKey: true, ...mod })).toBe(true)
    expect(isSearchKey({ key: 'f', ...mod })).toBe(false)
    expect(isSearchKey({ key: 'f', shiftKey: true, altKey: true, ...mod })).toBe(false)
    expect(isSearchKey({ key: 'f', shiftKey: true })).toBe(false)
  })
})
