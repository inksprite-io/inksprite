/* global MouseEvent */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ChatVoiceMenu from '@/components/writer/chats/ChatVoiceMenu.vue'

/** The chat, and what the menu changes on it. */
const chat = ref(/** @type {any} */ ({}))
const update = vi.fn()
vi.mock('@/composables/useChatSettings', () => ({
  useChatSettings: () => ({ chat, update }),
}))

/** The project's voices, as Narration made them. */
const voices = ref([
  { id: 'voice_low', name: 'Low' },
  { id: 'voice_bright', name: 'Bright' },
  { id: 'voice_dry', name: 'Dry' },
])
const defaultVoiceId = ref('voice_low')
vi.mock('@/composables/useNarration', () => ({
  useNarration: () => ({
    voices,
    defaultVoiceId,
    voiceById: id => voices.value.find(voice => voice.id === id),
  }),
}))

const showTab = vi.fn()
vi.mock('@/composables/useSidebarTab.js', () => ({
  useSidebarTab: () => ({ show: showTab }),
}))

/** The menu itself, reduced to what it is given and being asked to open. */
const shown = vi.fn()
const ContextMenu = {
  name: 'ContextMenu',
  props: ['model'],
  template: '<div />',
  methods: { show: shown },
}

const mountMenu = () =>
  mount(ChatVoiceMenu, {
    props: { storyId: 'story_1', chatId: 'chat_1' },
    global: { plugins: [PrimeVue], stubs: { ContextMenu } },
  })

/** Open it for a turn, and hand back what it offers under Set voice. */
const openFor = async (wrapper, role) => {
  const click = new MouseEvent('contextmenu')
  wrapper.vm.show(click, role)
  await wrapper.vm.$nextTick()
  const model = wrapper.findComponent(ContextMenu).props('model')
  return { click, model, items: model[0].items }
}

/** The voice tinted as the one in use. */
const current = items => items.filter(item => item.class === 'chat-voice-current').map(i => i.label)

describe('ChatVoiceMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chat.value = {}
    defaultVoiceId.value = 'voice_low'
  })

  it('opens at the click, on Set voice: the project’s voices, then Narration settings…', async () => {
    const wrapper = mountMenu()
    const { click, model, items } = await openFor(wrapper, 'assistant')

    expect(shown).toHaveBeenCalledWith(click)
    expect(model.map(item => item.label)).toEqual(['Set voice'])
    expect(items.map(item => (item.separator ? '-' : item.label))).toEqual([
      'Low',
      'Bright',
      'Dry',
      '-',
      'Narration settings…',
    ])
  })

  it('tints the project’s default while the chat names no voice', async () => {
    defaultVoiceId.value = 'voice_bright'
    const { items } = await openFor(mountMenu(), 'assistant')

    expect(current(items)).toEqual(['Bright'])
  })

  it('sets the voice the assistant’s turns are read in from one of its turns', async () => {
    chat.value = { voiceId: 'voice_dry' }
    const { items } = await openFor(mountMenu(), 'assistant')

    expect(current(items)).toEqual(['Dry'])
    items.find(item => item.label === 'Bright').command()

    expect(update).toHaveBeenCalledWith({ voiceId: 'voice_bright' })
  })

  it('sets the writer’s own voice from one of their turns, which is the assistant’s until then', async () => {
    chat.value = { voiceId: 'voice_dry' }
    const wrapper = mountMenu()
    const first = await openFor(wrapper, 'user')

    expect(current(first.items)).toEqual(['Dry'])
    first.items.find(item => item.label === 'Bright').command()
    expect(update).toHaveBeenCalledWith({ userVoiceId: 'voice_bright' })

    chat.value = { voiceId: 'voice_dry', userVoiceId: 'voice_bright' }
    expect(current((await openFor(wrapper, 'user')).items)).toEqual(['Bright'])
    // The assistant's is still its own.
    expect(current((await openFor(wrapper, 'assistant')).items)).toEqual(['Dry'])
  })

  it('falls back from a voice that has been deleted', async () => {
    chat.value = { voiceId: 'voice_gone', userVoiceId: 'voice_gone_too' }
    const wrapper = mountMenu()

    expect(current((await openFor(wrapper, 'assistant')).items)).toEqual(['Low'])
    expect(current((await openFor(wrapper, 'user')).items)).toEqual(['Low'])
  })

  it('opens Narration from its last item', async () => {
    const { items } = await openFor(mountMenu(), 'assistant')

    items.at(-1).command()

    expect(showTab).toHaveBeenCalledWith('narration')
  })
})
