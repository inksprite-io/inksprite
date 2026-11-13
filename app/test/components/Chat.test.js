/* global MouseEvent */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Chat from '@/components/writer/chats/Chat.vue'

/** The chat, its messages and what is in its box, as the chats API holds them. */
const chat = ref(/** @type {any} */ ({ id: 'chat_1' }))
const messages = ref(/** @type {any[]} */ ([]))
const draft = ref('')
vi.mock('@/composables/useChats', () => ({
  useChats: () => ({
    init: vi.fn(async () => {}),
    getChatById: () => chat.value,
    getMessagesForChat: () => messages,
    getMessageById: id => ({ value: messages.value.find(one => one.id === id) }),
    getDraftMessage: () => draft.value,
    setDraftMessage: (_id, value) => (draft.value = value),
    clearDraftMessage: () => (draft.value = ''),
    isUnstarted: () => false,
    startChat: vi.fn(),
  }),
}))

/** What the turn in hand says of itself: nothing running, and why nothing could. */
const configurationError = ref(/** @type {any} */ (null))
const runningPreset = vi.fn(() => /** @type {any} */ (null))
vi.mock('@/composables/useAIChat', () => ({
  useAIChat: () => ({
    isGenerating: ref(false),
    activity: ref(null),
    configurationError,
    runningPreset,
    sendMessage: vi.fn(),
    insertMessage: vi.fn(),
    stopGeneration: vi.fn(),
  }),
}))

/** Whether any of the writer's connections can answer a chat. */
const canChat = ref(true)
vi.mock('@/composables/useConnections.js', () => ({
  useConnections: () => ({ canChat }),
}))

/** The project's documents, as a link to one is suggested and written. */
const suggest = vi.fn()
vi.mock('@/composables/useDocumentLinks.js', () => ({
  useDocumentLinks: () => ({
    onClick: vi.fn(),
    suggest: (...args) => suggest(...args),
    chatLink: (href, words) => `[${words}](${href})`,
    chatPath: href => href,
  }),
}))

vi.mock('@/composables/useProfiles.js', () => ({
  useProfiles: () => ({ getProfile: () => null }),
}))
vi.mock('@/composables/useToast', () => ({ useToast: () => ({ error: vi.fn() }) }))
vi.mock('primevue/useconfirm', () => ({ useConfirm: () => ({ require: vi.fn() }) }))

/** A turn, reduced to whose it is, the voice it is read in, and what it asks of the chat. */
const ChatTurn = {
  name: 'ChatTurn',
  props: ['messages', 'role', 'voiceId'],
  emits: ['fix', 'voice-menu'],
  template: '<div data-turn-stub :data-role="role" :data-voice="voiceId" />',
}

/** The chips under the box, reduced to whose they are and the models being asked for. */
const showModels = vi.fn()
const ChatChips = {
  name: 'ChatChips',
  props: ['storyId', 'chatId'],
  template: '<div data-chat-chips :data-chat="chatId" />',
  methods: { showModels },
}

/** The voice menu, being asked to open. */
const showVoices = vi.fn()
const ChatVoiceMenu = {
  name: 'ChatVoiceMenu',
  props: ['storyId', 'chatId'],
  template: '<div />',
  methods: { show: showVoices },
}

const SetupWizard = { name: 'SetupWizard', template: '<div data-setup-wizard />' }
const ConnectionDialog = {
  name: 'ConnectionDialog',
  props: ['providerId'],
  template: '<div data-connection-dialog :data-provider="providerId" />',
}

const mountChat = async () => {
  const wrapper = mount(Chat, {
    props: { storyId: 'story_1', chatId: 'chat_1' },
    attachTo: document.body,
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: { ChatTurn, ChatChips, ChatVoiceMenu, SetupWizard, ConnectionDialog },
    },
  })
  await flushPromises()
  return wrapper
}

const box = wrapper => /** @type {HTMLTextAreaElement} */ (wrapper.find('textarea').element)

/** Type into the message box, the caret left after what was typed. */
const type = async (wrapper, text) => {
  const field = box(wrapper)
  field.focus()
  field.value = text
  field.setSelectionRange(text.length, text.length)
  await wrapper.find('textarea').trigger('input')
  await flushPromises()
}

