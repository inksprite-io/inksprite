import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Menu from 'primevue/menu'
import ChatTurn from '../../src/components/writer/chats/ChatTurn.vue'

const toastError = vi.fn()
vi.mock('@/composables/useToast.js', () => ({ useToast: () => ({ error: toastError }) }))

/** What the header reaches into a message for. */
const startEditing = vi.fn()

/**
 * The message, reduced to what the turn asks of it: the props it is handed and
 * the one method it exposes.
 */
const ChatMessage = {
  props: ['messageId', 'storyId', 'alone', 'raw', 'activity'],
  template:
    '<div class="message" :data-alone="alone" :data-raw="raw" :data-activity="activity?.phase" />',
  setup(_, { expose }) {
    expose({ startEditing })
  },
}

/** The read-aloud button, reduced to what the turn hands it. */
const ReadAloudButton = {
  props: ['storyId', 'speechKey', 'text', 'voiceId'],
  template:
    '<div class="read-aloud" :data-key="speechKey" :data-text="text" :data-voice="voiceId" />',
}

const message = (id, role, extra = {}) => ({
  id,
  chatId: 'chat_1',
  role,
  content: 'words',
  created: 1,
  ...extra,
})

const show = (messages, command = '', props = {}) =>
  mount(ChatTurn, {
    props: { messages, storyId: 'story_1', role: messages[0].role, command, ...props },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: { ChatMessage, ReadAloudButton },
    },
  })

/** The button drawn with an icon, or none. */
const button = (wrapper, icon) =>
  wrapper.findAll('button').find(each => each.find(`.pi-${icon}`).exists())

/** The ⋯ menu's item with an icon, or none. */
const item = (wrapper, icon) =>
  wrapper
    .findComponent(Menu)
    .props('model')
    .find(each => each.icon === `pi pi-${icon}`)

/** Choose an item from the ⋯ menu, the way PrimeVue calls it. */
const choose = async (wrapper, icon) => {
  item(wrapper, icon).command({})
  await wrapper.vm.$nextTick()
}

