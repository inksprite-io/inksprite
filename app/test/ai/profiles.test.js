import { describe, it, expect } from 'vitest'
import {
  BUILT_IN_PROFILES,
  CHAT_PROFILE_ID,
  ROLEPLAY_PROFILE_ID,
  ROLEPLAY_NSFW_PROFILE_ID,
  BLANK_PROFILE_ID,
  DEFAULT_PROFILE_ID,
  getBuiltInProfile,
  isBuiltInProfileId,
  settingsForNewChat,
  settingsForProfileSwitch,
  noteOnProfile,
} from '@/ai/profiles/index.js'
import {
  BUILT_IN_PROMPTS,
  DEFAULT_ROLEPLAY_NOTE,
  DEFAULT_ROLEPLAY_NSFW_NOTE,
} from '@/ai/prompts/index.js'
import { TOOL_GROUP_LABELS } from '@/ai/tools/index.js'
import { WEB_GROUP } from '@/ai/tools/web.js'

/**
 * The groups a profile withholds by naming them. The web is not one: it is
 * opted into, as a server's tools are, so no profile has to withhold it.
 */
const WITHHELD_GROUPS = Object.keys(TOOL_GROUP_LABELS).filter(id => id !== WEB_GROUP)

describe('chat profiles', () => {
  describe('the built-ins', () => {
    it('carries a prompt of its own, all but Blank', () => {
      // The prompt belongs to the profile rather than to a library of its own:
      // a prompt without the tools it was written for is half an answer.
      const texts = BUILT_IN_PROMPTS.map(prompt => prompt.content)
      for (const profile of BUILT_IN_PROFILES.filter(p => p.id !== BLANK_PROFILE_ID)) {
        expect(profile.settings.prompt).toBeTruthy()
        expect(texts).toContain(profile.settings.prompt)
      }
    })

    it('puts nothing between the writer and the model on Blank', () => {
      const blank = getBuiltInProfile(BLANK_PROFILE_ID).settings

      expect(blank.prompt).toBe('')
      expect([...blank.disabledToolGroups].sort()).toEqual([...WITHHELD_GROUPS].sort())
      expect(blank.projectContextEnabled).toBe(false)
      expect(blank.rules).toBeUndefined()
    })

    it('stamps Blank onto a new chat with every tool and the project off', () => {
      const stamped = settingsForNewChat(getBuiltInProfile(BLANK_PROFILE_ID))

      expect(stamped).toMatchObject({
        profileId: BLANK_PROFILE_ID,
        disabledToolGroups: expect.arrayContaining(WITHHELD_GROUPS),
        projectContextEnabled: false,
      })
      expect(stamped).not.toHaveProperty('prompt')
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
      expect(roleplay.settings.disabledToolGroups.sort()).toEqual([...WITHHELD_GROUPS].sort())
    })

    it('gives the roleplay profiles standing rules and Default none', () => {
      // That they have them, not what they say. The rules are a tuning surface
      // like the prompts are, and pinning their wording would mean editing a
      // test every time they are reworded.
      expect(getBuiltInProfile(ROLEPLAY_PROFILE_ID).settings.rules).toBeTruthy()
      expect(getBuiltInProfile(ROLEPLAY_NSFW_PROFILE_ID).settings.rules).toBeTruthy()
      expect(getBuiltInProfile(CHAT_PROFILE_ID).settings.rules).toBeUndefined()
    })

    describe('Roleplay and Roleplay (NSFW)', () => {
      const roleplay = getBuiltInProfile(ROLEPLAY_PROFILE_ID)
      const nsfw = getBuiltInProfile(ROLEPLAY_NSFW_PROFILE_ID)

      it('run the same way, and differ only in their words', () => {
        const { prompt: _p, rules: _r, ...plain } = roleplay.settings
        const { prompt: _np, rules: _nr, ...explicit } = nsfw.settings
        expect(explicit).toEqual(plain)
      })

      it('each carry a prompt of their own', () => {
        expect(nsfw.settings.prompt).toBeTruthy()
        expect(nsfw.settings.prompt).not.toBe(roleplay.settings.prompt)
      })

      it('keeps the opt-ins out of Roleplay, prompt and note alike', () => {
        for (const text of [roleplay.settings.prompt, roleplay.settings.rules]) {
          expect(text).not.toMatch(/opted into/i)
          expect(text).not.toMatch(/sexual/i)
        }
        expect(nsfw.settings.rules).toMatch(/opted into/i)
      })
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

  describe("the author's note a chat runs with", () => {
    const roleplay = getBuiltInProfile(ROLEPLAY_PROFILE_ID)
    const nsfw = getBuiltInProfile(ROLEPLAY_NSFW_PROFILE_ID)

    it("reads Roleplay's note as the NSFW one's once the switch puts it on that", () => {
      // A chat started on Roleplay before the switch was turned on: the prompt
      // follows on its next turn, and the opt-ins in the note have to as well.
      expect(noteOnProfile(DEFAULT_ROLEPLAY_NOTE, nsfw)).toBe(DEFAULT_ROLEPLAY_NSFW_NOTE)
    })

    it("reads the NSFW one's note as Roleplay's once the switch is turned off", () => {
      expect(noteOnProfile(DEFAULT_ROLEPLAY_NSFW_NOTE, roleplay)).toBe(DEFAULT_ROLEPLAY_NOTE)
    })

    it('keeps the note the profile itself stamped', () => {
      expect(noteOnProfile(DEFAULT_ROLEPLAY_NSFW_NOTE, nsfw)).toBe(DEFAULT_ROLEPLAY_NSFW_NOTE)
      expect(noteOnProfile(DEFAULT_ROLEPLAY_NOTE, roleplay)).toBe(DEFAULT_ROLEPLAY_NOTE)
    })

    it('keeps one the writer has changed', () => {
      const edited = `${DEFAULT_ROLEPLAY_NOTE}\nKeep it to two paragraphs.`

      expect(noteOnProfile(edited, nsfw)).toBe(edited)
    })

    it('keeps none as none', () => {
      expect(noteOnProfile(undefined, nsfw)).toBeUndefined()
    })

    it('leaves a profile without a counterpart alone', () => {
      const saved = { id: 'chatprofile_x', settings: { prompt: 'Be terse.' } }

      expect(noteOnProfile(DEFAULT_ROLEPLAY_NOTE, getBuiltInProfile(CHAT_PROFILE_ID))).toBe(
        DEFAULT_ROLEPLAY_NOTE
      )
      expect(noteOnProfile(DEFAULT_ROLEPLAY_NOTE, saved)).toBe(DEFAULT_ROLEPLAY_NOTE)
    })
  })
})
