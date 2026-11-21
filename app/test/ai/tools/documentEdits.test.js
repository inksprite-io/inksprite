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
  applyProposal,
  editDocumentDefinition,
  executeAddComment,
  executeEditDocument,
  executeReadDocument,
  projectOverview,
} from '@/ai/tools/documents.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances, useDocuments } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { withoutComments } from '@/editor/comments.js'

const STORY = 'story_1'
const context = { storyId: STORY }

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

describe('what a chat is offered of edit_document', () => {
  it('is one passage: the list and `all` are for a caller told of them', () => {
    const { properties, required } = editDocumentDefinition.function.parameters
    expect(Object.keys(properties)).toEqual(['path', 'old', 'new'])
    expect(required).toEqual(['path', 'old', 'new'])
    expect(editDocumentDefinition.function.description).toMatch(/^Change one passage of a document/)
  })

  it('is told of a passage that missed in the words it always was', async () => {
    const edit = (old, becomes = 'x') =>
      executeEditDocument({ path: 'Plan', old, new: becomes }, context)

    expect(await edit('noon')).toEqual({
      error:
        '"old" appears 2 times in "Plan". Include more of the surrounding text so it matches once.',
    })
    expect(await edit('two guards')).toEqual({
      error:
        '"old" was not found in "Plan". Quote the passage exactly as read_document gave it; the nearest lines are in "nearest".',
      nearest: '# The vault\n\nThe vault opens at noon. The guards change at noon too.',
    })
    expect(await edit('Bring rope\nand a lamp.')).toEqual({
      error:
        '"old" was not found in "Plan" as written, though the words are there: the line breaks or spacing differ. Quote the passage exactly as read_document gave it.',
      nearest: '\nBring rope and a lamp.',
    })
    expect(plan()).toBe(TEXT)
  })

  it('is answered for one passage as it always was, with nothing of how many', async () => {
    expect(
      await executeEditDocument({ path: 'Plan', old: 'rope', new: 'thin wire' }, context)
    ).toEqual({
      success: true,
      document: { id: 'doc_plan', title: 'Plan', path: 'Plan' },
      charactersRemoved: 4,
      charactersWritten: 9,
    })
  })

  it('removes a passage whose `new` is left out, but not every place it appears', async () => {
    await executeEditDocument({ path: 'Plan', old: ' and a lamp' }, context)
    expect(plan()).toBe(TEXT.replace(' and a lamp', ''))

    const every = await executeEditDocument({ path: 'Plan', old: 'noon', all: true }, context)
    expect(every.error).toBe('Give what it becomes as "new".')
    expect(plan()).toContain('at noon. The guards change at noon too.')
  })
})

