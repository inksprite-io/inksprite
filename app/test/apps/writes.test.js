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
  STORED_MOST,
  STORED_NOTE,
  answeringStored,
  changedLines,
  editMany,
} from '@/apps/writes.js'
import {
  executeAddComment,
  executeAppendDocument,
  executeCreateDocument,
  executeEditDocument,
  executeUpdateDocument,
  projectOverview,
} from '@/ai/tools/documents.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { withoutComments } from '@/editor/comments.js'

const STORY = 'story_1'
const context = { storyId: STORY, chatId: 'app:app_1', postsAs: 'Claude Code' }

const TEXT = [
  '# The vault',
  '',
  'The vault opens at noon. The guards change at noon too.',
  '',
  'Bring rope and a lamp.',
].join('\n')

/** @type {ReturnType<typeof useDocumentsStore>} */
let store

/** The plan's text, without the comments' markup. */
const plan = () => withoutComments(store.getDocument('doc_plan').content)

beforeEach(async () => {
  setActivePinia(createPinia())
  clearDocumentInstances()
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  store = useDocumentsStore()
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

describe('editMany', () => {
  it('makes several edits in order, each to the text the ones before it left', async () => {
    const answer = await editMany(
      {
        path: 'Plan',
        edits: [
          { old: 'Bring rope', new: 'Bring a ladder' },
          { old: 'a ladder and a lamp', new: 'a ladder, a lamp and gloves' },
        ],
      },
      context
    )

    expect(answer).toMatchObject({ success: true, edits: 2, document: { path: 'Plan' } })
    expect(plan()).toBe(TEXT.replace('rope and a lamp', 'a ladder, a lamp and gloves'))
  })

  it('makes none of them when one cannot be made, and says which', async () => {
    const answer = await editMany(
      {
        path: 'Plan',
        edits: [
          { old: 'Bring rope', new: 'Bring a ladder' },
          { old: 'two guards', new: 'three guards' },
        ],
      },
      context
    )

    expect(answer.error).toContain('Edit 2: "old" was not found in "Plan"')
    expect(answer.error).toContain('once the edits before it were made')
    expect(answer.error).toContain('None of the edits was made.')
    expect(typeof answer.nearest).toBe('string')
    expect(plan()).toBe(TEXT)
  })

  it('refuses a passage that is there more than once, unless every place is meant', async () => {
    const twice = await editMany(
      { path: 'Plan', edits: [{ old: 'at noon', new: 'at midnight' }] },
      context
    )
    expect(twice.error).toContain('"old" appears 2 times in "Plan"')
    expect(twice.error).toContain('set "all"')
    expect(plan()).toBe(TEXT)

    const every = await editMany({ path: 'Plan', old: 'noon', new: 'midnight', all: true }, context)
    expect(every).toMatchObject({ success: true, edits: 1 })
    expect(plan()).toBe(TEXT.replaceAll('noon', 'midnight'))
  })

  it('takes `all` for one edit of several, or for all of them', async () => {
    await editMany(
      {
        path: 'Plan',
        edits: [
          { old: 'noon', new: 'dusk', all: true },
          { old: 'rope', new: 'wire' },
        ],
      },
      context
    )
    expect(plan()).toBe(TEXT.replaceAll('noon', 'dusk').replace('rope', 'wire'))

    await editMany({ path: 'Plan', all: true, edits: [{ old: 'dusk', new: 'dawn' }] }, context)
    expect(plan()).toBe(TEXT.replaceAll('noon', 'dawn').replace('rope', 'wire'))
  })

  it('writes a `$` in what a passage becomes as a dollar sign', async () => {
    await editMany({ path: 'Plan', edits: [{ old: 'rope', new: '$1 of rope $&' }] }, context)
    expect(plan()).toContain('Bring $1 of rope $& and a lamp.')
  })

  it('says what is wrong with edits that are not edits, and makes none', async () => {
    const cases = [
      [{ path: 'Plan', edits: [] }, 'at least one change'],
      [{ path: 'Plan', edits: [{ new: 'x' }] }, 'Edit 1: Give the passage to change as "old"'],
      [{ path: 'Plan', edits: [{ old: 'rope' }] }, 'Edit 1: Give what it becomes as "new"'],
      [{ path: 'Plan', edits: [{ old: 'rope', new: 'x' }], old: 'a', new: 'b' }, 'not both'],
      [{ path: 'Plan', all: true, new: 'x' }, 'Give the passage to change as "old"'],
    ]
    for (const [args, said] of cases) {
      expect((await editMany(args, context)).error, JSON.stringify(args)).toContain(said)
    }
    expect(plan()).toBe(TEXT)
  })

  it('says of a path with no document, or a folder, what one edit says', async () => {
    const edits = [{ old: 'rope', new: 'wire' }]
    expect((await editMany({ path: 'Nothing', edits }, context)).error).toContain(
      'No document at "Nothing"'
    )
    expect((await editMany({ path: 'notes', edits }, context)).error).toContain('folder')
  })

  it('keeps a comment on words the edits leave, and resolves one whose words they change', async () => {
    const kept = await executeAddComment(
      { path: 'Plan', passage: 'a lamp', text: 'Which one?' },
      context
    )
    const changed = await executeAddComment(
      { path: 'Plan', passage: 'Bring rope', text: 'How much?' },
      context
    )

    const answer = await editMany(
      { path: 'Plan', edits: [{ old: 'Bring rope', new: 'Bring wire' }] },
      context
    )

    expect(answer.success).toBe(true)
    const { comments } = store.getDocument('doc_plan')
    expect(comments[kept.comment].status).toBe('open')
    expect(comments[changed.comment].status).toBe('resolved')
    expect(plan()).toContain('Bring wire and a lamp.')
  })

  it('finds a passage quoted with a comment’s markup in it', async () => {
    await executeAddComment({ path: 'Plan', passage: 'a lamp', text: 'Which one?' }, context)
    const marked = store.getDocument('doc_plan').content
    const quoted = marked.split('\n').at(-1)
    expect(quoted).not.toBe('Bring rope and a lamp.')

    const answer = await editMany(
      { path: 'Plan', edits: [{ old: quoted, new: 'Bring wire and a lamp.' }] },
      context
    )

    expect(answer.success).toBe(true)
    expect(plan()).toContain('Bring wire and a lamp.')
  })

  it('writes nothing, and says so, when every passage already reads that way', async () => {
    const before = store.getDocument('doc_plan').content
    const answer = await editMany({ path: 'Plan', edits: [{ old: 'rope', new: 'rope' }] }, context)

    expect(answer).toMatchObject({ success: true, edits: 1, document: { path: 'Plan' } })
    expect(answer.note).toContain('Nothing changed')
    expect(store.getDocument('doc_plan').content).toBe(before)
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

describe('answeringStored', () => {
  it('says nothing more when the text is in the document as it was sent', async () => {
    const args = { path: 'Plan', old: 'rope', new: 'wire' }
    const answer = await answeringStored('edit_document', args, context, () =>
      executeEditDocument(args, context)
    )

    expect(answer.success).toBe(true)
    expect(answer.stored).toBeUndefined()
    expect(answer.note).toBeUndefined()
  })

  it('gives the passage as it reads now when the editor wrote it another way', async () => {
    const args = { path: 'Plan', old: 'Bring rope and a lamp.', new: '* rope\n* a lamp' }
    const answer = await answeringStored('edit_document', args, context, () =>
      executeEditDocument(args, context)
    )

    expect(answer).toMatchObject({ success: true, stored: '- rope\n- a lamp', note: STORED_NOTE })
  })

  it('does so for what is added to the end, for a new document, and for a whole rewrite', async () => {
    const append = { path: 'Plan', text: '* gloves' }
    expect(
      (
        await answeringStored('append_document', append, context, () =>
          executeAppendDocument(append, context)
        )
      ).stored
    ).toBe('- gloves')

    const create = { path: 'notes/Crew', content: '* Mara\n* Tov' }
    expect(
      (
        await answeringStored('create_document', create, context, () =>
          executeCreateDocument(create, context)
        )
      ).stored
    ).toBe('- Mara\n- Tov')

    const update = { path: 'Plan', content: '# Plan\n\n* one\n* two' }
    expect(
      (
        await answeringStored('update_document', update, context, () =>
          executeUpdateDocument(update, context)
        )
      ).stored
    ).toBe('# Plan\n\n- one\n- two')
  })

  it('checks every edit of several', async () => {
    const args = {
      path: 'Plan',
      edits: [
        { old: 'noon too', new: 'dusk too' },
        { old: 'Bring rope and a lamp.', new: '* rope' },
      ],
    }
    const answer = await answeringStored('edit_document', args, context, () =>
      editMany(args, context)
    )

    expect(answer.stored).toContain('- rope')
    expect(answer.note).toBe(STORED_NOTE)
  })

  it('says to read the document again when what changed is long', async () => {
    const lines = Array.from({ length: 400 }, (_, at) => `* item number ${at}`).join('\n')
    expect(lines.length).toBeGreaterThan(STORED_MOST)
    const args = { path: 'Plan', content: lines }
    const answer = await answeringStored('update_document', args, context, () =>
      executeUpdateDocument(args, context)
    )

    expect(answer.success).toBe(true)
    expect(answer.stored).toBeUndefined()
    expect(answer.note).toBe(READ_AGAIN_NOTE)
  })

  it('hands back a refusal as it is', async () => {
    const args = { path: 'Plan', old: 'no such words', new: 'x' }
    const answer = await answeringStored('edit_document', args, context, () =>
      executeEditDocument(args, context)
    )

    expect(answer.error).toContain('was not found')
    expect(answer.stored).toBeUndefined()
  })
})
