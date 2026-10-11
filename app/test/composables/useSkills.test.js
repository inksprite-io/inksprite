import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSkills, renamedIn } from '@/composables/useSkills'
import { useChatProfileStore } from '@/stores/chatProfileStore'
import { useChatsStore } from '@/stores/chatsStore'
import { setLibrarySkills } from '@/ai/skills/index.js'

const tables = vi.hoisted(() => ({ skills: [], chatProfiles: [], chats: [] }))
const chatUpdates = vi.hoisted(() => [])

vi.mock('@/stores/db.js', () => {
  const table = name => ({
    toArray: async () => tables[name],
    where: () => ({ equals: () => ({ toArray: async () => tables[name] }) }),
    get: async id => tables[name].find(row => row.id === id),
    update: async (id, changes) => chatUpdates.push({ id, changes }),
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
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

/** A SKILL.md for a saved prompt of this name. */
const file = name =>
  `---\nname: ${name}\ndescription: ${name}.\ndisable-model-invocation: true\n---\n\nDo ${name}.\n`

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
    chatUpdates.length = 0
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
    expect(skills.nameProblem('interpret')).toMatch(/built-in skill/)
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
    tables.chats = [{ id: 'chat_closed', storyId: 'story_2', disabledTools: ['tighten'] }]

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
    expect(chatUpdates).toEqual([{ id: 'chat_closed', changes: { disabledTools: ['trim'] } }])
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
        found(file('interpret')),
        found(file('trim')),
        found('no frontmatter'),
      ])

      expect(
        rows.map(row => [row.name, row.replaces !== null, row.problem, row.errors.length])
      ).toEqual([
        ['trim', false, '', 0],
        ['tighten', true, '', 0],
        ['interpret', false, 'interpret is a built-in skill.', 0],
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

  it('forgets a skill it is asked to', async () => {
    const skills = useSkills()
    await skills.ready()
    const saved = await skills.saveSkill({ text: file('tighten') })

    expect(skills.deleteSkill('skill' in saved ? saved.skill.id : '')).toBe(true)
    expect(skills.skills.value).toEqual([])
  })
})