describe('several edits in a call', () => {
  it('makes several edits in order, each to the text the ones before it left', async () => {
    const answer = await executeEditDocument(
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
    const answer = await executeEditDocument(
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
    const twice = await executeEditDocument(
      { path: 'Plan', edits: [{ old: 'at noon', new: 'at midnight' }] },
      context
    )
    expect(twice.error).toContain('"old" appears 2 times in "Plan"')
    expect(twice.error).toContain('set "all"')
    expect(plan()).toBe(TEXT)

    const every = await executeEditDocument(
      { path: 'Plan', old: 'noon', new: 'midnight', all: true },
      context
    )
    expect(every).toMatchObject({ success: true })
    expect(plan()).toBe(TEXT.replaceAll('noon', 'midnight'))
  })

  it('takes `all` for one edit of several, or for all of them', async () => {
    await executeEditDocument(
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

    await executeEditDocument(
      { path: 'Plan', all: true, edits: [{ old: 'dusk', new: 'dawn' }] },
      context
    )
    expect(plan()).toBe(TEXT.replaceAll('noon', 'dawn').replace('rope', 'wire'))
  })

  it('writes a `$` in what a passage becomes as a dollar sign', async () => {
    await executeEditDocument(
      { path: 'Plan', edits: [{ old: 'rope', new: '$1 of rope $&' }] },
      context
    )
    expect(plan()).toContain('Bring $1 of rope $& and a lamp.')

    await executeEditDocument({ path: 'Plan', old: 'noon', new: "$' $`", all: true }, context)
    expect(plan()).toContain("at $' $`. The guards change at $' $` too.")
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
      expect((await executeEditDocument(args, context)).error, JSON.stringify(args)).toContain(said)
    }
    expect(plan()).toBe(TEXT)
  })

  it('says of a path with no document, or a folder, what one edit says', async () => {
    const edits = [{ old: 'rope', new: 'wire' }]
    expect((await executeEditDocument({ path: 'Nothing', edits }, context)).error).toContain(
      'No document at "Nothing"'
    )
    expect((await executeEditDocument({ path: 'notes', edits }, context)).error).toContain('folder')
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

    const answer = await executeEditDocument(
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

    const answer = await executeEditDocument(
      { path: 'Plan', edits: [{ old: quoted, new: 'Bring wire and a lamp.' }] },
      context
    )

    expect(answer.success).toBe(true)
    expect(plan()).toContain('Bring wire and a lamp.')
  })

  it('writes nothing when every passage already reads that way', async () => {
    const before = store.getDocument('doc_plan').content
    const turn = { ...context, edits: [] }
    const answer = await executeEditDocument(
      {
        path: 'Plan',
        edits: [
          { old: 'rope', new: 'rope' },
          { old: 'noon', new: 'noon', all: true },
        ],
      },
      turn
    )

    expect(answer).toMatchObject({ success: true, edits: 2, document: { path: 'Plan' } })
    expect(store.getDocument('doc_plan').content).toBe(before)
    expect(turn.edits).toEqual([])
  })

  it('answers with what one edit answers, the characters of them all, and how many there were', async () => {
    const answer = await executeEditDocument(
      {
        path: 'Plan',
        edits: [
          { old: 'noon', new: 'midday', all: true },
          { old: 'rope', new: 'wire' },
        ],
      },
      context
    )

    // "noon" at two places, and "rope" at one.
    expect(answer).toEqual({
      success: true,
      document: { id: 'doc_plan', title: 'Plan', path: 'Plan' },
      charactersRemoved: 4 + 4 + 4,
      charactersWritten: 6 + 6 + 4,
      edits: 2,
    })
  })

  it('says of a later edit that only its spacing differs, in the text the ones before it left', async () => {
    const answer = await executeEditDocument(
      {
        path: 'Plan',
        edits: [
          { old: 'rope', new: 'wire' },
          { old: 'Bring wire\nand a lamp.', new: 'x' },
        ],
      },
      context
    )

    expect(answer).toEqual({
      error:
        'Edit 2: "old" was not found in "Plan" as written once the edits before it were made, though the words are there: the line breaks or spacing differ. Quote the passage exactly as read_document gave it. None of the edits was made.',
      nearest: '\nBring wire and a lamp.',
    })
    expect(plan()).toBe(TEXT)
  })

  it('tells a list of one of `all`, without numbering it', async () => {
    const answer = await executeEditDocument(
      { path: 'Plan', edits: [{ old: 'noon', new: 'dusk' }] },
      context
    )
    expect(answer.error).toBe(
      '"old" appears 2 times in "Plan". Include more of the surrounding text so it matches once, or set "all" to change every one.'
    )
  })

  it('changes each place once, where what a passage becomes holds the passage', async () => {
    await executeEditDocument({ path: 'Plan', old: 'noon', new: 'high noon', all: true }, context)
    expect(plan()).toBe(TEXT.replaceAll('noon', 'high noon'))
  })

  it('counts the places as one edit counts them: each after the one before', async () => {
    store.updateDocument('doc_plan', { content: 'aaaaa' })
    await executeEditDocument({ path: 'Plan', old: 'aa', new: 'b', all: true }, context)
    expect(plan()).toBe('bba')
  })

  it('changes every place around the writer’s comments: one on a place goes, the rest stay', async () => {
    const lamp = await executeAddComment(
      { path: 'Plan', passage: 'a lamp', text: 'Which one?' },
      context
    )
    const second = await executeAddComment(
      { path: 'Plan', passage: 'change at noon too', text: 'Both shifts?' },
      context
    )
    const vault = await executeAddComment(
      { path: 'Plan', passage: 'The vault opens', text: 'Who opens it?' },
      context
    )

    const answer = await executeEditDocument(
      { path: 'Plan', old: 'noon', new: 'first light', all: true },
      context
    )

    expect(plan()).toBe(TEXT.replaceAll('noon', 'first light'))
    const { comments, content } = store.getDocument('doc_plan')
    expect(comments[second.comment].status).toBe('resolved')
    expect(comments[lamp.comment].status).toBe('open')
    expect(comments[vault.comment].status).toBe('open')
    expect(content).toContain(`{==The vault opens==}{>>${vault.comment}<<} at first light.`)
    expect(content).not.toContain(second.comment)
    expect(answer).toMatchObject({ success: true, charactersRemoved: 8, charactersWritten: 22 })
    expect(answer.resolvedComments).toEqual([{ id: second.comment, comment: 'Both shifts?' }])
  })

  it('changes every place the same, whether or not a comment is in the text', async () => {
    const every = { path: 'Plan', old: 'a', new: 'aa', all: true }
    await executeEditDocument(every, context)
    const without = plan()
    expect(without).toBe(TEXT.replaceAll('a', 'aa'))

    store.updateDocument('doc_plan', { content: TEXT })
    await executeAddComment({ path: 'Plan', passage: 'guards', text: 'How many?' }, context)
    await executeEditDocument(every, context)
    expect(plan()).toBe(without)
  })

  it('keeps a comment whose words are there twice, where no edit reaches it', async () => {
    const noon = await executeAddComment(
      { path: 'Plan', passage: 'opens at noon', text: 'Or later?' },
      context
    )
    store.updateDocument('doc_plan', {
      content: `${store.getDocument('doc_plan').content}\n\nIt opens at noon, they say.`,
    })

    await executeEditDocument(
      {
        path: 'Plan',
        edits: [
          { old: 'rope', new: 'wire' },
          { old: 'a lamp', new: 'two lamps' },
        ],
      },
      context
    )

    expect(store.getDocument('doc_plan').comments[noon.comment].status).toBe('open')
    expect(store.getDocument('doc_plan').content).toContain(
      `{==opens at noon==}{>>${noon.comment}<<}`
    )
  })

  it('records the edits of a call as one change, which a rewind takes back whole', async () => {
    const turn = { ...context, edits: [] }
    await executeEditDocument(
      {
        path: 'Plan',
        edits: [
          { old: 'noon', new: 'dusk', all: true },
          { old: 'rope', new: 'wire' },
        ],
      },
      turn
    )

    expect(turn.edits).toHaveLength(1)
    expect(turn.edits[0]).toMatchObject({ documentId: 'doc_plan', tool: 'edit_document' })
    expect(useDocuments(STORY).revertEdit(turn.edits[0])).toBe(true)
    expect(plan()).toBe(TEXT)
  })

  describe('in a chat that asks first', () => {
    const asking = () => ({ storyId: STORY, chatId: 'chat_1', propose: true, edits: [] })

    it('lays them out in the text as suggestions, as one edit’s change is', async () => {
      const turn = asking()
      const answer = await executeEditDocument(
        {
          path: 'Plan',
          edits: [
            { old: 'noon', new: 'dusk', all: true },
            { old: 'rope', new: 'wire' },
          ],
        },
        turn
      )

      expect(answer).toMatchObject({ suggested: true, edits: 2, document: { path: 'Plan' } })
      expect(answer.suggestions).toHaveLength(3)
      // The writer's text is as it was, and the chat reads its changes made.
      expect((await executeReadDocument({ path: 'Plan' }, context)).content).toBe(TEXT)
      expect((await executeReadDocument({ path: 'Plan' }, turn)).content).toBe(
        TEXT.replaceAll('noon', 'dusk').replace('rope', 'wire')
      )
      const threads = Object.values(store.getDocument('doc_plan').comments)
      expect(threads.map(thread => [thread.quote, thread.suggestion.text]).sort()).toEqual([
        ['noon', 'dusk'],
        ['noon', 'dusk'],
        ['rope', 'wire'],
      ])
    })

    it('finds a later edit’s passage in the text with the ones before it made, and suggests none where one misses', async () => {
      const turn = asking()
      const missed = await executeEditDocument(
        {
          path: 'Plan',
          edits: [
            { old: 'rope', new: 'wire' },
            { old: 'Bring rope', new: 'Carry rope' },
          ],
        },
        turn
      )
      expect(missed.error).toContain('Edit 2: "old" was not found in "Plan"')
      expect(missed.error).toContain('None of the edits was made.')
      expect(store.getDocument('doc_plan').comments ?? {}).toEqual({})
      expect(store.getDocument('doc_plan').content).toBe(TEXT)

      const made = await executeEditDocument(
        {
          path: 'Plan',
          edits: [
            { old: 'rope', new: 'wire' },
            { old: 'Bring wire', new: 'Carry wire' },
          ],
        },
        turn
      )
      expect(made).toMatchObject({ suggested: true, edits: 2 })
      expect((await executeReadDocument({ path: 'Plan' }, turn)).content).toContain(
        'Carry wire and a lamp.'
      )
    })

    it('proposes them in the chat as one change, for a document kept as typed', async () => {
      store.updateDocument('doc_plan', { plain: true })
      const turn = asking()
      const answer = await executeEditDocument(
        {
          path: 'Plan',
          edits: [
            { old: 'noon', new: 'dusk', all: true },
            { old: 'rope', new: 'wire' },
          ],
        },
        turn
      )

      expect(answer).toMatchObject({ proposed: true, edits: 2, document: { path: 'Plan' } })
      expect(store.getDocument('doc_plan').content).toBe(TEXT)
      expect(turn.edits).toHaveLength(1)
      expect(turn.edits[0]).toMatchObject({ tool: 'edit_document', status: 'proposed' })

      // What the writer's Accept makes is every one of them.
      const applied = await applyProposal(STORY, turn.edits[0])
      expect(applied.error).toBeUndefined()
      expect(store.getDocument('doc_plan').content).toBe(
        TEXT.replaceAll('noon', 'dusk').replace('rope', 'wire')
      )
    })
  })
})
