import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useProfiles } from '@/composables/useProfiles'
import { useApplicationState } from '@/composables/useApplicationState'
import { useAIPresetStore } from '@/stores/aiPresetStore'
import { DEFAULT_PRESET_ID } from '@/ai/defaults.js'
import {
  CHAT_PROFILE_ID,
  ROLEPLAY_PROFILE_ID,
  ROLEPLAY_NSFW_PROFILE_ID,
} from '@/ai/profiles/index.js'
import {
  DEFAULT_CHAT_PROMPT,
  DEFAULT_ROLEPLAY_PROMPT,
  DEFAULT_ROLEPLAY_NSFW_PROMPT,
} from '@/ai/prompts/index.js'

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

  describe('the model a profile starts its chats on', () => {
    /** @param {string} id */
    const preset = id =>
      useAIPresetStore().createPreset({
        id,
        name: id,
        providerId: 'p',
        model: `${id}_model`,
        isDefault: false,
      })

    beforeEach(() => {
      preset(DEFAULT_PRESET_ID)
    })

    it('is none of its own for a profile never picked on, built-in or the writer’s own', () => {
      const profiles = useProfiles()
      const mine = profiles.saveProfile('Mine', { prompt: 'Plan.' })

      expect(profiles.getProfile(CHAT_PROFILE_ID)?.settings).not.toHaveProperty('model')
      expect(profiles.getProfile(mine.id)?.settings).not.toHaveProperty('model')
      expect(profiles.startingPresetId()).toBe(DEFAULT_PRESET_ID)
    })

    it('starts them on the preset chosen for chats before profiles kept their own, while it is here', () => {
      preset('preset_chosen')
      const state = useApplicationState().state.value
      state.ai.activeChatProfileId = 'preset_chosen'
      const profiles = useProfiles()

      expect(profiles.startingPresetId()).toBe('preset_chosen')

      state.ai.activeChatProfileId = 'preset_gone'
      expect(profiles.startingPresetId()).toBe(DEFAULT_PRESET_ID)
    })

    it('keeps a pick on a built-in beside it, and makes no copy of it', () => {
      const profiles = useProfiles()
      profiles.setProfileChoices(CHAT_PROFILE_ID, {
        providerId: 'p',
        model: 'glm',
        reasoningEffort: 'high',
      })

      const chat = profiles.getProfile(CHAT_PROFILE_ID)
      expect(chat?.settings).toMatchObject({
        prompt: DEFAULT_CHAT_PROMPT,
        providerId: 'p',
        model: 'glm',
        reasoningEffort: 'high',
      })
      expect(chat?.readOnly).toBe(true)
      expect(profiles.profiles.value.filter(one => !one.readOnly)).toEqual([])
    })

    it('keeps a pick on one of the writer’s own in its settings, with the rest', () => {
      const profiles = useProfiles()
      const mine = profiles.saveProfile('Mine', { prompt: 'Plan.' })
      profiles.setProfileChoices(mine.id, { providerId: 'p', model: 'glm', applyEdits: 'ask' })

      expect(profiles.getProfile(mine.id)?.settings).toEqual({
        prompt: 'Plan.',
        providerId: 'p',
        model: 'glm',
        applyEdits: 'ask',
      })
    })

    it('keeps the NSFW one’s apart from Roleplay’s', () => {
      const profiles = useProfiles()
      useApplicationState().setNsfwProfiles(true)
      profiles.setProfileChoices(ROLEPLAY_NSFW_PROFILE_ID, { providerId: 'p', model: 'local' })
      expect(profiles.getProfile(ROLEPLAY_PROFILE_ID)?.settings.model).toBe('local')

      useApplicationState().setNsfwProfiles(false)
      expect(profiles.getProfile(ROLEPLAY_PROFILE_ID)?.settings).not.toHaveProperty('model')
    })
  })
})