describe('ChatTurn', () => {
  beforeEach(() => startEditing.mockClear())

  it('tells the message the turn is writing into what it is doing, and no other', () => {
    const wrapper = show([message('m1', 'assistant'), message('m2', 'assistant')], '', {
      activity: { messageId: 'm2', phase: 'waiting' },
    })

    const [first, second] = wrapper.findAll('.message')
    expect(first.attributes('data-activity')).toBeUndefined()
    expect(second.attributes('data-activity')).toBe('waiting')
  })

  describe('other answers', () => {
    /** An assistant message that has been asked again, showing answer `at` of `of`. */
    const answered = (at, of) =>
      message('m1', 'assistant', {
        alternates: Array.from({ length: of }, () => ({})),
        alternate: at,
      })

    it('turns the last message between its answers', async () => {
      const wrapper = show([answered(1, 3)], '', { isLast: true })

      expect(wrapper.text()).toContain('2 / 3')
      await button(wrapper, 'chevron-left').trigger('click')
      await button(wrapper, 'chevron-right').trigger('click')
      expect(wrapper.emitted('alternate')).toEqual([
        ['m1', 0],
        ['m1', 2],
      ])
    })

    it('has nowhere to turn before the first answer, or after the last', () => {
      const first = show([answered(0, 2)], '', { isLast: true })
      expect(button(first, 'chevron-left').attributes('disabled')).toBeDefined()
      expect(button(first, 'chevron-right').attributes('disabled')).toBeUndefined()

      const last = show([answered(1, 2)], '', { isLast: true })
      expect(button(last, 'chevron-left').attributes('disabled')).toBeUndefined()
      expect(button(last, 'chevron-right').attributes('disabled')).toBeDefined()
    })

    it('offers them only on the last turn, and only when there are any', () => {
      // Everything after a message was written to the answer it was showing.
      expect(button(show([answered(0, 2)]), 'chevron-right')).toBeUndefined()
      // A message answered once has nothing to turn to.
      expect(
        button(show([message('m1', 'assistant')], '', { isLast: true }), 'chevron-right')
      ).toBeUndefined()
      expect(button(show([answered(0, 1)], '', { isLast: true }), 'chevron-right')).toBeUndefined()
    })
  })

  describe('reading aloud', () => {
    it('offers to read the turn, in the voice the chat reads in', () => {
      const wrapper = show([message('m1', 'assistant', { content: 'The door opened.' })], '', {
        voiceId: 'voice_riley',
      })
      const reader = wrapper.find('.read-aloud')
      expect(reader.attributes('data-key')).toBe('turn:m1')
      expect(reader.attributes('data-text')).toBe('The door opened.')
      expect(reader.attributes('data-voice')).toBe('voice_riley')
    })

    it('reads a turn taken in pieces as the one turn it is', () => {
      const wrapper = show([
        message('m1', 'user', { content: 'I open the door.' }),
        message('m2', 'user', { content: '  ' }),
        message('m3', 'user', { content: 'And step through.' }),
      ])
      expect(wrapper.findAll('.read-aloud')).toHaveLength(1)
      expect(wrapper.find('.read-aloud').attributes('data-text')).toBe(
        'I open the door.\n\nAnd step through.'
      )
    })

    it('leaves the voice to the project when the chat names none', () => {
      const wrapper = show([message('m1', 'assistant')])
      expect(wrapper.find('.read-aloud').attributes('data-voice')).toBeUndefined()
    })

    it('has nothing to offer a turn with no words', () => {
      const wrapper = show([message('m1', 'assistant', { content: '' })])
      expect(wrapper.find('.read-aloud').exists()).toBe(false)
    })
  })

  it('asks the message’s questions in its header when the turn is one message', () => {
    // A message's pieces float their own buttons over its corner, so the
    // message's cannot go there. The header is where "edit turn" is looked for.
    const wrapper = show([message('m1', 'user')])

    expect(item(wrapper, 'code')).toBeDefined()
    expect(button(wrapper, 'pencil')).toBeDefined()
    expect(item(wrapper, 'trash')).toBeDefined()
    expect(wrapper.find('.message').attributes('data-alone')).toBe('true')
  })

  it('leaves a message that shares its turn to speak for itself', () => {
    const wrapper = show([message('m1', 'user'), message('m2', 'user')])

    expect(item(wrapper, 'code')).toBeUndefined()
    expect(button(wrapper, 'pencil')).toBeUndefined()
    expect(item(wrapper, 'trash')).toBeUndefined()
    expect(wrapper.findAll('.message').map(each => each.attributes('data-alone'))).toEqual([
      'false',
      'false',
    ])
  })

  it('reaches into the message to edit it', async () => {
    const wrapper = show([message('m1', 'user')])

    await button(wrapper, 'pencil').trigger('click')

    expect(startEditing).toHaveBeenCalledTimes(1)
  })

  it('shows the one message as the model is sent it', async () => {
    const wrapper = show([message('m1', 'user')])
    expect(wrapper.find('.message').attributes('data-raw')).toBe('false')

    await choose(wrapper, 'code')

    expect(wrapper.find('.message').attributes('data-raw')).toBe('true')
  })

  it('deletes the turn through its one message', async () => {
    const wrapper = show([message('m1', 'user')])

    await choose(wrapper, 'trash')

    expect(wrapper.emitted('delete')).toEqual([['m1', null]])
  })

  it('offers to ask again only where the answer could differ', async () => {
    expect(button(show([message('m1', 'user')]), 'refresh')).toBeUndefined()

    const wrapper = show([message('m1', 'assistant')])
    await button(wrapper, 'refresh').trigger('click')

    expect(wrapper.emitted('regenerate')).toEqual([['m1', null]])
  })

  it('asks again for a roll that is the whole of the writer’s turn', async () => {
    // The piece is alone in its turn, so it floats no buttons of its own.
    const asked = { name: 'name', input: '', param: 'female', result: 'Ada Byrne' }
    const wrapper = show([
      message('m1', 'user', { segments: [{ type: 'command', command: asked }] }),
    ])

    await button(wrapper, 'refresh').trigger('click')

    expect(wrapper.emitted('regenerate')).toEqual([['m1', 0]])
  })

  it('has nothing to ask again of a direction that is the whole turn', () => {
    const asked = { name: 'director', input: 'Wrap it up', result: 'Wrap it up' }
    const wrapper = show([
      message('m1', 'user', { segments: [{ type: 'command', command: asked }] }),
    ])

    expect(button(wrapper, 'refresh')).toBeUndefined()
  })

  it('holds edit and ask-again while a summary is still being written', () => {
    const wrapper = show(
      [
        message('m1', 'assistant', {
          metadata: { command: { name: 'compact', input: '', pending: true } },
        }),
      ],
      'compact'
    )

    expect(button(wrapper, 'pencil').attributes('disabled')).toBeDefined()
    expect(button(wrapper, 'refresh').attributes('disabled')).toBeDefined()
  })

  describe('which model wrote it', () => {
    const model = (/** @type {any} */ wrapper) => wrapper.find('[data-test="turn-model"]')

    it('is named without whoever published it', () => {
      const wrapper = show([
        message('m1', 'assistant', { metadata: { model: 'z-ai/glm-5.3', provider: 'openrouter' } }),
      ])

      expect(model(wrapper).text()).toBe('glm-5.3')
    })

    it('is named as it stands when that is all there is', () => {
      const wrapper = show([message('m1', 'assistant', { metadata: { model: 'gpt-4' } })])

      expect(model(wrapper).text()).toBe('gpt-4')
    })

    it('is not mentioned on a turn nobody generated', () => {
      expect(model(show([message('m1', 'user')])).exists()).toBe(false)
      expect(model(show([message('m1', 'assistant')])).exists()).toBe(false)
    })
  })

  describe('copy', () => {
    it('puts the words of the whole turn on the clipboard', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      vi.stubGlobal('navigator', { clipboard: { writeText } })

      const wrapper = show([
        message('m1', 'assistant', { content: 'First.' }),
        message('m2', 'assistant', { content: ' Second. ' }),
      ])
      await button(wrapper, 'copy').trigger('click')

      expect(writeText).toHaveBeenCalledWith('First.\n\nSecond.')
      vi.unstubAllGlobals()
    })

    it('says so when the browser refuses', async () => {
      vi.stubGlobal('navigator', {
        clipboard: { writeText: vi.fn().mockRejectedValue(new Error('no')) },
      })
      vi.spyOn(console, 'error').mockImplementation(() => {})

      const wrapper = show([message('m1', 'user')])
      await button(wrapper, 'copy').trigger('click')
      await Promise.resolve()

      expect(toastError).toHaveBeenCalled()
      vi.unstubAllGlobals()
    })

    it('is not offered on a turn with no words', () => {
      expect(button(show([message('m1', 'assistant', { content: '' })]), 'copy')).toBeUndefined()
    })
  })

  describe('the ⋯ menu', () => {
    it('forks from the end of the turn', async () => {
      const wrapper = show([message('m1', 'assistant'), message('m2', 'assistant')])
      await choose(wrapper, 'share-alt')
      expect(wrapper.emitted('fork')).toEqual([['m2']])
    })

    it('rewinds to any turn but the last', async () => {
      const wrapper = show([message('m1', 'user')])
      await choose(wrapper, 'history')
      expect(wrapper.emitted('rewind')).toEqual([['m1']])
      expect(item(show([message('m1', 'user')], '', { isLast: true }), 'history')).toBeUndefined()
    })
  })

  describe('summarize up to here', () => {
    it('asks for a summary above the turn when one could go there', async () => {
      const wrapper = show([message('m1', 'user'), message('m2', 'user')], '', {
        summarizable: true,
      })
      await choose(wrapper, 'angle-double-up')

      expect(wrapper.emitted('summarize')).toEqual([['m1']])
    })

    it('is not offered where a summary would stand in for nothing', () => {
      expect(item(show([message('m1', 'user')]), 'angle-double-up')).toBeUndefined()
    })
  })
})

