/* global TextEncoder */
import { describe, it, expect } from 'vitest'
import {
  chatText,
  readChat,
  inFileOrder,
  messageLine,
  messagesText,
  readMessages,
  planMessages,
  mergeMessages,
} from '@/storage/chats.js'

/** @param {string} id @param {number} created @param {string} [content] */
const message = (id, created, content = id) =>
  /** @type {import('@/types/models.js').Message} */ ({
    id,
    chatId: 'chat_1',
    role: 'user',
    content,
    created,
  })

/**
 * Carry out a write on a file's text, by bytes, as the disk would.
 *
 * @param {string} text
 * @param {NonNullable<ReturnType<typeof planMessages>>} write
 */
function apply(text, write) {
  const bytes = new TextEncoder().encode(text).slice(0, write.at)
  return new TextDecoder().decode(bytes) + write.text
}

describe('a chat on disk', () => {
  it('keeps its row in a file of its own', () => {
    const chat = /** @type {any} */ ({ id: 'chat_1', storyId: 's', title: 'Hi', created: 1 })
    expect(readChat(chatText(chat))).toEqual(chat)
    expect(readChat('nope')).toBeNull()
  })

  it('keeps its messages in the order they were made', () => {
    const ordered = inFileOrder([message('b', 2), message('c', 1), message('a', 2)])
    expect(ordered.map(m => m.id)).toEqual(['c', 'a', 'b'])
  })

  it('writes a new chat’s messages from the start, and reads them back', () => {
    const messages = [message('b', 2, 'Ünïcödé ✨'), message('a', 1)]
    const write = /** @type {any} */ (planMessages(null, messages, []))

    expect(write).toMatchObject({ op: 'append', at: 0 })
    const read = readMessages(apply('', write))
    expect(read.messages.map(m => m.id)).toEqual(['a', 'b'])
    expect(read.lines).toEqual(write.lines)
  })

  it('adds a new message at the end', () => {
    const before = [message('a', 1), message('b', 2)]
    const { text, lines } = messagesText(before)

    const write = /** @type {any} */ (planMessages(lines, [message('c', 3)], []))

    expect(write).toMatchObject({ op: 'append', at: new TextEncoder().encode(text).length })
    expect(readMessages(apply(text, write)).messages).toEqual([...before, message('c', 3)])
  })

  it('writes the last message again from where it starts, shorter or longer', () => {
    const before = [message('a', 1, 'é'), message('b', 2, 'a long first draft of an answer')]
    const { text, lines } = messagesText(before)

    for (const content of ['short', 'a longer second draft of the same answer, ✨']) {
      const write = /** @type {any} */ (planMessages(lines, [message('b', 2, content)], []))
      expect(write.op).toBe('append')
      expect(readMessages(apply(text, write)).messages).toEqual([
        before[0],
        message('b', 2, content),
      ])
    }
  })

  it('takes the last message off from where it starts', () => {
    const before = [message('a', 1), message('b', 2)]
    const { text, lines } = messagesText(before)
    const write = /** @type {any} */ (planMessages(lines, [], ['b']))

    expect(write).toMatchObject({ op: 'append', text: '' })
    expect(readMessages(apply(text, write)).messages).toEqual([before[0]])
  })

  it('asks for the file to be written whole for a change further back', () => {
    const { lines } = messagesText([message('a', 1), message('b', 2), message('c', 3)])

    expect(planMessages(lines, [message('a', 1, 'edited')], [])).toEqual({ op: 'rewrite' })
    expect(planMessages(lines, [], ['b'])).toEqual({ op: 'rewrite' })
    // A message made to go above the others, as a summary is.
    expect(planMessages(lines, [message('s', 0)], [])).toEqual({ op: 'rewrite' })
  })

  it('makes the changes in what a file held, for writing it whole', () => {
    const held = [message('a', 1), message('b', 2), message('c', 3)]
    const merged = mergeMessages(held, [message('a', 1, 'edited'), message('s', 0)], ['b'])
    expect(merged.map(m => [m.id, m.content])).toEqual([
      ['s', 's'],
      ['a', 'edited'],
      ['c', 'c'],
    ])
  })

  it('does nothing when nothing changed', () => {
    const { lines } = messagesText([message('a', 1)])
    expect(planMessages(lines, [], ['never-there'])).toBeNull()
  })

  it('passes over a line a stop cut short', () => {
    const text = `${messageLine(message('a', 1))}{"id":"b","con`
    const read = readMessages(text)
    expect(read.messages.map(m => m.id)).toEqual(['a'])
    expect(read.lines.ids).toEqual(['a'])
  })
})
