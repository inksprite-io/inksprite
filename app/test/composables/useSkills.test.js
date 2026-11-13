import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSkills, renamedIn } from '@/composables/useSkills'
import { useChatProfileStore } from '@/stores/chatProfileStore'
import { useChatsStore } from '@/stores/chatsStore'
import { librarySkills, setLibrarySkills } from '@/ai/skills/index.js'

const tables = vi.hoisted(() => ({ skills: [], chatProfiles: [], chats: [] }))

vi.mock('@/stores/db.js', () => {
  const table = name => ({
    toArray: async () => tables[name],
    where: () => ({ equals: () => ({ toArray: async () => tables[name] }) }),
    get: async id => tables[name].find(row => row.id === id),
    toCollection: () => ({
      modify: async change => {
        for (const row of tables[name]) change(row)
      },
    }),
  })
  return {
    default: {
      skills: table('skills'),
      chatProfiles: table('chatProfiles'),
      chats: table('chats'),
    },
  }
})

vi.mock('@/stores/syncStore.js', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

/** A SKILL.md for a saved prompt of this name. */
const file = name =>
  `---\nname: ${name}\ndescription: ${name}.\ndisable-model-invocation: true\n---\n\nDo ${name}.\n`

/** A SKILL.md with nothing written in it yet. */
const UNWRITTEN = "---\nname: ''\ndescription: ''\n---\n\n\n"

describe('renamedIn', () => {
  it('moves a profile’s wording and a switched-off tool to the new name', () => {
    expect(
      renamedIn(
        { skills: { tighten: { prompt: 'Halve it.' } }, disabledTools: ['tighten', 'oracle'] },
        'tighten',
        'trim'
      )
    ).toEqual({ skills: { trim: { prompt: 'Halve it.' } }, disabledTools: ['trim', 'oracle'] })
  })

  it('says nothing when nothing names it', () => {
    expect(renamedIn({ skills: { other: {} }, disabledTools: ['oracle'] }, 'tighten', 'trim')).toBe(
      null
    )
    expect(renamedIn(undefined, 'tighten', 'trim')).toBe(null)
  })
})

describe('useSkills', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    tables.skills = []
    tables.chatProfiles = []
    tables.chats = []
  })

  afterEach(() => setLibrarySkills([]))

  it('keeps a skill whose file reads and whose name is free', async () => {
    const skills = useSkills()
    await skills.ready()

    const saved = await skills.saveSkill({ text: file('tighten') })

    expect('skill' in saved && saved.skill.name).toBe('tighten')
    expect(skills.skills.value.map(skill => skill.name)).toEqual(['tighten'])
  })

  it('refuses a file that does not read, with every reason', async () => {
    const skills = useSkills()
    const saved = await skills.saveSkill({ text: '---\ncontext: inline\n---\n\nx' })

    expect('errors' in saved && saved.errors.length).toBeGreaterThan(1)
  })

  it('refuses a name something else already answers to', async () => {
    const skills = useSkills()
    await skills.ready()
    await skills.saveSkill({ text: file('tighten') })

    expect(skills.nameProblem('tighten')).toMatch(/already have a skill/)
    expect(skills.nameProblem('compact')).toMatch(/built-in skill/)
    expect(skills.nameProblem('roll')).toMatch(/already a \/roll/)
    expect(skills.nameProblem('roll_dice')).toMatch(/tool called roll_dice/)
    expect(skills.nameProblem('trim')).toBe('')
  })

  it('lets a skill keep its own name', async () => {
    const skills = useSkills()
    await skills.ready()
    const saved = await skills.saveSkill({ text: file('tighten') })
    const id = 'skill' in saved ? saved.skill.id : ''

    expect(skills.nameProblem('tighten', id)).toBe('')
    const again = await skills.saveSkill({ id, text: file('tighten').replace('Do', 'Now do') })
    expect('skill' in again && again.skill.text).toContain('Now do tighten.')
  })

  it('carries a rename to profiles’ wording and to chats that switched it off', async () => {
    tables.chatProfiles = [
      {
        id: 'chatprofile_1',
        name: 'Mine',
        settings: { prompt: 'Hi.', skills: { tighten: { prompt: 'Halve it.' } } },
      },
    ]
    tables.chats = [
      { id: 'chat_closed', storyId: 'story_2', disabledTools: ['tighten'] },
      { id: 'chat_open', storyId: 'story_1', disabledTools: ['tighten', 'oracle'] },
    ]

    const chats = useChatsStore()
    chats.chats.set('chat_open', {
      id: 'chat_open',
      storyId: 'story_1',
      disabledTools: ['tighten', 'oracle'],
    })

    const skills = useSkills()
    await skills.ready()
    const saved = await skills.saveSkill({ text: file('tighten') })
    const id = 'skill' in saved ? saved.skill.id : ''

    await skills.saveSkill({ id, text: file('trim') })

    const profiles = useChatProfileStore()
    expect(profiles.getProfile('chatprofile_1').settings).toEqual({
      prompt: 'Hi.',
      skills: { trim: { prompt: 'Halve it.' } },
    })
    expect(chats.chats.get('chat_open').disabledTools).toEqual(['trim', 'oracle'])
    // A chat that is open is the store's to save; the rest change where they are kept.
    expect(tables.chats.map(chat => chat.disabledTools)).toEqual([['trim'], ['tighten', 'oracle']])
  })

  describe('an import', () => {
    /** A skill found in what was handed over. */
    const found = (text, path = 'x/SKILL.md') => ({ path, text, files: [], dropped: [] })

    it('shows what would happen to each skill before anything is kept', async () => {
      const skills = useSkills()
      await skills.ready()
      await skills.saveSkill({ text: file('tighten') })

      const rows = skills.planImport([
        found(file('trim')),
        found(file('tighten')),
        found(file('compact')),
        found(file('trim')),
        found('no frontmatter'),
      ])

      expect(
        rows.map(row => [row.name, row.replaces !== null, row.problem, row.errors.length])
      ).toEqual([
        ['trim', false, '', 0],
        ['tighten', true, '', 0],
        ['compact', false, 'compact is a built-in skill.', 0],
        ['trim', false, 'Another skill here is called trim.', 0],
        ['', false, '', 1],
      ])
      expect(skills.skills.value.map(skill => skill.name)).toEqual(['tighten'])
    })

    it('names the fields a skill has that this app does not use', async () => {
      const skills = useSkills()
      const [row] = skills.planImport([
        found('---\nname: a\ndescription: A.\nmodel: opus\n---\n\nDo.\n'),
      ])

      expect(row.ignored).toEqual(['model'])
    })

    it('keeps the new ones and replaces the writer’s own of the same name', async () => {
      const skills = useSkills()
      await skills.ready()
      await skills.saveSkill({ text: file('tighten') })
      const before = skills.skills.value[0].id

      const rows = skills.planImport([
        found(file('trim')),
        {
          ...found(file('tighten').replace('Do', 'Now do')),
          files: [{ path: 'a.md', content: 'A' }],
        },
      ])
      const { imported, failed } = await skills.importSkills(rows)

      expect({ imported, failed }).toEqual({ imported: 2, failed: [] })
      const tighten = skills.skills.value.find(skill => skill.name === 'tighten')
      expect(tighten.id).toBe(before)
      expect(tighten.text).toContain('Now do tighten.')
      expect(tighten.files).toEqual([{ path: 'a.md', content: 'A' }])
    })
  })

  it('keeps a new skill under the name its file gives it, and offers it once it reads', async () => {
    const skills = useSkills()
    await skills.ready()

    const made = skills.createSkill(file('tighten'))

    expect(made.name).toBe('tighten')
    expect(skills.problemOf(made)).toBe('')
    expect(librarySkills().map(skill => skill.name)).toEqual(['tighten'])
  })

  it('keeps a new skill whose file gives it no name it can have, under one nothing has', async () => {
    const skills = useSkills()
    await skills.ready()
    await skills.saveSkill({ text: file('tighten') })

    const unnamed = skills.createSkill(UNWRITTEN)
    const second = skills.createSkill(UNWRITTEN)
    const taken = skills.createSkill(file('tighten'))

    expect([unnamed.name, second.name, taken.name]).toEqual([
      'new-skill',
      'new-skill-2',
      'new-skill-3',
    ])
    expect(skills.problemOf(unnamed)).toBe('It needs a name.')
    expect(skills.problemOf(taken)).toBe('You already have a skill called tighten.')
    expect(librarySkills().map(skill => skill.name)).toEqual(['tighten'])
  })

  it('keeps a file as it is typed, whatever state it is in', async () => {
    const skills = useSkills()
    await skills.ready()
    const made = skills.createSkill(UNWRITTEN)

    const unreadable = '---\nname: [oops\n---\n'
    const kept = await skills.writeSkill(made.id, unreadable)

    expect(kept?.text).toBe(unreadable)
    expect(kept?.name).toBe('new-skill')
    expect(skills.problemOf(/** @type {any} */ (kept))).toMatch(/^The frontmatter can’t be read/)
    expect(await skills.writeSkill('skill_gone', unreadable)).toBeNull()
  })

  it('offers a skill once its file reads, under the name the file gives it', async () => {
    const skills = useSkills()
    await skills.ready()
    const made = skills.createSkill(UNWRITTEN)

    const kept = await skills.writeSkill(made.id, file('tighten'))

    expect(kept?.name).toBe('tighten')
    expect(skills.problemOf(/** @type {any} */ (kept))).toBe('')
    expect(librarySkills().map(skill => skill.name)).toEqual(['tighten'])
  })

  it('leaves a name with the skill that had it first, and says so of the other', async () => {
    const skills = useSkills()
    await skills.ready()
    await skills.saveSkill({ text: file('tighten') })
    const other = await skills.saveSkill({ text: file('trim') })
    const id = 'skill' in other ? other.skill.id : ''

    const kept = await skills.writeSkill(id, file('tighten'))

    expect(kept?.name).toBe('trim')
    expect(skills.problemOf(/** @type {any} */ (kept))).toBe(
      'You already have a skill called tighten.'
    )
    expect(librarySkills().map(skill => skill.name)).toEqual(['tighten'])

    const command = await skills.writeSkill(id, file('roll'))
    expect(command?.name).toBe('trim')
    expect(skills.problemOf(/** @type {any} */ (command))).toBe('There is already a /roll.')
  })

  it('gives a skill the name its file asks for once the name comes free', async () => {
    const skills = useSkills()
    await skills.ready()
    const first = await skills.saveSkill({ text: file('tighten') })
    const other = await skills.saveSkill({ text: file('trim') })
    const id = 'skill' in other ? other.skill.id : ''
    await skills.writeSkill(id, file('tighten'))

    await skills.deleteSkill('skill' in first ? first.skill.id : '')

    expect(skills.getSkill(id)?.name).toBe('tighten')
    expect(librarySkills().map(skill => skill.name)).toEqual(['tighten'])
  })

  it('carries a rename typed into the file to what hangs on the name', async () => {
    const skills = useSkills()
    await skills.ready()
    const profiles = useChatProfileStore()
    await profiles.ensureInitialized()
    const profile = profiles.createProfile({ name: 'Editing' })
    profiles.updateProfile(profile.id, {
      settings: /** @type {any} */ ({ disabledTools: ['tighten'] }),
    })
    const saved = await skills.saveSkill({ text: file('tighten') })

    await skills.writeSkill('skill' in saved ? saved.skill.id : '', file('trim'))

    expect(profiles.getProfile(profile.id)?.settings?.disabledTools).toEqual(['trim'])
  })

  it('forgets a skill it is asked to', async () => {
    const skills = useSkills()
    await skills.ready()
    const saved = await skills.saveSkill({ text: file('tighten') })

    expect(await skills.deleteSkill('skill' in saved ? saved.skill.id : '')).toBe(true)
    expect(skills.skills.value).toEqual([])
  })
})
