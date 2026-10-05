import { describe, it, expect } from 'vitest'
import {
  BUILT_IN_PROFILES,
  CHAT_PROFILE_ID,
  ADVENTURE_PROFILE_ID,
  ROLEPLAY_PROFILE_ID,
  DEFAULT_PROFILE_ID,
  getBuiltInProfile,
  isBuiltInProfileId,
  settingsForNewChat,
  settingsForProfileSwitch,
} from '@/ai/profiles/index.js'
import { BUILT_IN_PROMPTS } from '@/ai/prompts/index.js'
import { TOOL_GROUP_LABELS } from '@/ai/tools/index.js'

describe('chat profiles', () => {
  describe('the built-ins', () => {
    it('carries a prompt of its own', () => {
      // The prompt belongs to the profile rather than to a library of its own:
      // a prompt without the tools it was written for is half an answer.
      const texts = BUILT_IN_PROMPTS.map(prompt => prompt.content)
      for (const profile of BUILT_IN_PROFILES) {
        expect(profile.settings.prompt).toBeTruthy()
        expect(texts).toContain(profile.settings.prompt)
      }
    })

    it('cannot be mistaken for a prompt or for a stored profile', () => {
      for (const profile of BUILT_IN_PROFILES) {
        expect(isBuiltInProfileId(profile.id)).toBe(true)
        expect(BUILT_IN_PROMPTS.map(p => p.id)).not.toContain(profile.id)
      }
      expect(isBuiltInProfileId('preset_abc123')).toBe(false)
      expect(isBuiltInProfileId(null)).toBe(false)
    })

    it('withholds every tool group from Roleplay', () => {
      const roleplay = getBuiltInProfile(ROLEPLAY_PROFILE_ID)

      // The ids are written out in the profile rather than imported, so this is
      // what keeps them honest: a renamed group would otherwise turn into a
      // profile that quietly offers the tools it means to withhold.
      expect(roleplay.settings.disabledToolGroups.sort()).toEqual(
        Object.keys(TOOL_GROUP_LABELS).sort()
      )
    })

    it('gives Roleplay standing rules and nothing else does', () => {
      // That it has them, not what they say. The rules are a tuning surface
      // like the prompts are, and pinning their wording would mean editing a
      // test every time they are reworded.
      expect(getBuiltInProfile(ROLEPLAY_PROFILE_ID).settings.rules).toBeTruthy()
      expect(getBuiltInProfile(CHAT_PROFILE_ID).settings.rules).toBeUndefined()
      expect(getBuiltInProfile(ADVENTURE_PROFILE_ID).settings.rules).toBeUndefined()
    })

    it('does not answer to an id it does not have', () => {
      expect(getBuiltInProfile('builtin_profile_nothing')).toBeNull()
      expect(getBuiltInProfile(undefined)).toBeNull()
    })
  })

  describe('what a new chat is stamped with', () => {
    it('names the profile and copies its settings', () => {
      const roleplay = getBuiltInProfile(ROLEPLAY_PROFILE_ID)

      expect(settingsForNewChat(roleplay)).toEqual({
        profileId: ROLEPLAY_PROFILE_ID,
        disabledToolGroups: roleplay.settings.disabledToolGroups,
        rules: roleplay.settings.rules,
      })
    })

    it("leaves the wording on the profile — its own and its skills'", () => {
      // Read every turn rather than copied, so a chat follows its profile's
      // words. Everything else is the chat's own from here.
      const stamped = settingsForNewChat(getBuiltInProfile(ROLEPLAY_PROFILE_ID))

      expect(stamped).not.toHaveProperty('prompt')
      expect(stamped).not.toHaveProperty('skills')
    })

    it('falls back to the default profile when handed nothing', () => {
      expect(settingsForNewChat(null).profileId).toBe(DEFAULT_PROFILE_ID)
      expect(settingsForNewChat(undefined).profileId).toBe(DEFAULT_PROFILE_ID)
    })

    it("names a profile of the writer's own as readily as a built-in", () => {
      const saved = { id: 'chatprofile_x', settings: { prompt: 'Be terse.' } }

      expect(settingsForNewChat(saved)).toEqual({ profileId: 'chatprofile_x' })
    })
  })

  describe('what a chat moved to a profile is stamped with', () => {
    it('takes off what the profile before set and this one does not', () => {
      const updates = settingsForProfileSwitch(getBuiltInProfile(CHAT_PROFILE_ID))

      expect(updates).toEqual({
        profileId: CHAT_PROFILE_ID,
        disabledTools: undefined,
        disabledToolGroups: undefined,
        projectContextEnabled: undefined,
        rules: undefined,
        // The chat's own choice of servers goes, so it follows the ones the
        // new profile is used with.
        mcpServers: undefined,
      })
    })

    it('stamps what the profile does set', () => {
      const roleplay = getBuiltInProfile(ROLEPLAY_PROFILE_ID)
      const updates = settingsForProfileSwitch(roleplay)

      expect(updates.disabledToolGroups).toEqual(roleplay.settings.disabledToolGroups)
      expect(updates.rules).toBe(roleplay.settings.rules)
      expect(updates).not.toHaveProperty('prompt')
    })
  })
})