const list = wrapper => wrapper.find('[data-link-suggestions]')
const titles = wrapper =>
  list(wrapper)
    .findAll('[role="option"]')
    .map(option => option.find('.truncate').text())

const documents = [
  { key: 'd1', title: 'Harbour', detail: 'Places', href: 'Places/Harbour.md' },
  { key: 'd2', title: 'Harvest', detail: '', href: 'Harvest.md' },
]
const folder = { key: 'f1', title: 'Places', detail: '', href: 'Places', folder: true }

describe('Chat', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chat.value = { id: 'chat_1' }
    messages.value = []
    draft.value = ''
    configurationError.value = null
    canChat.value = true
    runningPreset.mockReturnValue(null)
    // What a name could be: the documents, with a folder where folders are
    // asked for, and how long each is where that is.
    suggest.mockImplementation((_query, _from, options = {}) => [
      ...documents.map((one, index) => (options.words ? { ...one, words: 1200 + index } : one)),
      ...(options.folders ? [folder] : []),
    ])
  })
  afterEach(() => vi.restoreAllMocks())

  describe('under its message box', () => {
    it('has the chat’s chips, and no sliders button: its settings are the settings’', async () => {
      const wrapper = await mountChat()

      expect(wrapper.findComponent(ChatChips).props()).toMatchObject({
        storyId: 'story_1',
        chatId: 'chat_1',
      })
      expect(wrapper.find('.pi-sliders-h').exists()).toBe(false)
      expect(wrapper.find('[data-action="open-chat-settings"]').exists()).toBe(false)
      expect(wrapper.find('[aria-label="Chat settings"]').exists()).toBe(false)
      // What is in the row with the box is the way to send.
      expect(wrapper.find('[data-send] button').attributes('aria-label')).toBe('Send message')
    })
  })

  describe('with nobody to answer', () => {
    it('says nothing above the box while the chat can be answered', async () => {
      const wrapper = await mountChat()

      expect(wrapper.find('[data-action="setup-provider"]').exists()).toBe(false)
    })

    it('offers Choose a model, which opens the model chip’s popover with the click', async () => {
      configurationError.value = { name: 'ModelNotChosenError', message: 'No model is chosen.' }
      const wrapper = await mountChat()
      const fix = wrapper.find('[data-action="setup-provider"]')

      expect(wrapper.find('[role="status"]').text()).toContain('No model is chosen.')
      expect(fix.text()).toBe('Choose a model')

      await fix.trigger('click')

      expect(showModels).toHaveBeenCalledTimes(1)
      expect(showModels.mock.calls[0][0]).toBeInstanceOf(MouseEvent)
      expect(wrapper.find('[data-setup-wizard]').exists()).toBe(false)
      expect(wrapper.find('[data-connection-dialog]').exists()).toBe(false)
    })

    it('offers Choose a model for a chat whose connection was removed', async () => {
      configurationError.value = { name: 'ProviderNotConfiguredError', message: 'Gone.' }
      runningPreset.mockReturnValue({ providerId: 'provider_theirs', model: 'some-model' })
      const wrapper = await mountChat()

      expect(wrapper.find('[role="status"]').text()).toContain(
        "This chat's connection was removed."
      )
      await wrapper.find('[data-action="setup-provider"]').trigger('click')

      expect(showModels).toHaveBeenCalledTimes(1)
    })

    it('offers Connect, which opens setup, while no connection can chat', async () => {
      configurationError.value = { name: 'ProviderNotConfiguredError', message: 'Gone.' }
      canChat.value = false
      const wrapper = await mountChat()
      const fix = wrapper.find('[data-action="setup-provider"]')

      expect(wrapper.find('[role="status"]').text()).toContain('No AI provider is connected.')
      expect(fix.text()).toBe('Connect')

      await fix.trigger('click')

      expect(wrapper.find('[data-setup-wizard]').exists()).toBe(true)
      expect(showModels).not.toHaveBeenCalled()
    })

    it('offers Connect, which opens the chat’s connection, where it needs a key', async () => {
      configurationError.value = {
        name: 'ConnectionNeededError',
        message: 'Box needs a key.',
        providerId: 'provider_box',
      }
      const wrapper = await mountChat()
      const fix = wrapper.find('[data-action="setup-provider"]')

      expect(wrapper.find('[role="status"]').text()).toContain('Box needs a key.')
      expect(fix.text()).toBe('Connect')

      await fix.trigger('click')

      expect(wrapper.find('[data-connection-dialog]').attributes('data-provider')).toBe(
        'provider_box'
      )
      expect(showModels).not.toHaveBeenCalled()
    })
  })

  describe('a failed reply’s fix', () => {
    const exchange = () => [
      { id: 'm1', chatId: 'chat_1', role: 'user', content: 'Hello', created: 1 },
      { id: 'm2', chatId: 'chat_1', role: 'assistant', content: '', created: 2 },
    ]

    it('opens the model chip’s popover for another model', async () => {
      messages.value = exchange()
      const wrapper = await mountChat()
      const reply = wrapper.findAllComponents(ChatTurn).at(-1)

      reply.vm.$emit('fix', { kind: 'model', providerId: 'provider_box' })
      await flushPromises()

      // With no click to hand on: the chip stands in for where it was asked.
      expect(showModels).toHaveBeenCalledWith(undefined)
      expect(wrapper.find('[data-connection-dialog]').exists()).toBe(false)
    })

    it('opens the connection’s settings, or where its credits are bought, for the others', async () => {
      messages.value = exchange()
      const open = vi.spyOn(window, 'open').mockImplementation(() => null)
      const wrapper = await mountChat()
      const reply = wrapper.findAllComponents(ChatTurn).at(-1)

      reply.vm.$emit('fix', { kind: 'connection', providerId: 'provider_box' })
      await flushPromises()
      expect(wrapper.find('[data-connection-dialog]').attributes('data-provider')).toBe(
        'provider_box'
      )

      reply.vm.$emit('fix', {
        kind: 'credits',
        providerId: 'provider_box',
        url: 'https://example.test/credits',
      })
      expect(open).toHaveBeenCalledWith('https://example.test/credits', '_blank', 'noopener')
      expect(showModels).not.toHaveBeenCalled()
    })
  })

  describe('read aloud', () => {
    const exchange = () => [
      { id: 'm1', chatId: 'chat_1', role: 'user', content: 'Hello', created: 1 },
      { id: 'm2', chatId: 'chat_1', role: 'assistant', content: 'Hello back', created: 2 },
    ]
    const voices = wrapper =>
      Object.fromEntries(
        wrapper
          .findAll('[data-turn-stub]')
          .map(turn => [turn.attributes('data-role'), turn.attributes('data-voice')])
      )

    it('leaves both sides to the project’s voice while the chat names none', async () => {
      messages.value = exchange()

      expect(voices(await mountChat())).toEqual({ user: undefined, assistant: undefined })
    })

    it('reads the writer’s turns in the chat’s voice until they have one of their own', async () => {
      messages.value = exchange()
      chat.value = { id: 'chat_1', voiceId: 'voice_dry' }
      const wrapper = await mountChat()

      expect(voices(wrapper)).toEqual({ user: 'voice_dry', assistant: 'voice_dry' })

      chat.value = { id: 'chat_1', voiceId: 'voice_dry', userVoiceId: 'voice_bright' }
      await flushPromises()
      expect(voices(wrapper)).toEqual({ user: 'voice_bright', assistant: 'voice_dry' })
    })

    it('reads the writer’s turns in their voice where the chat has none', async () => {
      messages.value = exchange()
      chat.value = { id: 'chat_1', userVoiceId: 'voice_bright' }

      expect(voices(await mountChat())).toEqual({ user: 'voice_bright', assistant: undefined })
    })

    it('opens the voice menu for the side whose Read aloud was right-clicked', async () => {
      messages.value = exchange()
      const wrapper = await mountChat()
      const [theirs, reply] = wrapper.findAllComponents(ChatTurn)
      const click = new MouseEvent('contextmenu')

      reply.vm.$emit('voice-menu', click)
      expect(showVoices).toHaveBeenLastCalledWith(click, 'assistant')

      theirs.vm.$emit('voice-menu', click)
      expect(showVoices).toHaveBeenLastCalledWith(click, 'user')
      expect(wrapper.findComponent(ChatVoiceMenu).props()).toMatchObject({
        storyId: 'story_1',
        chatId: 'chat_1',
      })
    })
  })

  describe('the message box’s @ list', () => {
    it('lists the documents, and no folders, each with how long it is', async () => {
      const wrapper = await mountChat()

      await type(wrapper, 'Look at @Har')

      expect(suggest).toHaveBeenLastCalledWith('Har', '', { words: true })
      expect(titles(wrapper)).toEqual(['Harbour', 'Harvest'])
      expect(list(wrapper).find('.pi-folder').exists()).toBe(false)
      expect(list(wrapper).findAll('[role="option"]')[0].text()).toContain(
        `${(1200).toLocaleString()} words`
      )
      // The box says the list is its own, and which row the keys are on.
      const field = wrapper.find('textarea')
      expect(field.attributes('aria-controls')).toBe(list(wrapper).attributes('id'))
      expect(field.attributes('aria-activedescendant')).toBe(`${list(wrapper).attributes('id')}-0`)
    })

    it('opens on an @ alone, at the start of a word only', async () => {
      const wrapper = await mountChat()

      await type(wrapper, '@')
      expect(list(wrapper).exists()).toBe(true)
      expect(suggest).toHaveBeenLastCalledWith('', '', { words: true })

      await type(wrapper, 'write to someone@example')
      expect(list(wrapper).exists()).toBe(false)
    })

    it('attaches the one picked: its link, with the @ before it', async () => {
      const wrapper = await mountChat()
      await type(wrapper, 'Look at @Har')

      await list(wrapper).findAll('[role="option"]')[1].trigger('click')
      await flushPromises()

      expect(draft.value).toBe('Look at @[Harvest](/Harvest.md)')
      expect(list(wrapper).exists()).toBe(false)
      expect(box(wrapper).selectionStart).toBe(draft.value.length)
    })

    it('picks with the arrows and Enter, which sends nothing while the list is open', async () => {
      const wrapper = await mountChat()
      await type(wrapper, '@Har')
      const field = wrapper.find('textarea')

      await field.trigger('keydown', { key: 'ArrowDown' })
      expect(
        list(wrapper)
          .findAll('[role="option"]')
          .map(option => option.attributes('aria-selected'))
      ).toEqual(['false', 'true'])

      await field.trigger('keydown', { key: 'Enter' })
      await flushPromises()

      expect(draft.value).toBe('@[Harvest](/Harvest.md)')
      expect(wrapper.emitted('sent')).toBeUndefined()
    })

    it('is put away on Escape, until the @ is typed again', async () => {
      const wrapper = await mountChat()
      await type(wrapper, '@Har')

      await wrapper.find('textarea').trigger('keydown', { key: 'Escape' })
      expect(list(wrapper).exists()).toBe(false)

      await type(wrapper, '@Harb')
      expect(list(wrapper).exists()).toBe(false)

      await type(wrapper, 'Or @Har')
      expect(list(wrapper).exists()).toBe(true)
    })

    it('offers nothing to attach in a command, which takes a path, nor on to a heading', async () => {
      const wrapper = await mountChat()

      await type(wrapper, '/explore @Har')
      expect(list(wrapper).exists()).toBe(false)

      await type(wrapper, 'Look at @Harbour#mark')
      expect(list(wrapper).exists()).toBe(false)
      expect(suggest).not.toHaveBeenCalledWith(expect.anything(), '', { words: true })
    })
  })

  describe('the message box’s [[ list', () => {
    it('lists folders with the documents, and says how long none is', async () => {
      const wrapper = await mountChat()

      await type(wrapper, 'See [[Pl')

      expect(suggest).toHaveBeenLastCalledWith('Pl', '', { folders: true })
      expect(titles(wrapper)).toEqual(['Harbour', 'Harvest', 'Places'])
      expect(list(wrapper).findAll('[role="option"]')[2].find('.pi-folder').exists()).toBe(true)
      expect(list(wrapper).text()).not.toContain('words')
    })

    it('puts in a link to the folder picked, with no @', async () => {
      const wrapper = await mountChat()
      await type(wrapper, 'See [[Pl')

      await list(wrapper).findAll('[role="option"]')[2].trigger('click')
      await flushPromises()

      expect(draft.value).toBe('See [Places](/Places)')
    })

    it('puts in the path alone after a command', async () => {
      const wrapper = await mountChat()
      await type(wrapper, '/explore [[Pl')

      await list(wrapper).findAll('[role="option"]')[2].trigger('click')
      await flushPromises()

      expect(draft.value).toBe('/explore Places')
    })
  })
})
