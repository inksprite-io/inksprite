import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { decideExtensions, roleplayInUse } from '@/extensions/index.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { ROLEPLAY_NSFW_PROFILE_ID } from '@/ai/profiles/index.js'

/** What storage holds: how many library cards, and every chat. */
const held = { cards: 0, chats: [] }

vi.mock('@/storage/index.js', () => ({
  storage: {
    count: vi.fn(async table => (table === 'cards' ? held.cards : 0)),
    updateEach: vi.fn(async (table, change) => {
      let changed = 0
      for (const row of table === 'chats' ? held.chats : []) if (change({ ...row })) changed++
      return changed
    }),
  },
}))

describe('extensions', () => {
  beforeEach(() => {
    held.cards = 0
    held.chats = [{ id: 'chat_1', profileId: 'builtin_profile_chat' }]
    useApplicationState().resetState()
  })

  afterEach(() => useApplicationState().resetState())

  describe('roleplayInUse', () => {
    it('finds nothing in a copy of the app used for writing', async () => {
      expect(await roleplayInUse()).toBe(false)
    })

    it('finds cards in the library', async () => {
      held.cards = 2
      expect(await roleplayInUse()).toBe(true)
    })

    it('finds the NSFW switch on, or a profile chosen for character cards', async () => {
      useApplicationState().setNsfwProfiles(true)
      expect(await roleplayInUse()).toBe(true)

      useApplicationState().resetState()
      useApplicationState().setRoleplayProfileId('chatprofile_mine')
      expect(await roleplayInUse()).toBe(true)
    })

    it('finds a chat on a Roleplay profile, or one naming a character', async () => {
      held.chats.push({ id: 'chat_2', profileId: ROLEPLAY_NSFW_PROFILE_ID })
      expect(await roleplayInUse()).toBe(true)

      held.chats = [{ id: 'chat_3', profileId: 'chatprofile_mine', characterName: 'Elara' }]
      expect(await roleplayInUse()).toBe(true)
    })

    it('changes no chat in looking', async () => {
      const { storage } = await import('@/storage/index.js')
      await roleplayInUse()
      expect(await storage.updateEach.mock.results[0].value).toBe(0)
    })
  })

  describe('decideExtensions', () => {
    it('switches roleplay off for a writer who never used it', async () => {
      await decideExtensions()
      expect(useApplicationState().extensionOn('roleplay')).toBe(false)
    })

    it('switches roleplay on where it is in use', async () => {
      held.cards = 1
      await decideExtensions()
      expect(useApplicationState().extensionOn('roleplay')).toBe(true)
    })

    it('leaves a switch already decided as it is', async () => {
      useApplicationState().setExtension('roleplay', false)
      held.cards = 1
      await decideExtensions()
      expect(useApplicationState().extensionOn('roleplay')).toBe(false)
    })

    it('leaves it undecided when storage cannot be read, to decide next time', async () => {
      const { storage } = await import('@/storage/index.js')
      storage.count.mockRejectedValueOnce(new Error('closed'))
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})
      await decideExtensions()
      expect(useApplicationState().extensionOn('roleplay')).toBeUndefined()
      error.mockRestore()
    })
  })
})
