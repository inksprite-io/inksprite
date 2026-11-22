import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      filter: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
      bulkDelete: vi.fn(),
      bulkGet: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
    },
    stories: { toArray: vi.fn(async () => []) },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

import {
  READ_AGAIN_NOTE,
  REWRITTEN_NOTE,
  STORED_MOST,
  STORED_NOTE,
  changedLines,
  withStored,
} from '@/apps/writes.js'
import { stateAt } from '@/apps/revisions.js'
import {
  executeAppendDocument,
  executeCreateDocument,
  executeEditDocument,
  executeUpdateDocument,
  projectOverview,
} from '@/ai/tools/documents.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

const STORY = 'story_1'
const context = { storyId: STORY, chatId: 'app:app_1', postsAs: 'Claude Code' }

const TEXT = [
  '# The vault',
  '',
  'The vault opens at noon. The guards change at noon too.',
  '',
  'Bring rope and a lamp.',
].join('\n')

/**
 * A write, as the adapter runs one (`apps/tools.js`): the document taken
 * before the write and after it, and the answer saying how the text was
 * stored from the two.
 *
 * @param {string} name - The tool
 * @param {Record<string, any>} args
 * @param {() => Promise<any>} write - The tool, run
 */
const writing = async (name, args, write) => {
  const before = await stateAt(context, args.path)
  const answer = await write()
  return withStored(name, args, { before, after: await stateAt(context, args.path) }, answer)
}

beforeEach(async () => {
  setActivePinia(createPinia())
  clearDocumentInstances()
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const store = useDocumentsStore()
  await projectOverview(STORY)
  store.createDocument({
    id: 'doc_plan',
    storyId: STORY,
    parentId: rootIdFor(STORY),
    type: 'text',
    title: 'Plan',
    content: TEXT,
  })
  store.createDocument({
    id: 'folder_notes',
    storyId: STORY,
    parentId: rootIdFor(STORY),
    type: 'folder',
    title: 'notes',
  })
})

describe('changedLines', () => {
  it('is the lines that differ, whole, from the first to the last', () => {
    expect(changedLines('one\ntwo\nthree', 'one\ntwo and a half\nthree')).toBe('two and a half')
    expect(changedLines('one\ntwo\nthree\nfour', 'one\n2\nthree\n4')).toBe('2\nthree\n4')
    expect(changedLines('a b c', 'a x c')).toBe('a x c')
  })

  it('is what was added to the end, without the line before it', () => {
    expect(changedLines('one', 'one\n\n- two\n- three')).toBe('- two\n- three')
    expect(changedLines('', '# New\n\nText.')).toBe('# New\n\nText.')
  })

  it('is what was put at the start, without the line after it', () => {
    expect(changedLines('two', 'one\n\ntwo')).toBe('one')
  })

  it('is nothing when nothing changed', () => {
    expect(changedLines('same', 'same')).toBe('')
    expect(changedLines('', '')).toBe('')
  })

  it('is whole lines of the text as it is now, where lines were taken out', () => {
    expect(changedLines('one\ntwo\nthree', 'one\nthree')).toBe('three')
  })
})

