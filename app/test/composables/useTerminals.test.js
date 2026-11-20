import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { nextTick, reactive, ref } from 'vue'

// The projects there are, as the stories store has them.
const projects = reactive(new Map())
const fresh = ref(null)
const loaded = ref(true)
vi.mock('@/stores/storiesStore.js', () => ({
  useStoriesStore: () =>
    reactive({ isInitialized: loaded, stories: projects, isFresh: id => fresh.value === id }),
}))

// What saves a project not saved yet.
const startProject = vi.fn()
vi.mock('@/stores/syncStore.js', () => ({
  useSyncStore: () => ({ start: startProject }),
}))

const { clearTerminals, onTerminalEnded, useTerminals } = await import(
  '@/composables/useTerminals.js'
)

/** The native side's terminals, and the way to say what becomes of one. */
let native
/** @type {(id: string, event: object) => void} */
let say

beforeEach(() => {
  clearTerminals()
  projects.clear()
  projects.set('story_1', {})
  projects.set('story_2', {})
  fresh.value = null
  loaded.value = true
  startProject.mockClear()
  native = {
    create: vi.fn().mockResolvedValue('terminal:new'),
    list: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
    seen: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn(listener => {
      say = listener
    }),
  }
  globalThis.__INKSPRITE_DESKTOP__ = { terminals: native }
})

afterEach(() => {
  delete globalThis.__INKSPRITE_DESKTOP__
})