describe('ChatTurn header', () => {
  const actions = wrapper => wrapper.find('[data-turn-actions]')

  it('floats its hidden buttons over the end of the line on a wide screen', async () => {
    window.innerWidth = 1280
    const wrapper = show([message('m1', 'assistant')])
    await wrapper.vm.$nextTick()

    // In the line, they wrapped under a long one and left a line of nothing.
    expect(actions(wrapper).classes()).toContain('absolute')
    expect(actions(wrapper).classes()).toContain('opacity-0')
  })

  it('keeps them in the line on a phone, where they are always shown', async () => {
    window.innerWidth = 400
    const wrapper = show([message('m1', 'assistant')])
    await wrapper.vm.$nextTick()

    expect(actions(wrapper).classes()).not.toContain('absolute')
    window.innerWidth = 1024
  })
})

describe('ChatTurn for a screen reader', () => {
  it('names every button, the answer arrows among them', () => {
    const wrapper = show(
      [
        message('m1', 'assistant', {
          alternates: [{ content: 'a' }, { content: 'b' }],
          alternate: 1,
        }),
      ],
      '',
      { isLast: true }
    )

    expect(wrapper.find('[aria-label="Previous answer"]').exists()).toBe(true)
    const unnamed = wrapper
      .findAll('button')
      .filter(each => !each.attributes('aria-label') && !each.text().trim())
    expect(unnamed).toHaveLength(0)
  })
})