describe('withStored', () => {
  it('says nothing more when the text is in the document as it was sent', async () => {
    const args = { path: 'Plan', old: 'rope', new: 'wire' }
    const answer = await writing('edit_document', args, () => executeEditDocument(args, context))

    expect(answer.success).toBe(true)
    expect(answer.stored).toBeUndefined()
    expect(answer.note).toBeUndefined()
  })

  it('gives the passage as it reads now when the editor wrote it another way', async () => {
    const args = { path: 'Plan', old: 'Bring rope and a lamp.', new: '* rope\n* a lamp' }
    const answer = await writing('edit_document', args, () => executeEditDocument(args, context))

    expect(answer).toMatchObject({ success: true, stored: '- rope\n- a lamp', note: STORED_NOTE })
  })

  it('does so for what is added to the end', async () => {
    const append = { path: 'Plan', text: '* gloves' }
    expect(
      (await writing('append_document', append, () => executeAppendDocument(append, context)))
        .stored
    ).toBe('- gloves')
  })

  it('gives a new document or a rewrite as the difference from what was sent', async () => {
    const create = { path: 'notes/Crew', content: '# Crew\n\n* Mara\n* Tov' }
    const made = await writing('create_document', create, () =>
      executeCreateDocument(create, context)
    )
    expect(made).toMatchObject({ success: true, note: REWRITTEN_NOTE })
    expect(made.stored).toBeUndefined()
    expect(made.rewritten).toBe('@@ -1,4 +1,4 @@\n # Crew\n \n-* Mara\n-* Tov\n+- Mara\n+- Tov')

    const update = { path: 'Plan', content: '# Plan\n\n* one\n* two' }
    const rewrote = await writing('update_document', update, () =>
      executeUpdateDocument(update, context)
    )
    expect(rewrote.rewritten).toBe('@@ -1,4 +1,4 @@\n # Plan\n \n-* one\n-* two\n+- one\n+- two')
  })

  it('gives the few lines written another way in a long new document, not the whole', async () => {
    const prose = Array.from({ length: 60 }, (_, at) => `Paragraph ${at} of the plan, in words.`)
    const content = [...prose.slice(0, 30), '* the one list', ...prose.slice(30)].join('\n\n')
    expect(content.length).toBeGreaterThan(STORED_MOST / 2)
    const args = { path: 'notes/Long plan', content }
    const answer = await writing('create_document', args, () =>
      executeCreateDocument(args, context)
    )

    expect(answer.note).toBe(REWRITTEN_NOTE)
    expect(answer.rewritten).toContain('-* the one list\n+- the one list')
    expect(answer.rewritten.length).toBeLessThan(400)
  })

  it('says nothing of comment markup, which a read leaves out as well', async () => {
    const store = useDocumentsStore()
    store.updateDocument('doc_plan', {
      content: 'The vault opens at {==noon==}{>>c1abcd<<}.',
      comments: {
        c1abcd: {
          status: 'open',
          posts: [{ author: 'writer', text: 'Which noon?', at: 1 }],
        },
      },
    })
    const args = { path: 'Plan', content: 'The vault opens at noon.\n\nBring rope.' }
    const answer = await writing('update_document', args, () =>
      executeUpdateDocument(args, context)
    )

    expect(answer.success).toBe(true)
    expect(answer.rewritten).toBeUndefined()
    expect(answer.note).toBeUndefined()
  })

  it('checks every edit of several', async () => {
    const args = {
      path: 'Plan',
      edits: [
        { old: 'noon too', new: 'dusk too' },
        { old: 'Bring rope and a lamp.', new: '* rope' },
      ],
    }
    const answer = await writing('edit_document', args, () => executeEditDocument(args, context))

    expect(answer.stored).toContain('- rope')
    expect(answer.note).toBe(STORED_NOTE)
  })

  it('says to read the document again when what changed is long', async () => {
    const lines = Array.from({ length: 400 }, (_, at) => `* item number ${at}`).join('\n')
    expect(lines.length).toBeGreaterThan(STORED_MOST)
    const args = { path: 'Plan', content: lines }
    const answer = await writing('update_document', args, () =>
      executeUpdateDocument(args, context)
    )

    expect(answer.success).toBe(true)
    expect(answer.stored).toBeUndefined()
    expect(answer.note).toBe(READ_AGAIN_NOTE)
  })

  it('hands back a refusal as it is', async () => {
    const args = { path: 'Plan', old: 'no such words', new: 'x' }
    const answer = await writing('edit_document', args, () => executeEditDocument(args, context))

    expect(answer.error).toContain('was not found')
    expect(answer.stored).toBeUndefined()
  })
})
