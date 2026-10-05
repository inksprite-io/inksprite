import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import { useLoadedSkills } from '@/composables/useLoadedSkills.js'

const messages = ref([])
const updateMessage = vi.fn()
const writeSegment = vi.fn()

vi.mock('@/composables/useChats', () => ({
  useChats: () => ({
    getMessagesForChat: id => (id === 'chat_1' ? messages : { value: [] }),
    updateMessage,
    writeSegment,
  }),
}))

/** The writer's turn: a line of theirs, then `/tighten`, which loaded it. */
const writerTurn = {
  id: 'm_writer',
  role: 'user',
  content: 'Look at this.\n\n<tighten>\nCut it by a third.\n</tighten>',
  segments: [
    { type: 'text', content: 'Look at this.' },
    {
      type: 'command',
      command: {
        name: 'tighten',
        input: '',
        prompt: true,
        load: true,
        result: 'Cut it by a third.',
      },
    },
  ],
}

describe('useLoadedSkills', () => {
  beforeEach(() => {
    updateMessage.mockClear()
    writeSegment.mockClear()
    messages.value = [writerTurn]
  })

  it('lists what the chat has loaded, by its id or a getter for it', () => {
    expect(useLoadedSkills('chat_1').loaded.value).toEqual(['tighten'])
    expect(useLoadedSkills(() => 'chat_1').loaded.value).toEqual(['tighten'])
    expect(useLoadedSkills('chat_2').loaded.value).toEqual([])
  })

  it('marks the writer’s load, leaving their turn as it reads', () => {
    useLoadedSkills('chat_1').drop('tighten')

    expect(updateMessage).not.toHaveBeenCalled()
    expect(writeSegment).toHaveBeenCalledWith(
      'm_writer',
      1,
      expect.objectContaining({ name: 'tighten', dropped: true }),
      writerTurn.content
    )
  })

  it('lists a dropped skill as loaded, and as going at the next summary', () => {
    messages.value = [
      {
        ...writerTurn,
        segments: [
          writerTurn.segments[0],
          {
            ...writerTurn.segments[1],
            command: { ...writerTurn.segments[1].command, dropped: true },
          },
        ],
      },
    ]

    expect(useLoadedSkills('chat_1').loaded.value).toEqual(['tighten'])
    expect(useLoadedSkills('chat_1').dropped.value).toEqual(['tighten'])
  })

  it('does nothing for a skill the chat has not loaded', () => {
    useLoadedSkills('chat_1').drop('house-style')

    expect(updateMessage).not.toHaveBeenCalled()
    expect(writeSegment).not.toHaveBeenCalled()
  })
})
