import { describe, it, expect } from 'vitest'
import {
  experimentalOffChats,
  experimentalOffProfiles,
} from '@/stores/migrations/experimentalSkills.js'
import { upgradeTables } from '@/utils/backup.js'

describe('experimentalOffChats', () => {
  it('switches the experimental group off beside what the chat had off', () => {
    const { chats, moved } = experimentalOffChats([
      { id: 'c1' },
      { id: 'c2', disabledToolGroups: ['rpg'], disabledTools: ['oracle'] },
    ])

    expect(moved).toBe(2)
    expect(chats).toEqual([
      { id: 'c1', disabledToolGroups: ['experimental'] },
      { id: 'c2', disabledToolGroups: ['rpg', 'experimental'], disabledTools: ['oracle'] },
    ])
  })

  it('leaves a chat with it off already as it is, so it can run twice', () => {
    const chat = { id: 'c1', disabledToolGroups: ['experimental', 'rpg'] }
    const { chats, moved } = experimentalOffChats([chat])

    expect(moved).toBe(0)
    expect(chats[0]).toBe(chat)
  })
})

describe('experimentalOffProfiles', () => {
  it("switches it off on the writer's profiles, and leaves the rest of their settings", () => {
    const { profiles, moved } = experimentalOffProfiles([
      { id: 'p1', name: 'Mine', settings: { prompt: 'Be terse.', disabledToolGroups: ['web'] } },
      { id: 'p2', name: 'Bare', settings: { prompt: 'Hello.' } },
    ])

    expect(moved).toBe(2)
    expect(profiles).toEqual([
      {
        id: 'p1',
        name: 'Mine',
        settings: { prompt: 'Be terse.', disabledToolGroups: ['web', 'experimental'] },
      },
      {
        id: 'p2',
        name: 'Bare',
        settings: { prompt: 'Hello.', disabledToolGroups: ['experimental'] },
      },
    ])
  })
})

describe('the backup upgrade', () => {
  it('runs on a backup from before, chats and profiles alike', () => {
    const tables = upgradeTables(
      {
        chats: [{ id: 'c1', disabledToolGroups: ['skills'] }],
        chatProfiles: [{ id: 'p1', settings: { prompt: 'Be terse.' } }],
      },
      27,
      28
    )

    expect(tables.chats).toEqual([{ id: 'c1', disabledToolGroups: ['skills', 'experimental'] }])
    expect(tables.chatProfiles).toEqual([
      { id: 'p1', settings: { prompt: 'Be terse.', disabledToolGroups: ['experimental'] } },
    ])
  })

  it('makes no table a project had none of', () => {
    // The desktop library brings a project forward through this, with no
    // profiles in it.
    const tables = upgradeTables({ chats: [] }, 27, 28)

    expect(tables).not.toHaveProperty('chatProfiles')
  })
})
