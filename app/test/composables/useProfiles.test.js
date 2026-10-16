import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProfiles } from '@/composables/useProfiles'
import { useApplicationState } from '@/composables/useApplicationState'
import {
  CHAT_PROFILE_ID,
  ROLEPLAY_PROFILE_ID,
  ROLEPLAY_NSFW_PROFILE_ID,
} from '@/ai/profiles/index.js'
import { DEFAULT_ROLEPLAY_PROMPT, DEFAULT_ROLEPLAY_NSFW_PROMPT } from '@/ai/prompts/index.js'

vi.mock('@/stores/db', () => ({ default: {} }))

describe('useProfiles', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useApplicationState().resetState()
    useApplicationState().setExtension('roleplay', true)
  })

  describe('with roleplay switched off', () => {
    beforeEach(() => useApplicationState().setExtension('roleplay', false))

    it('leaves the roleplay profiles out of the list', () => {
      const ids = useProfiles().profiles.value.map(profile => profile.id)
      expect(ids).not.toContain(ROLEPLAY_PROFILE_ID)
      expect(ids).not.toContain(ROLEPLAY_NSFW_PROFILE_ID)
    })

    it('still reads a chat on one as that one', () => {
      expect(useProfiles().getProfile(ROLEPLAY_PROFILE_ID)?.settings.prompt).toBe(
        DEFAULT_ROLEPLAY_PROMPT
      )
    })
  })

  describe('with NSFW profiles switched off', () => {
    it('leaves them out of the list', () => {
      const ids = useProfiles().profiles.value.map(profile => profile.id)
      expect(ids).toContain(ROLEPLAY_PROFILE_ID)
      expect(ids).not.toContain(ROLEPLAY_NSFW_PROFILE_ID)
    })

    it('reads a chat on one as its general counterpart', () => {
      const profile = useProfiles().getProfile(ROLEPLAY_NSFW_PROFILE_ID)
      expect(profile?.id).toBe(ROLEPLAY_PROFILE_ID)
      expect(profile?.settings.prompt).toBe(DEFAULT_ROLEPLAY_PROMPT)
    })
  })

  describe('with NSFW profiles switched on', () => {
    beforeEach(() => useApplicationState().setNsfwProfiles(true))

    it('lists them in place of their general counterparts', () => {
      const ids = useProfiles().profiles.value.map(profile => profile.id)
      expect(ids).not.toContain(ROLEPLAY_PROFILE_ID)
      expect(ids.indexOf(ROLEPLAY_NSFW_PROFILE_ID)).toBe(1)
    })

    it('reads a chat on one as that one', () => {
      expect(useProfiles().getProfile(ROLEPLAY_NSFW_PROFILE_ID)?.id).toBe(ROLEPLAY_NSFW_PROFILE_ID)
    })

    it('reads a chat on a general counterpart as the NSFW one', () => {
      const profile = useProfiles().getProfile(ROLEPLAY_PROFILE_ID)
      expect(profile?.id).toBe(ROLEPLAY_NSFW_PROFILE_ID)
      expect(profile?.settings.prompt).toBe(DEFAULT_ROLEPLAY_NSFW_PROMPT)
    })
  })

  describe('copies', () => {
    it("names a built-in's copy Custom, and one of the writer's own by number", () => {
      const profiles = useProfiles()
      const builtIn = profiles.getProfile(ROLEPLAY_PROFILE_ID)
      expect(profiles.copyName(builtIn)).toBe('Roleplay - Custom')

      const custom = profiles.saveProfile('Roleplay - Custom', { prompt: 'Stay.' })
      expect(profiles.copyName(builtIn)).toBe('Roleplay - Custom (2)')
      expect(profiles.copyName(custom)).toBe('Roleplay - Custom (2)')
    })
  })

  describe('where chats start', () => {
    it('starts chats on the profiles chosen in the settings while they are there', () => {
      const profiles = useProfiles()
      const mine = profiles.saveProfile('Default - Custom', { prompt: 'Plan.' })
      expect(profiles.chatDefaultId()).toBe(CHAT_PROFILE_ID)
      expect(profiles.roleplayDefaultId()).toBe(ROLEPLAY_PROFILE_ID)

      useApplicationState().setChatProfileId(mine.id)
      useApplicationState().setRoleplayProfileId('chatprofile_gone')
      expect(profiles.chatDefaultId()).toBe(mine.id)
      expect(profiles.roleplayDefaultId()).toBe(ROLEPLAY_PROFILE_ID)
    })
  })
})
