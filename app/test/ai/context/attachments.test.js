import { describe, it, expect } from 'vitest'
import {
  attachmentsOf,
  mentionsIn,
  onlyAttaches,
  renderAttachments,
  withAttachments,
  withoutSigils,
} from '@/ai/context/attachments.js'
import { buildContext } from '@/ai/context/build.js'
import { changedSinceRead, readInView, readsInView, textHash } from '@/ai/context/reads.js'

const attached = (id, path, text) => ({ id, path, hash: textHash(text), text })

/** A writer's turn of one piece of prose, with what it attached. */
const turn = (id, content, attachments = []) => ({
  id,
  role: 'user',
  content,
  segments: [{ type: 'text', content, ...(attachments.length ? { attachments } : {}) }],
})

describe('onlyAttaches', () => {
  it('is a text of nothing but mentions', () => {
    expect(onlyAttaches('@[Cast](</Notes/Cast>)\n@[Map](</Notes/Map>)')).toBe(true)
    expect(onlyAttaches('Read @[Cast](</Notes/Cast>) first.')).toBe(false)
    expect(onlyAttaches('Hello.')).toBe(false)
    expect(onlyAttaches('')).toBe(false)
  })
})

describe('mentionsIn', () => {
  it('finds a link with an @ before it, by the path it names', () => {
    expect(mentionsIn('Compare @[Cast](</Notes/Cast list>) with @[Plan](/Plan).')).toEqual([
      { at: 8, path: '/Notes/Cast list' },
      { at: 41, path: '/Plan' },
    ])
  })

  it('reads a path as it was escaped', () => {
    expect(mentionsIn('@[a \\[b\\]](</Notes/a \\<b\\>>)')).toEqual([
      { at: 0, path: '/Notes/a <b>' },
    ])
  })

  it('leaves a plain link, a bare @ and an address alone', () => {
    expect(mentionsIn('See [Cast](</Notes/Cast>), @Riley and me@[x](/y).')).toEqual([])
  })
})

describe('withoutSigils', () => {
  it('leaves each mention as the link it is without its @', () => {
    expect(withoutSigils('Compare @[Cast](</Notes/Cast>) with @[Plan](/Plan), @Riley.')).toBe(
      'Compare [Cast](</Notes/Cast>) with [Plan](/Plan), @Riley.'
    )
  })
})

describe('attachmentsOf', () => {
  it('gathers what the pieces of a turn attached, each document once', () => {
    const cast = attached('d1', 'Notes/Cast', 'A knight.')
    const plan = attached('d2', 'Plan', 'Go north.')
    const message = {
      role: 'user',
      content: '',
      segments: [
        { type: 'text', content: 'one', attachments: [cast] },
        { type: 'command', command: { name: 'roll' } },
        { type: 'text', content: 'two', attachments: [plan, cast] },
      ],
    }
    expect(attachmentsOf(message)).toEqual([cast, plan])
  })

  it('finds none on a turn that attached nothing, or on the model’s', () => {
    expect(attachmentsOf({ role: 'user', content: 'hello' })).toEqual([])
    expect(
      attachmentsOf({
        role: 'assistant',
        content: '',
        segments: [{ type: 'text', content: '', attachments: [attached('d1', 'A', 'a')] }],
      })
    ).toEqual([])
  })
})

describe('renderAttachments', () => {
  it('writes a block for each document, named by its path', () => {
    expect(
      renderAttachments([
        attached('d1', 'Notes/Cast', 'A knight.'),
        attached('d2', 'Plan', 'North.'),
      ])
    ).toBe(
      '<document path="Notes/Cast">\nA knight.\n</document>\n\n<document path="Plan">\nNorth.\n</document>'
    )
  })

  it('keeps a quote in a path from closing it', () => {
    expect(renderAttachments([attached('d1', 'The "Thief"', 'x')])).toContain(
      'path="The &quot;Thief&quot;"'
    )
  })
})

