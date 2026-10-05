import { describe, it, expect } from 'vitest'
import { rolesToSkills } from '@/stores/migrations/profileSkills.js'
import { upgradeTables } from '@/utils/backup.js'

const profile = settings => ({ id: 'chatprofile_1', name: 'Mine', settings, version: 3 })

describe('rolesToSkills', () => {
  it('moves a profile’s role wording onto its skills, Compaction’s under compact', () => {
    const { profiles, moved } = rolesToSkills([
      profile({
        prompt: 'Run the game.',
        roles: {
          director: { prompt: 'Say what the scene needs.' },
          compaction: { prompt: 'Keep the dialogue.' },
        },
      }),
    ])

    expect(moved).toBe(1)
    expect(profiles[0]).toEqual(
      profile({
        prompt: 'Run the game.',
        skills: {
          director: { prompt: 'Say what the scene needs.' },
          compact: { prompt: 'Keep the dialogue.' },
        },
      })
    )
  })

  it('leaves a profile with no role wording as it is', () => {
    const untouched = profile({ prompt: 'Brainstorm.' })
    const { profiles, moved } = rolesToSkills([untouched])

    expect(moved).toBe(0)
    expect(profiles[0]).toBe(untouched)
  })

  it('is the same the second time, so a retried upgrade changes nothing', () => {
    const once = rolesToSkills([profile({ roles: { write: { prompt: 'Short.' } } })]).profiles
    const twice = rolesToSkills(once)

    expect(twice.moved).toBe(0)
    expect(twice.profiles).toEqual(once)
  })

  it('keeps what is already under skills where a profile somehow has both', () => {
    const { profiles } = rolesToSkills([
      profile({
        roles: { compaction: { prompt: 'Old.' } },
        skills: { compact: { prompt: 'New.' } },
      }),
    ])

    expect(profiles[0].settings).toEqual({ skills: { compact: { prompt: 'New.' } } })
  })

  it('carries a backup taken before it forward the same way', () => {
    const tables = upgradeTables(
      { chatProfiles: [profile({ roles: { compaction: { prompt: 'Keep it.' } } })] },
      18,
      19
    )

    expect(tables.chatProfiles[0].settings).toEqual({
      skills: { compact: { prompt: 'Keep it.' } },
    })
  })
})
