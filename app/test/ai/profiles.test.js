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
  keptOpeningOf,
  settingsForProfileSwitch,
  noteOnProfile,
} from '@/ai/profiles/index.js'
import {
  BUILT_IN_PROMPTS,
  DEFAULT_ROLEPLAY_NOTE,
  DEFAULT_ROLEPLAY_NSFW_NOTE,
} from '@/ai/prompts/index.js'
import { TOOL_GROUP_LABELS } from '@/ai/tools/index.js'
import { groupOn } from '@/ai/tools/choice.js'
import { serverGroup } from '@/mcp/names.js'

/** Every group there is now, and one added later: a server's. */
const GROUPS = [...Object.keys(TOOL_GROUP_LABELS), serverGroup('mcp_later')]

/** The groups a profile's chats have on. */
const onIn = settings => GROUPS.filter(group => groupOn(settings, group))

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

    it('puts nothing between the writer and the model on Blank, whatever is added', () => {
      const blank = getBuiltInProfile(BLANK_PROFILE_ID).settings

      expect(blank.prompt).toBe('')
      expect(onIn(blank)).toEqual([])
      expect(blank.rules).toBeUndefined()
    })

    it('stamps Blank onto a new chat with every tool off', () => {
      const stamped = settingsForNewChat(getBuiltInProfile(BLANK_PROFILE_ID))

      expect(stamped.profileId).toBe(BLANK_PROFILE_ID)
      expect(onIn(stamped)).toEqual([])
      expect(stamped).not.toHaveProperty('prompt')
    })

    it('leaves the groups off that an app from before reads, on Blank and Roleplay', () => {
      // An older app knows nothing of the groups a profile offers, and reads
      // only the ones it has off.
      expect(getBuiltInProfile(BLANK_PROFILE_ID).settings.disabledToolGroups).toEqual(
        expect.arrayContaining(['documents', 'rpg', 'skills', 'experimental'])
      )
      expect(getBuiltInProfile(ROLEPLAY_PROFILE_ID).settings.disabledToolGroups).toEqual(
        expect.arrayContaining(['rpg', 'skills', 'experimental'])
      )
    })

    it('cannot be mistaken for a prompt or for a stored profile', () => {
      for (const profile of BUILT_IN_PROFILES) {
        expect(isBuiltInProfileId(profile.id)).toBe(true)
        expect(BUILT_IN_PROMPTS.map(p => p.id)).not.toContain(profile.id)
      }
      expect(isBuiltInProfileId('preset_abc123')).toBe(false)
      expect(isBuiltInProfileId(null)).toBe(false)
    })

    it('offers Roleplay the documents and nothing else, whatever is added', () => {
      const roleplay = getBuiltInProfile(ROLEPLAY_PROFILE_ID)

      // The ids are written out in the profile rather than imported, so this is
      // what keeps them honest: a renamed group would otherwise turn into a
      // profile that quietly offers the tools it means to withhold.
      expect(onIn(roleplay.settings)).toEqual(['documents'])
    })

    it('offers Default every group, one added later among them', () => {
      expect(onIn(getBuiltInProfile(CHAT_PROFILE_ID).settings)).toEqual(GROUPS)
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
        onlyToolGroups: roleplay.settings.onlyToolGroups,
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

    it('keeps a longer opening on the roleplay profiles, read from them and never copied', () => {
      expect(keptOpeningOf(getBuiltInProfile(ROLEPLAY_PROFILE_ID))).toBe(2)
      expect(keptOpeningOf(getBuiltInProfile(ROLEPLAY_NSFW_PROFILE_ID))).toBe(2)
      expect(keptOpeningOf(getBuiltInProfile(CHAT_PROFILE_ID))).toBe(1)
      expect(keptOpeningOf(null)).toBe(1)
      expect(settingsForNewChat(getBuiltInProfile(ROLEPLAY_PROFILE_ID))).not.toHaveProperty(
        'keptOpening'
      )
    })

    it('copies the model, effort and edits, which the chat keeps, but not the words', () => {
      const saved = {
        id: 'chatprofile_x',
        settings: {
          prompt: 'Be terse.',
          providerId: 'p_or',
          model: 'glm',
          // From before: no further than the profile.
          presetId: 'profile_glm',
          reasoningEffort: 'high',
          applyEdits: 'ask',
        },
      }

      expect(settingsForNewChat(saved)).toEqual({
        profileId: 'chatprofile_x',
        providerId: 'p_or',
        model: 'glm',
        reasoningEffort: 'high',
        applyEdits: 'ask',
      })
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
        // Off a profile that offers only some, onto one that offers every group.
        onlyToolGroups: undefined,
        rules: undefined,
        // What chats chose before their tools said goes too.
        mcpServers: undefined,
        web: undefined,
        python: undefined,
      })
      expect(Object.keys(updates)).toContain('onlyToolGroups')
    })

    it('stamps what the profile does set', () => {
      const roleplay = getBuiltInProfile(ROLEPLAY_PROFILE_ID)
      const updates = settingsForProfileSwitch(roleplay)

      expect(updates.disabledToolGroups).toEqual(roleplay.settings.disabledToolGroups)
      expect(updates.onlyToolGroups).toEqual(['documents'])
      expect(updates.rules).toBe(roleplay.settings.rules)
      // The chat's own wording is taken off, so it reads the profile's.
      expect(updates.prompt).toBeUndefined()
      expect(updates.skills).toBeUndefined()
    })

    it("moves the chat to the model the profile's chats start on, its effort and edits too", () => {
      const saved = {
        id: 'chatprofile_x',
        settings: { prompt: '', providerId: 'p_or', model: 'glm' },
      }
      const updates = settingsForProfileSwitch(saved)

      expect(updates).toMatchObject({
        profileId: 'chatprofile_x',
        providerId: 'p_or',
        model: 'glm',
      })
      // What it does not set is taken off, as it would be on a new chat.
      expect(updates).toHaveProperty('reasoningEffort', undefined)
      expect(updates).toHaveProperty('applyEdits', undefined)
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
