import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import ModelsSection from '@/components/writer/settings/ModelsSection.vue'

/** What the chat showing runs on, as its settings have it. */
const preset = ref(/** @type {any} */ ({ providerId: 'p_or', model: 'sonnet' }))
const setModel = vi.fn()
/** What the section asked the chat's settings for. */
const asked = vi.fn()
vi.mock('@/composables/useChatSettings', () => ({
  useChatSettings: (storyId, chatId) => {
    asked(storyId, chatId())
    return { preset, setModel }
  },
}))

const ModelPicker = {
  name: 'ModelPicker',
  props: ['providerId', 'model', 'tint'],
  emits: ['update:choice', 'use'],
  template: '<div data-model-picker />',
}

const mountSection = (props = {}) =>
  mount(ModelsSection, { props, global: { stubs: { ModelPicker } } })

const picker = wrapper => wrapper.findComponent(ModelPicker)

describe('ModelsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    preset.value = { providerId: 'p_or', model: 'sonnet' }
  })

  describe('with a chat showing', () => {
    const mountForChat = () => mountSection({ storyId: 'story_1', chatId: 'chat_1' })

    it('marks the chat’s model as the one in use', () => {
      const wrapper = mountForChat()

      expect(asked).toHaveBeenCalledWith('story_1', 'chat_1')
      expect(picker(wrapper).props()).toMatchObject({
        providerId: 'p_or',
        model: 'sonnet',
        tint: true,
      })
    })

    it('runs the chat on the model clicked', async () => {
      const wrapper = mountForChat()

      await picker(wrapper).vm.$emit('update:choice', { providerId: 'p_box', model: 'local' })

      expect(setModel).toHaveBeenCalledWith('p_box', 'local')
      // Marked once the chat is on it, not before.
      expect(picker(wrapper).props('model')).toBe('sonnet')
      preset.value = { providerId: 'p_box', model: 'local' }
      await wrapper.vm.$nextTick()
      expect(picker(wrapper).props()).toMatchObject({ providerId: 'p_box', model: 'local' })
    })

    it('does the same for one clicked twice', async () => {
      const wrapper = mountForChat()
      await picker(wrapper).vm.$emit('use', { providerId: 'p_box', model: 'local' })
      expect(setModel).toHaveBeenCalledWith('p_box', 'local')
    })

    it('leaves the chat as it is for a choice that names no model', async () => {
      const wrapper = mountForChat()
      await picker(wrapper).vm.$emit('update:choice', { providerId: 'p_box', model: null })
      expect(setModel).not.toHaveBeenCalled()
    })

    it('marks none for a chat with no model to run on yet', () => {
      preset.value = null
      expect(picker(mountForChat()).props()).toMatchObject({ providerId: null, model: null })
    })
  })

  describe('without a chat', () => {
    it('marks none, and tints none as in use', () => {
      const wrapper = mountSection()

      expect(picker(wrapper).props()).toMatchObject({ providerId: null, model: null, tint: false })
    })

    it('only marks the model clicked, running no chat on it', async () => {
      const wrapper = mountSection()

      await picker(wrapper).vm.$emit('update:choice', { providerId: 'p_box', model: 'local' })

      expect(setModel).not.toHaveBeenCalled()
      expect(picker(wrapper).props()).toMatchObject({
        providerId: 'p_box',
        model: 'local',
        tint: false,
      })
    })
  })
})
