import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSkillStore } from '../../src/stores/skillStore'
import {
  INTERPRET_PROMPT,
  librarySkills,
  ownPrompt,
  setLibrarySkills,
  setSkillWordings,
} from '../../src/ai/skills/index.js'

const toArray = vi.fn()
const wordingsToArray = vi.fn()
vi.mock('../../src/stores/db', () => ({
  default: {
    skills: { toArray: (...args) => toArray(...args) },
    skillWordings: { toArray: (...args) => wordingsToArray(...args) },
  },
}))

const trackChange = vi.fn()
const trackDelete = vi.fn()
vi.mock('../../src/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange, trackDelete }),
}))

/** A SKILL.md for a skill of this name. */
const file = name => `---\nname: ${name}\ndescription: ${name}.\n---\n\nDo ${name}.\n`

describe('the skill store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    toArray.mockResolvedValue([])
    wordingsToArray.mockResolvedValue([])
  })

  afterEach(() => {
    setLibrarySkills([])
    setSkillWordings([])
  })

  it('hands the library it reads to the registry', async () => {
    toArray.mockResolvedValue([
      { id: 'skill_1', name: 'tighten', text: file('tighten'), files: [] },
    ])
    const store = useSkillStore()
    await store.ensureInitialized()

    expect(librarySkills().map(skill => skill.name)).toEqual(['tighten'])
  })

  it('hands it over even when the library could not be read, so a turn does not wait', async () => {
    toArray.mockRejectedValue(new Error('no database'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = useSkillStore()

    await expect(store.ensureInitialized()).resolves.toBeUndefined()
    expect(librarySkills()).toEqual([])
  })

  it('keeps a new skill, saves it, and tells the registry', async () => {
    const store = useSkillStore()
    await store.ensureInitialized()

    const made = store.createSkill({ name: 'tighten', text: file('tighten') })

    expect(made).toMatchObject({ name: 'tighten', files: [], version: 1 })
    expect(made.id).toMatch(/^skill_/)
    expect(trackChange).toHaveBeenCalledWith('skills', made.id, made)
    expect(librarySkills().map(skill => skill.name)).toEqual(['tighten'])
  })

  it('changes one, and the registry with it', async () => {
    const store = useSkillStore()
    await store.ensureInitialized()
    const made = store.createSkill({ name: 'tighten', text: file('tighten') })

    const changed = store.updateSkill(made.id, { name: 'trim', text: file('trim') })

    expect(changed).toMatchObject({ id: made.id, name: 'trim', version: 2 })
    expect(librarySkills().map(skill => skill.name)).toEqual(['trim'])
  })

  it('forgets one, and the registry with it', async () => {
    const store = useSkillStore()
    await store.ensureInitialized()
    const made = store.createSkill({ name: 'tighten', text: file('tighten') })

    expect(store.deleteSkill(made.id)).toBe(true)
    expect(trackDelete).toHaveBeenCalledWith('skills', made.id)
    expect(librarySkills()).toEqual([])
    expect(store.deleteSkill(made.id)).toBe(false)
  })

  it('lists the library by name', async () => {
    const store = useSkillStore()
    await store.ensureInitialized()
    store.createSkill({ name: 'tighten', text: file('tighten') })
    store.createSkill({ name: 'critique', text: file('critique') })

    expect(store.getAllSkills().map(skill => skill.name)).toEqual(['critique', 'tighten'])
  })
})

describe("the skill store's wordings of the built-ins", () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    toArray.mockResolvedValue([])
    wordingsToArray.mockResolvedValue([])
  })

  afterEach(() => setSkillWordings([]))

  it('hands the wordings it reads to the registry', async () => {
    wordingsToArray.mockResolvedValue([{ name: 'interpret', prompt: 'Read darkly.', updated: 1 }])
    const store = useSkillStore()
    await store.ensureInitialized()

    expect(store.getWording('interpret')).toBe('Read darkly.')
    expect(ownPrompt('interpret')).toBe('Read darkly.')
  })

  it('keeps a wording as typed, saves it, and tells the registry', async () => {
    const store = useSkillStore()
    await store.ensureInitialized()

    expect(store.setWording('interpret', 'Read darkly.\n')).toBe(true)

    expect(store.getWording('interpret')).toBe('Read darkly.\n')
    expect(trackChange).toHaveBeenCalledWith(
      'skillWordings',
      'interpret',
      expect.objectContaining({ name: 'interpret', prompt: 'Read darkly.\n' })
    )
    expect(ownPrompt('interpret')).toBe('Read darkly.')
  })

  it("takes the wording away when it is put back to the file's", async () => {
    // So a skill reset by hand keeps picking up the app's improvements to it.
    const store = useSkillStore()
    await store.ensureInitialized()
    store.setWording('interpret', 'Read darkly.')

    store.setWording('interpret', `${INTERPRET_PROMPT}\n`)

    expect(store.getWording('interpret')).toBeNull()
    expect(trackDelete).toHaveBeenCalledWith('skillWordings', 'interpret')
    expect(ownPrompt('interpret')).toBe(INTERPRET_PROMPT)
  })

  it('takes it away when it is emptied', async () => {
    const store = useSkillStore()
    await store.ensureInitialized()
    store.setWording('interpret', 'Read darkly.')

    store.setWording('interpret', '  ')

    expect(store.getWording('interpret')).toBeNull()
    expect(ownPrompt('interpret')).toBe(INTERPRET_PROMPT)
  })

  it('writes nothing for a wording that was never there', async () => {
    const store = useSkillStore()
    await store.ensureInitialized()

    store.setWording('interpret', INTERPRET_PROMPT)

    expect(trackChange).not.toHaveBeenCalled()
    expect(trackDelete).not.toHaveBeenCalled()
  })

  it("rewords only a built-in: the writer's own are their files", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const store = useSkillStore()
    await store.ensureInitialized()

    expect(store.setWording('tighten', 'Cut more.')).toBe(false)
    expect(trackChange).not.toHaveBeenCalled()
  })
})