describe('useTerminals', () => {
  it('asks which terminals there are, once, in whichever project', async () => {
    native.list.mockResolvedValue([
      { id: 'terminal:1', project: 'story_1', title: 'zsh', rang: false },
      { id: 'terminal:2', project: 'story_2', title: '', rang: true },
      { id: 'terminal:3', project: 'story_1', title: '', rang: false },
    ])
    const terminals = useTerminals()
    expect(terminals.ready.value).toBe(false)
    await flushPromises()

    expect(terminals.ready.value).toBe(true)
    expect(terminals.of('story_1')).toEqual(['terminal:1', 'terminal:3'])
    expect(terminals.of('story_2')).toEqual(['terminal:2'])
    expect(terminals.get('terminal:1')).toEqual({
      id: 'terminal:1',
      project: 'story_1',
      title: 'zsh',
      rang: false,
    })
    expect(terminals.get('terminal:2').rang).toBe(true)
    expect(terminals.rang('terminal:2')).toBe(true)
    // The same terminals, however often they are asked for.
    expect(useTerminals()).toBe(terminals)
    expect(native.list).toHaveBeenCalledTimes(1)
  })

  it('has none, and is ready, where there are no terminals', () => {
    delete globalThis.__INKSPRITE_DESKTOP__
    const terminals = useTerminals()
    expect(terminals.ready.value).toBe(true)
    expect(terminals.of('story_1')).toEqual([])
  })

  it('is ready with none when they couldn’t be listed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    native.list.mockRejectedValue(new Error('no'))
    const terminals = useTerminals()
    await flushPromises()
    expect(terminals.ready.value).toBe(true)
    expect(terminals.of('story_1')).toEqual([])
    error.mockRestore()
  })

  it('makes a terminal in a project', async () => {
    const terminals = useTerminals()
    expect(await terminals.create('story_1')).toBe('terminal:new')
    expect(native.create).toHaveBeenCalledWith('story_1')
    expect(terminals.get('terminal:new')).toEqual({
      id: 'terminal:new',
      project: 'story_1',
      title: '',
      rang: false,
    })
  })

  it('saves a project not saved yet by its first terminal, which is then found in it again', async () => {
    await useTerminals().create('story_1')
    expect(startProject).toHaveBeenCalledWith('story_1')
  })

  it('saves nothing for a terminal that couldn’t be made', async () => {
    native.create.mockRejectedValue(new Error('no'))
    await expect(useTerminals().create('story_1')).rejects.toThrow('no')
    expect(startProject).not.toHaveBeenCalled()
  })

  it('hears of one made in another window, and keeps what it was told first', async () => {
    const terminals = useTerminals()
    say('terminal:theirs', { type: 'made', project: 'story_2' })
    expect(terminals.of('story_2')).toEqual(['terminal:theirs'])

    // The one made here is told of too, before the call that made it answers.
    say('terminal:new', { type: 'made', project: 'story_1' })
    say('terminal:new', { type: 'title', title: 'zsh' })
    await terminals.create('story_1')
    expect(terminals.get('terminal:new').title).toBe('zsh')
  })

  it('ends one it knows, and no other', async () => {
    const terminals = useTerminals()
    await terminals.create('story_1')
    terminals.close('terminal:other')
    expect(native.close).not.toHaveBeenCalled()

    terminals.close('terminal:new')
    expect(native.close).toHaveBeenCalledWith('terminal:new')
    expect(terminals.get('terminal:new')).toBeUndefined()
  })

  it('takes the name the program in it gives it', async () => {
    const terminals = useTerminals()
    await terminals.create('story_1')
    say('terminal:new', { type: 'title', title: 'vim notes.md' })
    expect(terminals.get('terminal:new').title).toBe('vim notes.md')
  })

  it('remembers one that rang until it is seen, and says so for every window', async () => {
    const terminals = useTerminals()
    await terminals.create('story_1')
    terminals.seen('terminal:new')
    expect(native.seen).not.toHaveBeenCalled()

    say('terminal:new', { type: 'bell' })
    expect(terminals.rang('terminal:new')).toBe(true)
    expect(terminals.get('terminal:new').rang).toBe(true)
    terminals.seen('terminal:new')
    expect(terminals.rang('terminal:new')).toBe(false)
    expect(terminals.get('terminal:new').rang).toBe(false)
    expect(native.seen).toHaveBeenCalledWith('terminal:new')
    expect(native.seen).toHaveBeenCalledTimes(1)
  })

  it('takes one as seen that another window looked at', async () => {
    const terminals = useTerminals()
    await terminals.create('story_1')
    say('terminal:new', { type: 'bell' })
    say('terminal:new', { type: 'seen' })
    expect(terminals.rang('terminal:new')).toBe(false)
  })

  it('tells who listens that a terminal is gone, while it is still known, then forgets it', async () => {
    const terminals = useTerminals()
    await terminals.create('story_1')
    say('terminal:new', { type: 'bell' })
    const ended = vi.fn(id => expect(terminals.get(id)).toBeDefined())
    const stop = onTerminalEnded(ended)

    say('terminal:new', { type: 'exit' })
    expect(ended).toHaveBeenCalledWith('terminal:new', 'story_1', false)
    expect(terminals.get('terminal:new')).toBeUndefined()
    expect(terminals.rang('terminal:new')).toBe(false)
    expect(native.close).not.toHaveBeenCalled()

    expect(stop()).toBeUndefined()
  })

  it('says which never started', async () => {
    const terminals = useTerminals()
    await terminals.create('story_1')
    const ended = vi.fn()
    onTerminalEnded(ended)
    say('terminal:new', { type: 'exit', failed: true })
    expect(ended).toHaveBeenCalledWith('terminal:new', 'story_1', true)
  })

  it('hears nothing more of a terminal it doesn’t know', () => {
    const terminals = useTerminals()
    const ended = vi.fn()
    onTerminalEnded(ended)
    say('terminal:gone', { type: 'bell' })
    say('terminal:gone', { type: 'exit' })
    expect(terminals.rang('terminal:gone')).toBe(false)
    expect(ended).not.toHaveBeenCalled()
  })

  describe('a project that goes', () => {
    it('takes its terminals with it, to the trash or for good', async () => {
      const terminals = useTerminals()
      await terminals.create('story_1')
      say('terminal:theirs', { type: 'made', project: 'story_2' })
      await nextTick()

      projects.delete('story_1')
      await nextTick()

      expect(native.close.mock.calls).toEqual([['terminal:new']])
      expect(terminals.of('story_1')).toEqual([])
      expect(terminals.of('story_2')).toEqual(['terminal:theirs'])
    })

    it('leaves the terminal of a project this window has yet to hear of', async () => {
      const terminals = useTerminals()
      say('terminal:theirs', { type: 'made', project: 'story_made_elsewhere' })
      await nextTick()
      expect(native.close).not.toHaveBeenCalled()

      // Once it has been seen here, its going ends them.
      projects.set('story_made_elsewhere', {})
      await nextTick()
      projects.delete('story_made_elsewhere')
      await nextTick()
      expect(native.close).toHaveBeenCalledWith('terminal:theirs')
      expect(terminals.of('story_made_elsewhere')).toEqual([])
    })

    it('counts the project not saved yet as there', async () => {
      projects.clear()
      fresh.value = 'story_fresh'
      const terminals = useTerminals()
      native.create.mockResolvedValue('terminal:fresh')
      await terminals.create('story_fresh')
      await nextTick()
      expect(native.close).not.toHaveBeenCalled()

      // Saved, it is among the projects, and still there.
      projects.set('story_fresh', {})
      fresh.value = null
      await nextTick()
      expect(native.close).not.toHaveBeenCalled()
    })

    it('ends nothing before the projects are loaded', async () => {
      loaded.value = false
      projects.clear()
      native.list.mockResolvedValue([
        { id: 'terminal:1', project: 'story_1', title: '', rang: false },
      ])
      const terminals = useTerminals()
      await flushPromises()
      expect(native.close).not.toHaveBeenCalled()

      projects.set('story_1', {})
      loaded.value = true
      await nextTick()
      expect(terminals.of('story_1')).toEqual(['terminal:1'])
      expect(native.close).not.toHaveBeenCalled()
    })
  })
})
