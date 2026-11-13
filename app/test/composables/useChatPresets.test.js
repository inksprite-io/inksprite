import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useApplicationState } from '@/composables/useApplicationState'
import { useAIPresetStore } from '@/stores/aiPresetStore'
import { useAIProvidersStore } from '@/stores/aiProvidersStore'
import { useChatProfileStore } from '@/stores/chatProfileStore'
import { CHAT_PROFILE_ID, ROLEPLAY_PROFILE_ID } from '@/ai/profiles/index.js'
import { DEFAULT_PRESET_ID } from '@/ai/defaults.js'

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

// The chats loaded in the store, and those kept elsewhere, in other projects.
const loaded = vi.hoisted(() => new Map())
const updateChat = vi.hoisted(() =>
  vi.fn((id, updates) => loaded.set(id, { ...loaded.get(id), ...updates }))
)
vi.mock('@/stores/chatsStore', () => ({
  useChatsStore: () => ({ chats: loaded, updateChat }),
}))
const kept = vi.hoisted(() => /** @type {any[]} */ ([]))
vi.mock('@/storage/index.js', () => ({
  storage: {
    // The stores start empty.
    all: vi.fn(async () => []),
    updateEach: vi.fn(async (table, change) => {
      let changed = 0
      for (const [at, row] of kept.entries()) {
        const changes = change(row)
        if (!changes) continue
        kept[at] = { ...row, ...changes }
        changed++
      }
      return changed
    }),
  },
}))
// A project whose chats start on a profile of the writer's own.
const stories = vi.hoisted(() => new Map())
vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: () => ({ getStory: id => stories.get(id) ?? null }),
}))

const { stampFor, stampChats, stampEveryChat, seedRecentModels } = await import(
  '@/composables/useChatPresets.js'
)

