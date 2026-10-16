import { describe, it, expect, beforeEach, vi } from 'vitest'
import { effectScope, nextTick, reactive, shallowRef, triggerRef } from 'vue'

const mockStory = reactive(/** @type {Record<string, any>} */ ({ id: 'story_1' }))
const updateStory = vi.fn(async (_id, updates) => Object.assign(mockStory, updates))
vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: () => ({
    getStory: (/** @type {string} */ id) => (id === 'story_1' ? mockStory : null),
    updateStory,
  }),
}))

const documents = shallowRef(new Map())
vi.mock('@/stores/documentsStore', () => ({
  useDocumentsStore: () => ({
    get documents() {
      return documents.value
    },
  }),
}))

const touch = vi.hoisted(() => ({ on: false }))
vi.mock('@/utils/touch.js', () => ({ hasTouchKeyboard: () => touch.on }))

const checker = vi.hoisted(() => ({ configure: vi.fn() }))
vi.mock('@/spelling/checker.js', async () => {
  const { ref } = await import('vue')
  return { spellChecker: { configure: checker.configure, status: ref('ready') } }
})

import { namesIn, useProjectSpelling, useSpelling } from '@/composables/useSpelling.js'
import { useApplicationState } from '@/composables/useApplicationState'

/** @param {Array<Record<string, any>>} docs */
const setDocuments = docs => {
  documents.value = new Map(docs.map(doc => [doc.id, doc]))
  triggerRef(documents)
}

/** The composable, in a scope a test can stop. */
const mount = () => {
  const scope = effectScope()
  const spelling = /** @type {ReturnType<typeof useSpelling>} */ (
    scope.run(() => useSpelling('story_1'))
  )
  return { spelling, stop: () => scope.stop() }
}

/** What the checker was last set to. */
const lastConfig = () => checker.configure.mock.calls.at(-1)?.[0]

beforeEach(() => {
  useApplicationState().resetState()
  for (const key of Object.keys(mockStory)) if (key !== 'id') delete mockStory[key]
  setDocuments([])
  touch.on = false
  vi.clearAllMocks()
})

describe('namesIn', () => {
  it('takes the words with capitals, each once, without possessives', () => {
    expect(namesIn(['Marisol Vey', 'Notes on the harbour', 'Vey’s Boat', 'A list'])).toEqual([
      'Boat',
      'Marisol',
      'Notes',
      'Vey',
    ])
  })

  it('takes a hyphenated name as its parts', () => {
    expect(namesIn(['Jean-Tavrek'])).toEqual(['Jean', 'Tavrek'])
  })
})

describe('useSpelling', () => {
  it("sets the checker to the writer's settings, words, and the project's", () => {
    useApplicationState().addWord('Quellith')
    mockStory.spelling = { words: ['Tavrek'], ignored: ['42'] }
    setDocuments([
      { id: 'd1', storyId: 'story_1', type: 'text', title: 'Velmora Harbour' },
      { id: 'd2', storyId: 'story_2', type: 'text', title: 'Elsewhere' },
      { id: 'd3', storyId: 'story_1', type: 'file', title: 'Rulebook' },
    ])
    const { stop } = mount()
    expect(lastConfig()).toEqual({
      dialect: 'american',
      words: ['Quellith', 'Tavrek', 'Harbour', 'Velmora'],
      grammar: true,
      ignored: ['42'],
    })
    stop()
  })

  it('follows a renamed document', async () => {
    setDocuments([{ id: 'd1', storyId: 'story_1', type: 'text', title: 'Chapter One' }])
    const { stop } = mount()
    setDocuments([{ id: 'd1', storyId: 'story_1', type: 'text', title: 'Tavrek' }])
    await nextTick()
    expect(lastConfig().words).toEqual(['Tavrek'])
    stop()
  })

  it('turns the checker off when it is switched off, and on a phone', () => {
    useApplicationState().setSpellingEnabled(false)
    const browser = mount()
    expect(lastConfig().dialect).toBe(null)
    expect(browser.spelling.on.value).toBe(false)
    browser.stop()

    useApplicationState().setSpellingEnabled(true)
    touch.on = true
    const phone = mount()
    expect(lastConfig().dialect).toBe(null)
    expect(phone.spelling.on.value).toBe(false)
    phone.stop()
  })

  it("puts a word in the project's dictionary once, without its possessive", async () => {
    const { spelling, stop } = mount()
    await spelling.addProjectWord('Tavrek’s')
    await spelling.addProjectWord('Tavrek')
    expect(updateStory).toHaveBeenCalledTimes(1)
    expect(mockStory.spelling).toEqual({ words: ['Tavrek'] })
    stop()
  })

  it("puts a word in the writer's dictionary", () => {
    const { spelling, stop } = mount()
    spelling.addWord("Quellith's")
    expect(useApplicationState().spelling.value.words).toEqual(['Quellith'])
    stop()
  })

  it('keeps what the project ignores', async () => {
    mockStory.spelling = { words: ['Tavrek'] }
    const { spelling, stop } = mount()
    await spelling.ignore('42')
    await spelling.ignore('42')
    expect(mockStory.spelling).toEqual({ words: ['Tavrek'], ignored: ['42'] })
    expect(updateStory).toHaveBeenCalledTimes(1)
    stop()
  })
})

describe('useProjectSpelling', () => {
  beforeEach(() => {
    for (const key of Object.keys(mockStory)) if (key !== 'id') delete mockStory[key]
    vi.clearAllMocks()
  })

  it("lists the project's words, and takes one out", async () => {
    mockStory.spelling = { words: ['Tavrek', 'Quellith'], ignored: ['42'] }
    const project = useProjectSpelling('story_1')
    expect(project.words.value).toEqual(['Tavrek', 'Quellith'])
    await project.removeWord('Tavrek')
    await project.removeWord('Velmora')
    expect(mockStory.spelling).toEqual({ words: ['Quellith'], ignored: ['42'] })
    expect(updateStory).toHaveBeenCalledTimes(1)
  })

  it('has no words for a project that has none, or no project', () => {
    expect(useProjectSpelling('story_1').words.value).toEqual([])
    expect(useProjectSpelling('').words.value).toEqual([])
  })
})