describe('withAttachments', () => {
  it('puts the documents ahead of what was said, with the mention a plain link', () => {
    const message = turn('m1', 'Is @[Cast](</Notes/Cast>) right?', [
      attached('d1', 'Notes/Cast', 'A knight.'),
    ])
    const documents = '<document path="Notes/Cast">\nA knight.\n</document>'
    expect(withAttachments(message)).toEqual({
      content: `${documents}\n\nIs [Cast](</Notes/Cast>) right?`,
      lead: documents.length,
    })
  })

  it('leaves a message that attached nothing as it was written', () => {
    expect(withAttachments(turn('m1', 'Is @[Cast](</Notes/Cast>) right?'))).toEqual({
      content: 'Is @[Cast](</Notes/Cast>) right?',
      lead: 0,
    })
  })
})

describe('an attachment as a read', () => {
  const cast = attached('d1', 'Notes/Cast', 'A knight.')
  const messages = [turn('m1', '@[Cast](</Notes/Cast>)', [cast])]

  it('is in view as a read of the whole document', () => {
    expect(readsInView(messages)).toEqual([
      { id: 'd1', path: 'Notes/Cast', hash: cast.hash, args: {}, whole: true },
    ])
  })

  it('covers a read of any part of the same text', () => {
    expect(readInView(messages, 'd1', { path: 'Notes/Cast' }, cast.hash)).toBe(true)
    expect(readInView(messages, 'd1', { path: 'Notes/Cast', section: 'past' }, cast.hash)).toBe(
      true
    )
    expect(readInView(messages, 'd1', { path: 'Notes/Cast' }, textHash('A squire.'))).toBe(false)
  })

  it('is listed as changed once the document is edited', () => {
    const at = text => () => ({ path: 'Notes/Cast', text })
    expect(changedSinceRead(messages, at('A knight.'))).toEqual([])
    expect(changedSinceRead(messages, at('A squire.'))).toEqual([
      { path: 'Notes/Cast', since: 'edited' },
    ])
  })
})

describe('an attachment in the request', () => {
  const stores = messages => ({
    documentsStore: { getDocument: () => null },
    chatsStore: { getChatById: id => (id === 'c1' ? { id } : null) },
    messagesStore: { getMessagesForChat: () => messages },
  })
  const cast = attached('d1', 'Notes/Cast', 'A knight.')
  const documents = '<document path="Notes/Cast">\nA knight.\n</document>'
  const build = (messages, extra = {}) =>
    buildContext(stores(messages), { storyId: 's1', chatId: 'c1', systemPrompt: '', ...extra })

  it('goes with its message on every later turn, the same', async () => {
    const first = turn('m1', 'Is @[Cast](</Notes/Cast>) right?', [cast])
    const { messages } = await build([
      first,
      { id: 'm2', role: 'assistant', content: 'Yes.' },
      turn('m3', 'Thanks.'),
    ])
    expect(messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: `${documents}\n\nIs [Cast](</Notes/Cast>) right?` },
      { role: 'assistant', content: 'Yes.' },
      { role: 'user', content: 'Thanks.' },
    ])
  })

  it('has the project block after its documents, so they are the same next turn', async () => {
    const { messages } = await build([turn('m1', 'Is @[Cast](</Notes/Cast>) right?', [cast])], {
      project: { project: 'Thief' },
    })
    const [{ content }] = messages
    expect(content.startsWith(`${documents}\n\n<project>`)).toBe(true)
    expect(content.endsWith('</project>\n\n---\n\nIs [Cast](</Notes/Cast>) right?')).toBe(true)
  })

  it('goes with a question asked in the thread, which has no block or note', async () => {
    const { messages } = await build(
      [
        turn('m1', 'Is @[Cast](</Notes/Cast>) right?', [cast]),
        { id: 'm2', role: 'assistant', content: 'Yes.' },
      ],
      { project: { project: 'Thief' }, note: 'Keep it short.', ask: 'Summarize this chat.' }
    )

    expect(messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: 'user', content: `${documents}\n\nIs [Cast](</Notes/Cast>) right?` },
      { role: 'assistant', content: 'Yes.' },
      { role: 'user', content: 'Summarize this chat.' },
    ])
  })

  it('leaves the documents out of a transcript, as it leaves out reads', async () => {
    const { messages } = await build([turn('m1', 'Is @[Cast](</Notes/Cast>) right?', [cast])], {
      transcript: { user: 'user', assistant: 'assistant' },
    })
    expect(messages[0].content).not.toContain('<document')
  })
})
