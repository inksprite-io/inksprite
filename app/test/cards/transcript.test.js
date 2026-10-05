import { describe, it, expect } from 'vitest'
import { isTranscript, readTranscript } from '@/cards/transcript.js'

/** A chat file, from its lines. */
const file = (...rows) => rows.map(row => JSON.stringify(row)).join('\n')

const HEADER = {
  chat_metadata: { note_prompt: '', note_depth: 4 },
  user_name: 'unused',
  character_name: 'unused',
}

const elara = (mes, more = {}) => ({
  name: 'Elara',
  is_user: false,
  send_date: '2026-09-19T05:54:14.699Z',
  mes,
  extra: {},
  ...more,
})

const sam = (mes, more = {}) => ({
  name: 'Sam',
  is_user: true,
  is_system: false,
  send_date: '2026-09-19T05:52:36.019Z',
  mes,
  extra: {},
  ...more,
})

describe('cards/transcript', () => {
  describe('isTranscript', () => {
    it('knows a chat by its header', () => {
      expect(isTranscript(file(HEADER, elara('Well?')))).toBe(true)
    })

    it('knows an old one by its names, and a headerless one by its first message', () => {
      expect(isTranscript(file({ user_name: 'Sam', character_name: 'Elara' }))).toBe(true)
      expect(isTranscript(file(elara('Well?')))).toBe(true)
    })

    it("says no to a chat file of the app's own, however it was written out", () => {
      const backup = { app: 'inksprite', scope: 'chat', tables: { chats: [], messages: [] } }

      expect(isTranscript(JSON.stringify(backup))).toBe(false)
      expect(isTranscript(JSON.stringify(backup, null, 2))).toBe(false)
    })

    it('says no to something that is not JSON at all', () => {
      expect(isTranscript('')).toBe(false)
      expect(isTranscript('Dear diary,')).toBe(false)
      expect(isTranscript('[1, 2, 3]')).toBe(false)
    })
  })

  describe('readTranscript', () => {
    it('reads who said what, in order', () => {
      const read = readTranscript(file(HEADER, elara('Well?'), sam('Hello.'), elara('Hm.')))

      expect(read.messages.map(message => [message.role, message.content])).toEqual([
        ['assistant', 'Well?'],
        ['user', 'Hello.'],
        ['assistant', 'Hm.'],
      ])
    })

    it('says who the chat was with by the name on their messages', () => {
      const read = readTranscript(file(HEADER, elara('Well?'), sam('Hello.')))

      expect(read.character).toBe('Elara')
      expect(read.user).toBe('Sam')
    })

    it('takes the names from the header when it still holds them', () => {
      const header = { user_name: 'Sam', character_name: 'Elara' }
      const read = readTranscript(file(header, { ...elara('Well?'), name: 'Narrator' }))

      expect(read.character).toBe('Elara')
    })

    it('is not thrown by a narrator speaking once', () => {
      const aside = { ...elara('Night falls.'), name: 'Narrator' }
      const read = readTranscript(file(HEADER, elara('Well?'), aside, elara('Hm.')))

      expect(read.character).toBe('Elara')
    })

    it('takes its title from the file, without the timestamp', () => {
      const text = file(HEADER, elara('Well?'))

      expect(readTranscript(text, 'Elara - 2026-01-05@21h14m03s512ms.jsonl').title).toBe('Elara')
      expect(
        readTranscript(text, 'Elara - 2026-01-05@21h14m03s512ms - Branch #4.jsonl').title
      ).toBe('Elara - Branch #4')
      expect(readTranscript(text, 'Elara - 2023-7-19 @14h 05m 33s 123ms.jsonl').title).toBe('Elara')
      expect(readTranscript(text, 'The long road north.jsonl').title).toBe('The long road north')
    })

    it('falls back on the character for a title', () => {
      expect(readTranscript(file(HEADER, elara('Well?'))).title).toBe('Elara')
    })

    it("carries the Author's Note", () => {
      const header = { ...HEADER, chat_metadata: { note_prompt: ' [Slow burn.] ' } }

      expect(readTranscript(file(header, elara('Well?'))).note).toBe('[Slow burn.]')
      expect(readTranscript(file(HEADER, elara('Well?'))).note).toBe('')
    })

    it("leaves the Author's Note behind when the chat had it switched off", () => {
      // Zero is ST's off switch: the text is kept and never sent.
      const header = {
        ...HEADER,
        chat_metadata: { note_prompt: '[Slow burn.]', note_interval: 0 },
      }

      expect(readTranscript(file(header, elara('Well?'))).note).toBe('')
    })

    it('leaves out a message with nothing in it', () => {
      const read = readTranscript(file(HEADER, elara('Well?'), sam('  '), elara('Hm.')))

      expect(read.messages).toHaveLength(2)
    })

    it('throws when nobody said anything', () => {
      expect(() => readTranscript(file(HEADER))).toThrow('no messages')
    })

    it('skips a line that is not JSON rather than giving up on the file', () => {
      const text = `${file(HEADER, elara('Well?'))}\n{"name": "Sam", "is_us\n${file(sam('Hello.'))}`

      expect(readTranscript(text).messages).toHaveLength(2)
    })

    it('brings a hidden message in as what it was before it was hidden', () => {
      const read = readTranscript(file(HEADER, elara('Well?', { is_system: true })))

      expect(read.messages[0].role).toBe('assistant')
    })

    it('gives rows an import can copy', () => {
      const [message] = readTranscript(file(HEADER, elara('Well?'))).messages

      expect(message).toMatchObject({
        role: 'assistant',
        content: 'Well?',
        reasoningContent: null,
        edited: false,
        editedAt: null,
        metadata: null,
      })
      expect(message).not.toHaveProperty('deleted')
      expect(message).not.toHaveProperty('alternates')
    })
  })

  describe('when things were said', () => {
    const at = (send_date, ...rest) =>
      readTranscript(file(HEADER, elara('Well?', { send_date }), ...rest)).messages[0].created

    it('reads every way ST has written a time down', () => {
      expect(at('2026-09-19T05:54:14.699Z')).toBe(Date.parse('2026-09-19T05:54:14.699Z'))
      expect(at(1700000000000)).toBe(1700000000000)
      expect(at('July 19, 2023 2:05pm')).toBe(new Date(2023, 6, 19, 14, 5).getTime())
      expect(at('July 19, 2023 12:05am')).toBe(new Date(2023, 6, 19, 0, 5).getTime())
      expect(at('2023-7-19 @14h 05m 33s 123ms')).toBe(
        new Date(2023, 6, 19, 14, 5, 33, 123).getTime()
      )
    })

    it('keeps the order when two messages share a minute', () => {
      const stamp = 'July 19, 2023 2:05pm'
      const { messages } = readTranscript(
        file(HEADER, elara('One.', { send_date: stamp }), sam('Two.', { send_date: stamp }))
      )

      expect(messages[1].created).toBeGreaterThan(messages[0].created)
    })

    it('keeps the order when a time cannot be read', () => {
      const { messages } = readTranscript(
        file(HEADER, elara('One.'), sam('Two.', { send_date: 'the other day' }), elara('Three.'))
      )

      expect(messages[1].created).toBeGreaterThan(messages[0].created)
      expect(messages[2].created).toBeGreaterThan(messages[1].created)
    })

    it('keeps how long the answer took, and the thinking', () => {
      const [message] = readTranscript(
        file(
          HEADER,
          elara('Well?', {
            gen_started: '2026-09-19T05:54:10.000Z',
            gen_finished: '2026-09-19T05:54:17.000Z',
            extra: { reasoning: 'She would be curt.', reasoning_duration: 2500 },
          })
        )
      ).messages

      const started = Date.parse('2026-09-19T05:54:10.000Z')
      expect(message.reasoningContent).toBe('She would be curt.')
      expect(message.streamingStartTime).toBe(started)
      expect(message.thinkingFinishTime).toBe(started + 2500)
      expect(message.streamingFinishTime).toBe(Date.parse('2026-09-19T05:54:17.000Z'))
    })
  })

  describe('which model wrote it', () => {
    const written = elara('Well?', { extra: { api: 'openrouter', model: 'z-ai/glm-5.3' } })

    it('is kept on the message', () => {
      const [message] = readTranscript(file(HEADER, written)).messages

      expect(message.metadata).toEqual({ model: 'z-ai/glm-5.3', provider: 'openrouter' })
    })

    it('is nothing for a greeting, or for what the writer said', () => {
      const { messages } = readTranscript(file(HEADER, elara('Well?'), sam('Hello.')))

      expect(messages.map(message => message.metadata)).toEqual([null, null])
    })

    it('is kept swipe by swipe, since asking again may have asked another', () => {
      const [message] = readTranscript(
        file(
          HEADER,
          elara('Hm.', {
            swipe_id: 1,
            swipes: ['Well?', 'Hm.'],
            extra: { api: 'openrouter', model: 'z-ai/glm-5.3' },
            swipe_info: [{ extra: { api: 'koboldcpp', model: 'tiefighter-13b' } }, { extra: {} }],
          })
        )
      ).messages

      expect(message.alternates[0].metadata).toEqual({
        model: 'tiefighter-13b',
        provider: 'koboldcpp',
      })
      expect(message.alternates[1].metadata).toEqual({
        model: 'z-ai/glm-5.3',
        provider: 'openrouter',
      })
    })
  })

  describe('swipes', () => {
    const swiped = elara('Hm.', {
      swipe_id: 1,
      swipes: ['Well?', 'Hm.', 'Go on.'],
      swipe_info: [
        { gen_started: '2026-09-19T05:54:10.000Z', extra: { reasoning: 'Curt.' } },
        { extra: {} },
        { extra: {} },
      ],
    })

    it('become the answers a message can be turned back to', () => {
      const [message] = readTranscript(file(HEADER, swiped)).messages

      expect(message.alternates.map(answer => answer.content)).toEqual(['Well?', 'Hm.', 'Go on.'])
      expect(message.alternate).toBe(1)
      expect(message.content).toBe('Hm.')
    })

    it("keep each answer's own thinking and timing", () => {
      const [message] = readTranscript(file(HEADER, swiped)).messages

      expect(message.alternates[0].reasoningContent).toBe('Curt.')
      expect(message.alternates[0].streamingStartTime).toBe(Date.parse('2026-09-19T05:54:10.000Z'))
      expect(message.alternates[2].reasoningContent).toBeNull()
    })

    it('are not answers when there is only the one', () => {
      const [message] = readTranscript(
        file(HEADER, elara('Well?', { swipe_id: 0, swipes: ['Well?'] }))
      ).messages

      expect(message).not.toHaveProperty('alternates')
    })

    it('have their macros filled in, which ST leaves for a greeting nobody chose', () => {
      const greeting = elara('Sam. You came.', {
        swipe_id: 0,
        swipes: ['{{user}}. You came.', '{{char}} does not look up. "{{user}}."'],
      })
      const [message] = readTranscript(file(HEADER, greeting, sam('I did.'))).messages

      expect(message.alternates[1].content).toBe('Elara does not look up. "Sam."')
      // The one showing is the message itself, as ST filled it in.
      expect(message.alternates[0].content).toBe('Sam. You came.')
    })

    it('survive a swipe_id that points at nothing', () => {
      const [message] = readTranscript(
        file(HEADER, elara('Hm.', { swipe_id: 9, swipes: ['Well?', 'Hm.'] }))
      ).messages

      expect(message.alternate).toBe(1)
    })
  })
})
