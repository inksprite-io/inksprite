import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useChatSettings } from '@/composables/useChatSettings'
import { useProfiles } from '@/composables/useProfiles'
import { useApplicationState } from '@/composables/useApplicationState'
import { CHAT_PROFILE_ID, ROLEPLAY_PROFILE_ID } from '@/ai/profiles/index.js'
import { DEFAULT_CHAT_PROMPT, ROLEPLAY_COMPACTION_PROMPT } from '@/ai/prompts/index.js'
import { COMPACT_PROMPT } from '@/ai/skills/compact/index.js'

vi.mock('@/stores/db', () => ({
  default: {
    chatProfiles: { toArray: vi.fn().mockResolvedValue([]), filter: vi.fn(), bulkDelete: vi.fn() },
    aiProfiles: { toArray: vi.fn().mockResolvedValue([]) },
  },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

/** The chat being configured, as the mocked chats API holds it. */
const chat = ref(/** @type {any} */ ({}))
const updateChat = vi.fn((id, updates) => {
  chat.value = { ...chat.value, ...updates }
})

vi.mock('@/composables/useChats', () => ({
  useChats: () => ({
    getChatById: () => chat.value,
    updateChat,
    defaultProfileId: () => CHAT_PROFILE_ID,
    unstartedChat: ref({}),
    isUnstarted: () => false,
    updateUnstartedChat: vi.fn(),
  }),
}))
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({
    getProvider: () => null,
    presetFor: () => ({ providerId: 'p_or', model: 'sonnet', generationOverrides: {} }),
  }),
}))

const settings = () => useChatSettings('story_1', 'chat_1')
const mine = () => useProfiles().profiles.value.filter(one => !one.readOnly)

describe('useChatSettings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useApplicationState().resetState()
    updateChat.mockClear()
    chat.value = { id: 'chat_1', profileId: CHAT_PROFILE_ID }
  })

  describe('newProfile', () => {
    it("makes one of the writer's own from the chat's settings, under the name given", () => {
      chat.value = {
        ...chat.value,
        prompt: 'Answer as the ship.',
        rules: 'Short lines.',
        disabledToolGroups: ['rpg'],
        skills: { compact: { prompt: 'Keep everything.' } },
      }

      const made = settings().newProfile('  Ship  ')

      expect(made?.name).toBe('Ship')
      expect(mine().map(one => one.name)).toEqual(['Ship'])
      expect(made?.settings).toMatchObject({
        prompt: 'Answer as the ship.',
        rules: 'Short lines.',
        disabledToolGroups: ['rpg'],
        providerId: 'p_or',
        model: 'sonnet',
      })
      // Its wording of a skill goes with it.
      expect(made?.settings.skills).toEqual({ compact: { prompt: 'Keep everything.' } })
    })

    it('moves the chat onto it, reading its prompt from there', () => {
      chat.value = { ...chat.value, prompt: 'Answer as the ship.' }

      const made = settings().newProfile('Ship')

      expect(chat.value.profileId).toBe(made?.id)
      expect(chat.value.prompt).toBeUndefined()
      expect(settings().prompt.value).toBe('Answer as the ship.')
    })

    it('calls it New Profile without a name, and numbers a name already taken', () => {
      settings().newProfile('')
      settings().newProfile('New Profile')

      expect(mine().map(one => one.name)).toEqual(['New Profile', 'New Profile (2)'])
    })
  })

  describe('deleteProfile', () => {
    it('moves a chat on it back to the default', () => {
      const made = settings().newProfile('Ship')
      settings().deleteProfile(/** @type {string} */ (made?.id))

      expect(mine()).toEqual([])
      expect(chat.value.profileId).toBe(CHAT_PROFILE_ID)
      expect(settings().prompt.value).toBe(DEFAULT_CHAT_PROMPT)
    })

    it('leaves a built-in', () => {
      settings().deleteProfile(CHAT_PROFILE_ID)

      expect(useProfiles().getProfile(CHAT_PROFILE_ID)).not.toBeNull()
    })
  })

  describe('a skill’s wording', () => {
    it('is the profile’s: reworded for every chat on it, and no other profile’s', () => {
      const made = settings().newProfile('Ship')
      const chatSettings = settings()

      chatSettings.setSkillPrompt('compact', 'Keep the dialogue.')

      expect(chatSettings.skillPromptOf('compact')).toBe('Keep the dialogue.')
      expect(chatSettings.isSkillReworded('compact')).toBe(true)
      expect(useProfiles().getProfile(made?.id)?.settings.skills).toEqual({
        compact: { prompt: 'Keep the dialogue.' },
      })
      expect(useProfiles().getProfile(CHAT_PROFILE_ID)?.settings.skills).toBeUndefined()
    })

    it('goes back to the skill’s own when reset, the profile keeping none', () => {
      const chatSettings = settings()
      chatSettings.setSkillPrompt('compact', 'Keep the dialogue.')

      chatSettings.resetSkill('compact')

      expect(chatSettings.skillPromptOf('compact')).toBe(COMPACT_PROMPT)
      expect(chatSettings.isSkillReworded('compact')).toBe(false)
      expect(useProfiles().getProfile(CHAT_PROFILE_ID)?.settings.skills).toBeUndefined()
    })

    it('goes back to the wording a built-in profile ships with', () => {
      useApplicationState().setExtension('roleplay', true)
      chat.value = { ...chat.value, profileId: ROLEPLAY_PROFILE_ID }
      const chatSettings = settings()
      expect(chatSettings.isSkillReworded('compact')).toBe(false)

      chatSettings.setSkillPrompt('compact', 'Keep the dialogue.')
      expect(chatSettings.isSkillReworded('compact')).toBe(true)
      chatSettings.resetSkill('compact')

      expect(chatSettings.skillPromptOf('compact')).toBe(ROLEPLAY_COMPACTION_PROMPT)
      expect(chatSettings.isSkillReworded('compact')).toBe(false)
    })
  })

  describe('setToolsOn', () => {
    it("switches the chat's tools off, and its profile's next chats', keeping each switch", () => {
      chat.value = { ...chat.value, disabledToolGroups: ['rpg'] }
      const chatSettings = settings()

      chatSettings.setToolsOn(false)

      expect(chatSettings.toolsOn.value).toBe(false)
      expect(chat.value).toMatchObject({ toolsOff: true, disabledToolGroups: ['rpg'] })
      expect(useProfiles().getProfile(CHAT_PROFILE_ID)?.settings.toolsOff).toBe(true)
    })

    it('switches them back on as each was', () => {
      chat.value = { ...chat.value, toolsOff: true, disabledToolGroups: ['rpg'] }
      const chatSettings = settings()

      chatSettings.setToolsOn(true)

      expect(chatSettings.toolsOn.value).toBe(true)
      expect(chat.value.toolsOff).toBeUndefined()
      expect(chat.value.disabledToolGroups).toEqual(['rpg'])
      expect(useProfiles().getProfile(CHAT_PROFILE_ID)?.settings).not.toHaveProperty('toolsOff')
    })
  })
})
