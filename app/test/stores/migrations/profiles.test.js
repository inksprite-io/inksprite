import { describe, it, expect } from 'vitest'
import {
  promptsToProfiles,
  chatsToProfiles,
  storiesToProfiles,
} from '@/stores/migrations/profiles.js'
import { CHAT_PROFILE_ID, ADVENTURE_PROFILE_ID, DEFAULT_PROFILE_ID } from '@/ai/profiles/index.js'

describe('prompts become profiles', () => {
  describe('promptsToProfiles', () => {
    it('makes a profile of each saved prompt, keeping its id', () => {
      // The id is what lets the chats that named it carry the reference across
      // rather than look anything up.
      const { profiles } = promptsToProfiles([
        { id: 'prompt_1', name: 'Editor', content: 'Be terse.', created: 5, updated: 6 },
      ])

      expect(profiles).toEqual([
        expect.objectContaining({
          id: 'prompt_1',
          name: 'Editor',
          settings: { prompt: 'Be terse.' },
          created: 5,
          updated: 6,
        }),
      ])
    })

    it('carries a deleted prompt across still deleted', () => {
      const { profiles } = promptsToProfiles([
        { id: 'prompt_1', name: 'Gone', content: '', deleted: true, deletedAt: 9 },
      ])

      expect(profiles[0]).toMatchObject({ deleted: true, deletedAt: 9 })
    })

    it('survives a library with nothing in it', () => {
      expect(promptsToProfiles([]).profiles).toEqual([])
      expect(promptsToProfiles(undefined).profiles).toEqual([])
      expect(promptsToProfiles([null]).profiles).toEqual([])
    })
  })

  describe('chatsToProfiles', () => {
    it('points a chat at the profile its saved prompt became', () => {
      const { chats, converted } = chatsToProfiles([{ id: 'chat_1', promptId: 'prompt_1' }])

      expect(chats[0].profileId).toBe('prompt_1')
      expect(converted).toBe(1)
    })

    it('points a chat on a built-in prompt at the profile built around it', () => {
      const { chats } = chatsToProfiles([
        { id: 'chat_1', promptId: 'builtin_adventure' },
        { id: 'chat_2', promptId: 'builtin_chat' },
      ])

      expect(chats[0].profileId).toBe(ADVENTURE_PROFILE_ID)
      expect(chats[1].profileId).toBe(CHAT_PROFILE_ID)
    })

    it('falls back to the default for a built-in nothing was built around', () => {
      const { chats } = chatsToProfiles([{ id: 'chat_1', promptId: 'builtin_long_gone' }])

      expect(chats[0].profileId).toBe(DEFAULT_PROFILE_ID)
    })

    it('leaves the prompt id where it is, as the record of what it was', () => {
      const { chats } = chatsToProfiles([{ id: 'chat_1', promptId: 'prompt_1' }])

      expect(chats[0].promptId).toBe('prompt_1')
    })

    it('leaves a chat that named nothing naming nothing', () => {
      // It falls back to whatever its project starts chats on, the way it
      // always did.
      const { chats, converted } = chatsToProfiles([{ id: 'chat_1' }])

      expect(chats[0]).not.toHaveProperty('profileId')
      expect(converted).toBe(0)
    })

    it('leaves a chat that already names a profile alone', () => {
      const { converted } = chatsToProfiles([
        { id: 'chat_1', promptId: 'prompt_1', profileId: 'chatprofile_9' },
      ])

      expect(converted).toBe(0)
    })
  })

  describe('storiesToProfiles', () => {
    it("moves a project's default across", () => {
      const { stories, converted } = storiesToProfiles([
        { id: 's1', options: { promptId: 'builtin_adventure', other: true } },
      ])

      expect(stories[0].options).toEqual({
        promptId: 'builtin_adventure',
        other: true,
        profileId: ADVENTURE_PROFILE_ID,
      })
      expect(converted).toBe(1)
    })

    it('leaves a project that named nothing alone', () => {
      const { stories, converted } = storiesToProfiles([{ id: 's1', options: {} }, { id: 's2' }])

      expect(stories[0].options).toEqual({})
      expect(converted).toBe(0)
    })
  })
})