describe('giving chats the models they run on', () => {
  /**
   * A preset on a connection set up to run it: the stand-in server.
   * @param {string} id
   */
  const preset = id =>
    useAIPresetStore().createPreset({
      id,
      name: id,
      providerId: 'provider_box',
      model: `${id}_model`,
      isDefault: false,
    })
  /** What a chat on one of them is given: its model. */
  const on = id => ({ providerId: 'provider_box', model: `${id}_model` })

  beforeEach(async () => {
    setActivePinia(createPinia())
    useApplicationState().resetState()
    vi.clearAllMocks()
    loaded.clear()
    kept.length = 0
    stories.clear()
    await useAIPresetStore().ensureInitialized()
    await useChatProfileStore().ensureInitialized()
    await useAIProvidersStore().ensureInitialized()
    useAIProvidersStore().createProvider({
      id: 'provider_box',
      name: 'Box',
      type: 'generic',
      endpoint: 'http://box:1234/v1',
    })
    preset(DEFAULT_PRESET_ID)
    preset('preset_glm')
    preset('preset_chosen')
  })

  describe('stampFor', () => {
    it('gives one that names none the model its profile starts chats on', () => {
      const mine = useChatProfileStore().createProfile({
        name: 'On GLM',
        settings: { prompt: '', ...on('preset_glm') },
      })

      expect(stampFor({ id: 'c1', profileId: mine.id })).toEqual(on('preset_glm'))
    })

    it('gives one that named only its preset that preset’s model, and nothing to one with a model', () => {
      expect(stampFor({ id: 'c1', presetId: 'preset_glm' })).toEqual(on('preset_glm'))
      expect(stampFor({ id: 'c2', ...on('preset_glm') })).toBeNull()
    })

    it('leaves the model off where its connection isn’t set up, so setup moves the chat', () => {
      useAIProvidersStore().updateProvider('provider_box', { endpoint: '' })

      expect(stampFor({ id: 'c1', presetId: 'preset_glm' })).toBeNull()
    })

    it('reads one whose profile is gone as on its project’s', () => {
      const mine = useChatProfileStore().createProfile({
        name: 'On GLM',
        settings: { prompt: '', ...on('preset_glm') },
      })
      stories.set('s1', { id: 's1', options: { profileId: mine.id } })

      expect(stampFor({ id: 'c1', storyId: 's1', profileId: 'chatprofile_gone' })).toEqual(
        on('preset_glm')
      )
    })
  })

  describe('stampChats', () => {
    it('gives each loaded chat that names none the model it runs on, and leaves the rest', async () => {
      loaded.set('c1', { id: 'c1', profileId: CHAT_PROFILE_ID })
      loaded.set('c2', { id: 'c2', profileId: CHAT_PROFILE_ID, ...on('preset_glm') })

      expect(await stampChats([...loaded.values()])).toBe(1)

      expect(updateChat).toHaveBeenCalledTimes(1)
      expect(updateChat).toHaveBeenCalledWith('c1', on(DEFAULT_PRESET_ID))
    })
  })

  describe('stampEveryChat', () => {
    it('gives every chat on the device the model it runs on, loaded or kept, once', async () => {
      loaded.set('c1', { id: 'c1', profileId: CHAT_PROFILE_ID })
      kept.push(
        { id: 'c1', profileId: CHAT_PROFILE_ID },
        { id: 'c3', profileId: ROLEPLAY_PROFILE_ID },
        { id: 'c4', profileId: CHAT_PROFILE_ID, presetId: 'preset_glm' }
      )

      await stampEveryChat()

      expect(loaded.get('c1')).toMatchObject(on(DEFAULT_PRESET_ID))
      // One loaded is the store's to write: its row is left to it.
      expect(kept[0]).not.toHaveProperty('model')
      expect(kept[1]).toMatchObject(on(DEFAULT_PRESET_ID))
      expect(kept[2]).toMatchObject(on('preset_glm'))
      expect(useApplicationState().chatsStamped.value).toBe(true)

      kept.push({ id: 'c5', profileId: CHAT_PROFILE_ID })
      await stampEveryChat()
      expect(kept[3]).not.toHaveProperty('model')
    })

    it('gives a profile its old preset’s model, or the one chosen for chats before', async () => {
      useApplicationState().state.value.ai.activeChatProfileId = 'preset_chosen'
      useApplicationState().setBuiltInProfile(ROLEPLAY_PROFILE_ID, { presetId: 'preset_glm' })
      const mine = useChatProfileStore().createProfile({ name: 'Mine', settings: { prompt: '' } })
      kept.push({ id: 'c1', profileId: CHAT_PROFILE_ID })

      await stampEveryChat()

      const builtIns = useApplicationState().builtInProfiles.value
      expect(builtIns[CHAT_PROFILE_ID]).toMatchObject(on('preset_chosen'))
      expect(builtIns[ROLEPLAY_PROFILE_ID]).toMatchObject(on('preset_glm'))
      expect(useChatProfileStore().getProfile(mine.id).settings).toMatchObject(on('preset_chosen'))
      expect(kept[0]).toMatchObject(on('preset_chosen'))
    })

    it('leaves nothing on the profiles where none was chosen, or it was the built-in one', async () => {
      useApplicationState().state.value.ai.activeChatProfileId = DEFAULT_PRESET_ID

      await stampEveryChat()

      expect(useApplicationState().builtInProfiles.value).toEqual({})
    })

    it('makes the presets that share a model one, once the chats on them have their models', async () => {
      preset('preset_twin')
      useAIPresetStore().getPreset('preset_twin').model = 'preset_glm_model'
      kept.push({ id: 'c1', profileId: CHAT_PROFILE_ID, presetId: 'preset_twin' })

      await stampEveryChat()

      expect(kept[0]).toMatchObject(on('preset_glm'))
      expect(
        [
          useAIPresetStore().getPreset('preset_twin'),
          useAIPresetStore().getPreset('preset_glm'),
        ].filter(Boolean)
      ).toHaveLength(1)
    })
  })

  describe('seedRecentModels', () => {
    it('fills the model menu once, from the models tuned, latest first, then those profiles start on', async () => {
      useAIPresetStore().getPreset('preset_glm').updated = 3000
      useAIPresetStore().getPreset('preset_chosen').updated = 2000
      useAIPresetStore().getPreset(DEFAULT_PRESET_ID).updated = 1000
      useApplicationState().setBuiltInProfile(ROLEPLAY_PROFILE_ID, {
        providerId: 'provider_box',
        model: 'local_model',
      })

      await seedRecentModels()

      expect(useApplicationState().recentModels.value).toEqual([
        on('preset_glm'),
        on('preset_chosen'),
        on(DEFAULT_PRESET_ID),
        { providerId: 'provider_box', model: 'local_model' },
      ])
    })
  })
})
