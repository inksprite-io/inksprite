import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePrompts } from '@/composables/usePrompts'
import { useAIPromptStore } from '@/stores/aiPromptStore'
import {
  DEFAULT_CHAT_PROMPT,
  DEFAULT_ADVENTURE_PROMPT,
  DEFAULT_ROLEPLAY_PROMPT,
} from '@/ai/prompts/index.js'

vi.mock('@/stores/db', () => ({
  default: {
    aiPrompts: {
      toArray: vi.fn().mockResolvedValue([]),
      filter: vi.fn(),
      bulkDelete: vi.fn(),
    },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

describe('usePrompts', () => {
  /** @type {ReturnType<typeof usePrompts>} */
  let prompts

  beforeEach(async () => {
    setActivePinia(createPinia())
    prompts = usePrompts()
    await useAIPromptStore().ensureInitialized()
  })

  describe('the library', () => {
    it('should list the built-in prompts', () => {
      expect(prompts.prompts.value).toEqual([
        { id: 'builtin_chat', name: 'Chat', content: DEFAULT_CHAT_PROMPT, readOnly: true },
        {
          id: 'builtin_adventure',
          name: 'Adventure',
          content: DEFAULT_ADVENTURE_PROMPT,
          readOnly: true,
        },
        {
          id: 'builtin_roleplay',
          name: 'Roleplay',
          content: DEFAULT_ROLEPLAY_PROMPT,
          readOnly: true,
        },
      ])
    })

    it('should list saved prompts after the built-ins', () => {
      prompts.savePrompt('Editor', 'Be terse.')

      // Built-ins lead so their position stays put as saved prompts come and go.
      expect(prompts.prompts.value.map(p => p.name)).toEqual([
        'Chat',
        'Adventure',
        'Roleplay',
        'Editor',
      ])
      expect(prompts.prompts.value.at(-1).readOnly).toBe(false)
    })

    it('should look up prompts from either half', () => {
      const saved = prompts.savePrompt('Editor', 'Be terse.')

      expect(prompts.getPrompt('builtin_chat').content).toBe(DEFAULT_CHAT_PROMPT)
      expect(prompts.getPrompt(saved.id).content).toBe('Be terse.')
      expect(prompts.getPrompt('prompt_missing')).toBeNull()
    })
  })

  describe('duplicatePrompt', () => {
    it('should copy a prompt under a "copy" name', () => {
      const copy = prompts.duplicatePrompt('builtin_chat')

      expect(copy).toMatchObject({
        name: 'Chat copy',
        content: DEFAULT_CHAT_PROMPT,
        readOnly: false,
      })
      expect(prompts.getPrompt(copy.id)).toEqual(copy)
    })

    it('should take text of its own, which is how a built-in gets edited', () => {
      const copy = prompts.duplicatePrompt('builtin_adventure', 'Run a heist.')

      expect(copy.content).toBe('Run a heist.')
      expect(prompts.getPrompt('builtin_adventure').content).toBe(DEFAULT_ADVENTURE_PROMPT)
    })

    it('should return null for a prompt that no longer exists', () => {
      expect(prompts.duplicatePrompt('prompt_missing')).toBeNull()
    })
  })

  describe('ready', () => {
    it('should resolve once the saved prompts are loaded', async () => {
      const db = (await import('@/stores/db')).default
      db.aiPrompts.toArray.mockResolvedValueOnce([
        { id: 'prompt_1', name: 'Editor', content: 'Be terse.', deleted: false },
      ])
      setActivePinia(createPinia())
      const library = usePrompts()

      // Built-ins are there from the start; what the user saved is not.
      expect(library.getPrompt('builtin_chat')).not.toBeNull()
      expect(library.getPrompt('prompt_1')).toBeNull()

      await library.ready()

      expect(library.getPrompt('prompt_1')?.content).toBe('Be terse.')
    })
  })

  describe('editing', () => {
    it('should update a saved prompt', () => {
      const saved = prompts.savePrompt('Editor', 'Be terse.')

      prompts.updatePrompt(saved.id, { content: 'Be very terse.', name: 'Terse Editor' })

      expect(prompts.getPrompt(saved.id)).toMatchObject({
        name: 'Terse Editor',
        content: 'Be very terse.',
      })
    })

    it('should refuse to edit a built-in', () => {
      // Built-ins live in source, so an edit here would be silently discarded
      // on the next app update — better to refuse it outright.
      expect(prompts.updatePrompt('builtin_chat', { content: 'Hijacked.' })).toBeNull()
      expect(prompts.getPrompt('builtin_chat').content).toBe(DEFAULT_CHAT_PROMPT)
    })

    it('should delete a saved prompt', () => {
      const saved = prompts.savePrompt('Editor', 'Be terse.')

      expect(prompts.deletePrompt(saved.id)).toBe(true)
      expect(prompts.getPrompt(saved.id)).toBeNull()
    })

    it('should refuse to delete a built-in', () => {
      expect(prompts.deletePrompt('builtin_adventure')).toBe(false)
      expect(prompts.getPrompt('builtin_adventure')).not.toBeNull()
    })
  })
})
