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

/** What the native side keeps for each connection, stood in for. */
const records = vi.hoisted(() => ({
  /** @type {Map<string, object>} */
  kept: new Map(),
}))
vi.mock('@/platform/apps.js', () => ({
  keptRead: vi.fn(
    async (connection, document) => records.kept.get(`${connection}/${document}`) ?? null
  ),
  // Whole, or the fields asked for, as the native side gives them.
  keptReads: vi.fn(async (connection, fields) =>
    [...records.kept]
      .filter(([key]) => key.startsWith(`${connection}/`))
      .map(([, record]) =>
        fields
          ? Object.fromEntries(fields.filter(f => f in record).map(f => [f, record[f]]))
          : record
      )
  ),
  keepRead: vi.fn(async (connection, document, record) => {
    records.kept.set(`${connection}/${document}`, JSON.parse(JSON.stringify(record)))
  }),
  forgetReads: vi.fn(async ({ connection, documents = [] }) => {
    for (const document of documents) records.kept.delete(`${connection}/${document}`)
  }),
  // What the stores say of a document deleted for good (`documentsStore`).
  forgetReadsOf: vi.fn(),
}))

import {
  CHANGED_SINCE_NOTE,
  EARLIER_NOTE,
  PASSED_MOST,
  UNKNOWN_NOTE,
  changesSince,
  keep,
  kept,
  stateAt,
  unchangedAt,
  withRevision,
} from '@/apps/revisions.js'
import {
  executeAddComment,
  executeDeleteDocument,
  executeEditDocument,
  executeMoveDocument,
  executeReadDocument,
  executeReplyComment,
  executeResolveComment,
  projectOverview,
} from '@/ai/tools/documents.js'
import * as platform from '@/platform/apps.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { useComments } from '@/composables/useComments.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

const STORY = 'story_1'
const APP = {
  id: 'app_1',
  name: 'Claude Code',
  projects: [STORY],
  readOnly: false,
}
const asking = { storyId: STORY, chatId: 'app:app_1', postsAs: 'Claude Code' }
/** The writer, at the keyboard: no chat, nothing suggested. */
const writer = { storyId: STORY }

const TEXT = ['# The vault', '', 'The vault opens at noon.', '', 'Bring rope and a lamp.'].join(
  '\n'
)

/** @type {ReturnType<typeof useDocumentsStore>} */
let store

/** The plan's revision as the connection reads it now. */
const revision = async () => (await stateAt(asking, 'Plan')).seen.revision

/** Have the connection read the plan, as a whole read does. */
const read = () =>
  withRevision(
    APP,
    asking,
    'Plan',
    () => executeReadDocument({ path: 'Plan' }, asking),
    () => true
  )

beforeEach(async () => {
  setActivePinia(createPinia())
  clearDocumentInstances()
  vi.clearAllMocks()
  records.kept = new Map()
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
  store.createDocument({
    id: 'doc_crew',
    storyId: STORY,
    parentId: 'folder_notes',
    type: 'text',
    title: 'Crew',
    content: 'Mara picks locks.',
  })
})

describe('a document’s revision', () => {
  it('is the same for the same text and comments, and changes with the text', async () => {
    const first = await revision()
    expect(await revision()).toBe(first)

    await executeEditDocument({ path: 'Plan', old: 'rope', new: 'wire' }, writer)
    expect(await revision()).not.toBe(first)
  })

  it('changes when a comment is made, answered or resolved', async () => {
    const seen = [await revision()]
    const { comment } = await executeAddComment(
      { path: 'Plan', passage: 'Bring rope', text: 'How much?' },
      writer
    )
    seen.push(await revision())
    await executeReplyComment({ path: 'Plan', id: comment, text: 'Thirty metres.' }, writer)
    seen.push(await revision())
    await executeResolveComment({ path: 'Plan', id: comment }, writer)
    seen.push(await revision())

    expect(new Set(seen).size).toBe(4)
  })

  it('changes with a suggestion, the connection’s own or another’s: a read lists both', async () => {
    const first = await revision()
    await executeEditDocument(
      { path: 'Plan', old: 'noon', new: 'dusk' },
      { storyId: STORY, chatId: 'app:app_2', propose: true }
    )
    const second = await revision()
    expect(second).not.toBe(first)

    await executeEditDocument(
      { path: 'Plan', old: 'rope', new: 'wire' },
      { ...asking, propose: true }
    )
    expect(await revision()).not.toBe(second)
  })

  it('is of nothing for a folder, or a path with no document', async () => {
    expect(await stateAt(asking, 'notes')).toBeNull()
    expect(await stateAt(asking, 'Nothing')).toBeNull()
  })
})

describe('withRevision', () => {
  it('puts the revision in a read’s answer, and keeps what the connection has', async () => {
    const answer = await read()

    expect(answer.revision).toBe(await revision())
    expect(answer.content).toBe(TEXT)
    expect(await kept(APP, 'doc_plan')).toMatchObject({
      storyId: STORY,
      document: 'doc_plan',
      path: 'Plan',
      revision: answer.revision,
      text: TEXT,
    })
  })

  it('keeps what a write left, when the connection was up to date', async () => {
    const { revision: read1 } = await read()
    const edit = { path: 'Plan', old: 'rope', new: 'wire' }
    const answer = await withRevision(APP, asking, 'Plan', () => executeEditDocument(edit, asking))

    expect(answer.success).toBe(true)
    expect(answer.revision).not.toBe(read1)
    expect(answer.changedSince).toBeUndefined()
    expect((await kept(APP, 'doc_plan')).text).toBe(TEXT.replace('rope', 'wire'))
  })

  it('says so, and keeps what it had, when the document had changed besides the write', async () => {
    const { revision: had } = await read()
    await executeEditDocument({ path: 'Plan', old: 'noon', new: 'dusk' }, writer)

    const edit = { path: 'Plan', old: 'rope', new: 'wire' }
    const answer = await withRevision(APP, asking, 'Plan', () => executeEditDocument(edit, asking))

    expect(answer.changedSince).toEqual({ revision: had, note: CHANGED_SINCE_NOTE })
    expect(answer.revision).toBe(await revision())
    // What it had is still there to tell changes from.
    expect((await kept(APP, 'doc_plan')).revision).toBe(had)
    const since = await changesSince(APP, asking, { path: 'Plan', revision: had })
    expect(since.content).toContain('-The vault opens at noon.')
    expect(since.content).toContain('+Bring wire and a lamp.')
  })

  it('keeps what a write left for a connection that had read nothing of the document', async () => {
    const edit = { path: 'Plan', old: 'rope', new: 'wire' }
    const answer = await withRevision(APP, asking, 'Plan', () => executeEditDocument(edit, asking))

    expect(answer.changedSince).toBeUndefined()
    expect((await kept(APP, 'doc_plan')).revision).toBe(answer.revision)
  })

  it('leaves a part read as a write is: what is kept stays when the rest had changed', async () => {
    const { revision: had } = await read()
    await executeEditDocument({ path: 'Plan', old: 'noon', new: 'dusk' }, writer)

    const part = await withRevision(
      APP,
      asking,
      'Plan',
      () => executeReadDocument({ path: 'Plan' }, asking),
      () => false
    )

    expect(part.changedSince.revision).toBe(had)
    expect((await kept(APP, 'doc_plan')).revision).toBe(had)
  })

  it('adds nothing to a refusal', async () => {
    const answer = await withRevision(APP, asking, 'Nothing', () =>
      executeReadDocument({ path: 'Nothing' }, asking)
    )
    expect(answer.error).toContain('No document')
    expect(answer.revision).toBeUndefined()
  })
})

describe('unchangedAt', () => {
  it('says a document is still at the revision the connection holds', async () => {
    const { revision: had } = await read()
    expect(await unchangedAt(APP, asking, 'Plan', had)).toEqual({
      path: 'Plan',
      revision: had,
      unchanged: 'Unchanged since that revision.',
    })
  })

  it('says nothing once it has changed, or for no revision', async () => {
    const { revision: had } = await read()
    await executeEditDocument({ path: 'Plan', old: 'rope', new: 'wire' }, writer)

    expect(await unchangedAt(APP, asking, 'Plan', had)).toBeNull()
    expect(await unchangedAt(APP, asking, 'Plan', undefined)).toBeNull()
    expect(await unchangedAt(APP, asking, 'Nothing', had)).toBeNull()
  })
})

describe('changesSince', () => {
  it('says nothing has changed at the revision the document is at', async () => {
    const { revision: had } = await read()
    expect(await changesSince(APP, asking, { path: 'Plan', revision: had })).toEqual({
      path: 'Plan',
      revision: had,
      unchanged: 'Nothing has changed since that revision.',
    })
  })

  it('gives what the writer changed as a diff, and the revision it is at now', async () => {
    const { revision: had } = await read()
    await executeEditDocument({ path: 'Plan', old: 'rope', new: 'wire' }, writer)

    const since = await changesSince(APP, asking, { path: 'Plan', revision: had })

    expect(since).toMatchObject({ path: 'Plan', since: had, revision: await revision() })
    expect(since.content).toBe(
      [
        '@@ -3,3 +3,3 @@',
        ' The vault opens at noon.',
        ' ',
        '-Bring rope and a lamp.',
        '+Bring wire and a lamp.',
      ].join('\n')
    )
    expect(since.comments).toBeUndefined()
  })

  it('brings the connection up to date: asked again, nothing has changed', async () => {
    const { revision: had } = await read()
    await executeEditDocument({ path: 'Plan', old: 'rope', new: 'wire' }, writer)
    const since = await changesSince(APP, asking, { path: 'Plan', revision: had })

    expect(
      (await changesSince(APP, asking, { path: 'Plan', revision: since.revision })).unchanged
    ).toBe('Nothing has changed since that revision.')
    // The one before is one it held on the way: it has seen what changed since.
    expect(await changesSince(APP, asking, { path: 'Plan', revision: had })).toEqual({
      path: 'Plan',
      revision: since.revision,
      unchanged: 'Nothing has changed since you last read or wrote it.',
    })
  })

  describe('asked with a revision from before the connection’s own later calls', () => {
    /** Have the connection change the plan, as a call to a tool does. */
    const write = (old, becomes) =>
      withRevision(APP, asking, 'Plan', () =>
        executeEditDocument({ path: 'Plan', old, new: becomes }, asking)
      )

    it('says nothing has changed when only its own writes have', async () => {
      const { revision: first } = await read()
      const { revision: second } = await write('rope', 'wire')
      const { revision: third } = await write('a lamp', 'two lamps')

      for (const held of [first, second]) {
        expect(await changesSince(APP, asking, { path: 'Plan', revision: held })).toEqual({
          path: 'Plan',
          revision: third,
          unchanged: 'Nothing has changed since you last read or wrote it.',
        })
      }
    })

    it('shows what the writer changed since the last of them, and says where from', async () => {
      const { revision: first } = await read()
      const { revision: second } = await write('rope', 'wire')
      await executeEditDocument({ path: 'Plan', old: 'noon', new: 'dusk' }, writer)

      const since = await changesSince(APP, asking, { path: 'Plan', revision: first })

      expect(since).toMatchObject({
        revision: await revision(),
        since: second,
        earlier: EARLIER_NOTE,
      })
      expect(since.content).toContain('-The vault opens at noon.')
      expect(since.content).toContain('+The vault opens at dusk.')
      // Its own change is not news to it.
      expect(since.content).not.toContain('-Bring rope')
    })

    it('says no such thing of the revision it last had', async () => {
      const { revision: had } = await read()
      await executeEditDocument({ path: 'Plan', old: 'noon', new: 'dusk' }, writer)

      const since = await changesSince(APP, asking, { path: 'Plan', revision: had })
      expect(since.since).toBe(had)
      expect(since.earlier).toBeUndefined()
    })

    it('goes on knowing them through a whole read, and through what it was shown', async () => {
      const { revision: first } = await read()
      await executeEditDocument({ path: 'Plan', old: 'noon', new: 'dusk' }, writer)
      const { revision: second } = await read()
      await executeEditDocument({ path: 'Plan', old: 'rope', new: 'wire' }, writer)
      const shown = await changesSince(APP, asking, { path: 'Plan', revision: second })

      expect((await kept(APP, 'doc_plan')).passed).toEqual([first, second])
      expect((await changesSince(APP, asking, { path: 'Plan', revision: first })).unchanged).toBe(
        'Nothing has changed since you last read or wrote it.'
      )
      expect(shown.since).toBe(second)
    })

    it('lets them go where it has not seen what changed between', async () => {
      const { revision: first } = await read()
      await executeEditDocument({ path: 'Plan', old: 'noon', new: 'dusk' }, writer)
      // A write over a change it has not seen: what is kept stays, and the
      // revision the write left is not one it is known to hold.
      const { revision: left } = await write('rope', 'wire')
      expect((await kept(APP, 'doc_plan')).revision).toBe(first)

      // It reads at that revision: brought up to date without the change shown.
      expect(await unchangedAt(APP, asking, 'Plan', left)).toMatchObject({ revision: left })
      expect((await kept(APP, 'doc_plan')).passed).toBeUndefined()
      expect((await changesSince(APP, asking, { path: 'Plan', revision: first })).unknown).toBe(
        UNKNOWN_NOTE
      )
    })

    it('remembers only so many, the latest', async () => {
      const held = [(await read()).revision]
      for (let n = 0; n < PASSED_MOST + 2; n++) {
        held.push((await write(n === 0 ? 'rope' : `rope ${n - 1}`, `rope ${n}`)).revision)
      }

      const { passed } = await kept(APP, 'doc_plan')
      expect(passed).toHaveLength(PASSED_MOST)
      expect(passed).toEqual(held.slice(-PASSED_MOST - 1, -1))
      expect((await changesSince(APP, asking, { path: 'Plan', revision: held[0] })).unknown).toBe(
        UNKNOWN_NOTE
      )
    })
  })

  it('tells of a comment made, one answered, and one resolved', async () => {
    const mine = await executeAddComment(
      { path: 'Plan', passage: 'Bring rope', text: 'How much?' },
      asking
    )
    const old = await executeAddComment({ path: 'Plan', passage: 'at noon', text: 'Sure?' }, asking)
    const { revision: had } = await read()

    await executeReplyComment({ path: 'Plan', id: mine.comment, text: 'Thirty metres.' }, writer)
    await executeResolveComment({ path: 'Plan', id: old.comment }, writer)
    const made = await executeAddComment(
      { path: 'Plan', passage: 'a lamp', text: 'Two lamps.' },
      writer
    )

    const since = await changesSince(APP, asking, { path: 'Plan', revision: had })

    expect(since.text).toBe('The text is as it was.')
    const byId = Object.fromEntries(since.comments.map(comment => [comment.id, comment]))
    expect(byId[mine.comment]).toEqual({
      id: mine.comment,
      passage: 'Bring rope',
      posts: [{ author: 'model', text: 'Thirty metres.' }],
    })
    expect(byId[old.comment]).toEqual({ id: old.comment, passage: 'at noon', resolved: true })
    expect(byId[made.comment]).toMatchObject({ new: true, passage: 'a lamp' })
    expect(byId[made.comment].posts).toHaveLength(1)
  })

  it('tells which of the connection’s suggestions the writer accepted and rejected', async () => {
    const suggesting = { ...asking, propose: true }
    const first = await executeEditDocument({ path: 'Plan', old: 'noon', new: 'dusk' }, suggesting)
    const second = await executeEditDocument({ path: 'Plan', old: 'rope', new: 'wire' }, suggesting)
    const { revision: had } = await read()

    const comments = useComments(STORY)
    expect(comments.accept('doc_plan', first.suggestion)).toBe(true)
    expect(comments.reject('doc_plan', second.suggestion)).toBe(true)

    const since = await changesSince(APP, asking, { path: 'Plan', revision: had })
    expect(since.suggestions).toHaveLength(2)
    expect(since.suggestions).toEqual(
      expect.arrayContaining([
        { id: first.suggestion, by: 'you', outcome: 'accepted', from: 'noon', to: 'dusk' },
        { id: second.suggestion, by: 'you', outcome: 'rejected', from: 'rope', to: 'wire' },
      ])
    )
    // The accepted one is in the text for everyone now; to the connection,
    // which read it as made, only the rejected one is a change.
    expect(since.content).toContain('-Bring wire and a lamp.')
    expect(since.content).toContain('+Bring rope and a lamp.')
    expect(since.content).not.toContain('noon')
  })

  it('tells what was said on a suggestion since, one still waiting and one settled', async () => {
    const suggesting = { ...asking, propose: true }
    const first = await executeEditDocument({ path: 'Plan', old: 'noon', new: 'dusk' }, suggesting)
    const second = await executeEditDocument({ path: 'Plan', old: 'rope', new: 'wire' }, suggesting)
    // One in another paragraph, so it is a suggestion of its own.
    const quiet = await executeEditDocument(
      { path: 'Plan', old: '# The vault', new: '# The heist' },
      suggesting
    )
    // Its own word on one, said before it last had the document: not news.
    await executeReplyComment(
      { path: 'Plan', id: first.suggestion, text: 'The guard changes at dusk.' },
      asking
    )
    const { revision: had } = await read()

    await executeReplyComment({ path: 'Plan', id: first.suggestion, text: 'Which gate?' }, writer)
    await executeReplyComment(
      { path: 'Plan', id: second.suggestion, text: 'Rope is quieter.' },
      writer
    )
    expect(useComments(STORY).reject('doc_plan', second.suggestion)).toBe(true)

    const since = await changesSince(APP, asking, { path: 'Plan', revision: had })
    const byId = Object.fromEntries(since.suggestions.map(each => [each.id, each]))

    // Still waiting, and answered.
    expect(byId[first.suggestion]).toEqual({
      id: first.suggestion,
      by: 'you',
      from: 'noon',
      to: 'dusk',
      posts: [{ author: 'model', text: 'Which gate?' }],
    })
    // Turned down, with why.
    expect(byId[second.suggestion]).toEqual({
      id: second.suggestion,
      by: 'you',
      outcome: 'rejected',
      from: 'rope',
      to: 'wire',
      posts: [{ author: 'model', text: 'Rope is quieter.' }],
    })
    // Nothing became of the third, and a suggestion's thread is no comment's.
    expect(byId[quiet.suggestion]).toBeUndefined()
    expect(since.comments).toBeUndefined()

    // Told once: asked again, only what is said after.
    await executeReplyComment({ path: 'Plan', id: second.suggestion, text: 'Sorry.' }, writer)
    const later = await changesSince(APP, asking, { path: 'Plan', revision: since.revision })
    expect(later.suggestions).toEqual([
      {
        id: second.suggestion,
        by: 'you',
        outcome: 'rejected',
        from: 'rope',
        to: 'wire',
        posts: [{ author: 'model', text: 'Sorry.' }],
      },
    ])
  })

  it('tells of a change someone else suggested since, and of what became of it', async () => {
    const { revision: had } = await read()
    // inksprite's own assistant, in a chat, suggests; the text is as it was.
    const theirs = await executeEditDocument(
      { path: 'Plan', old: 'noon', new: 'dusk' },
      { storyId: STORY, chatId: 'chat_9', propose: true }
    )
    await executeReplyComment(
      { path: 'Plan', id: theirs.suggestion, text: 'Dusk suits the plan.' },
      { storyId: STORY, chatId: 'chat_9' }
    )

    const since = await changesSince(APP, asking, { path: 'Plan', revision: had })
    expect(since.text).toBe('The text is as it was.')
    expect(since.suggestions).toEqual([
      {
        id: theirs.suggestion,
        by: 'model',
        from: 'noon',
        to: 'dusk',
        new: true,
        posts: [{ author: 'model', text: 'Dusk suits the plan.' }],
      },
    ])

    // Accepted, it is in the text for everyone, the connection among them.
    expect(useComments(STORY).accept('doc_plan', theirs.suggestion)).toBe(true)
    const later = await changesSince(APP, asking, { path: 'Plan', revision: since.revision })
    expect(later.suggestions).toEqual([
      { id: theirs.suggestion, by: 'model', outcome: 'accepted', from: 'noon', to: 'dusk' },
    ])
    expect(later.content).toContain('+The vault opens at dusk.')
  })

  it('says to read again for a revision it has no record of', async () => {
    await read()
    await executeEditDocument({ path: 'Plan', old: 'rope', new: 'wire' }, writer)

    expect(await changesSince(APP, asking, { path: 'Plan', revision: 'not.one' })).toEqual({
      path: 'Plan',
      revision: await revision(),
      unknown: UNKNOWN_NOTE,
    })
    // And for a document the connection never read.
    const crew = await changesSince(APP, asking, { path: 'notes/Crew', revision: 'any' })
    expect(crew.unknown).toBe(UNKNOWN_NOTE)
  })

  it('asks for the revision of a document, and says when nothing is there', async () => {
    expect((await changesSince(APP, asking, { path: 'Plan' })).error).toContain('"revision"')
    expect((await changesSince(APP, asking, { path: 'Nowhere', revision: 'x' })).error).toContain(
      'Nothing at "Nowhere"'
    )
  })

  it('says where a document was, when it has moved since', async () => {
    const { revision: had } = await read()
    await executeMoveDocument({ path: 'Plan', to: 'notes/Plan' }, writer)
    await executeEditDocument({ path: 'notes/Plan', old: 'rope', new: 'wire' }, writer)

    const since = await changesSince(APP, asking, { path: 'notes/Plan', revision: had })
    expect(since).toMatchObject({ path: 'notes/Plan', movedFrom: 'Plan' })
  })

  describe('of a folder', () => {
    const readCrew = () =>
      withRevision(
        APP,
        asking,
        'notes/Crew',
        () => executeReadDocument({ path: 'notes/Crew' }, asking),
        () => true
      )

    it('names the documents the connection has read that have changed, with the revision it had', async () => {
      const plan = await read()
      await readCrew()
      await executeEditDocument({ path: 'Plan', old: 'rope', new: 'wire' }, writer)

      const since = await changesSince(APP, asking, { path: '/' })
      expect(since.changed).toEqual([{ path: 'Plan', revision: plan.revision }])
      expect(since.gone).toBeUndefined()

      expect((await changesSince(APP, asking, {})).changed).toHaveLength(1)
    })

    it('looks only under the folder named', async () => {
      await read()
      const crew = await readCrew()
      await executeEditDocument({ path: 'Plan', old: 'rope', new: 'wire' }, writer)
      await executeEditDocument({ path: 'notes/Crew', old: 'locks', new: 'safes' }, writer)

      const since = await changesSince(APP, asking, { path: 'notes' })
      expect(since.changed).toEqual([{ path: 'notes/Crew', revision: crew.revision }])
    })

    it('says nothing has changed when nothing read has, and leaves out what was never read', async () => {
      await read()
      await executeEditDocument({ path: 'notes/Crew', old: 'locks', new: 'safes' }, writer)

      const since = await changesSince(APP, asking, { path: '/' })
      expect(since.changed).toEqual([])
      expect(since.note).toBe('Nothing you have read here has changed.')
    })

    it('names a document that is gone, once, and keeps its text no longer', async () => {
      await read()
      await readCrew()
      await executeDeleteDocument({ path: 'notes/Crew' }, writer)
      expect(records.kept.get('app_1/doc_crew').text).toBe('Mara picks locks.')

      const since = await changesSince(APP, asking, { path: '/' })
      expect(since.gone).toEqual(['notes/Crew'])
      // Told of, it is let go of: the copy of its text with it, and no other's.
      expect(platform.forgetReads).toHaveBeenCalledWith({
        connection: 'app_1',
        documents: ['doc_crew'],
      })
      expect([...records.kept.keys()]).toEqual(['app_1/doc_plan'])

      // Asked again, it is not told of again.
      expect((await changesSince(APP, asking, { path: '/' })).gone).toBeUndefined()
    })

    it('goes on keeping what is gone from somewhere it was not asked about', async () => {
      await readCrew()
      await executeDeleteDocument({ path: 'notes/Crew' }, writer)
      store.createDocument({
        id: 'folder_other',
        storyId: STORY,
        parentId: rootIdFor(STORY),
        type: 'folder',
        title: 'other',
      })

      // Not under the folder asked about: not told of, so not let go of yet.
      expect((await changesSince(APP, asking, { path: 'other' })).gone).toBeUndefined()
      expect(platform.forgetReads).not.toHaveBeenCalled()
      expect((await changesSince(APP, asking, { path: 'notes' })).gone).toEqual(['notes/Crew'])
    })

    it('lets go of one hidden since as of one deleted, and says no more of it', async () => {
      await readCrew()
      store.updateDocument('doc_crew', { hidden: true })

      expect((await changesSince(APP, asking, { path: '/' })).gone).toEqual(['notes/Crew'])
      expect(records.kept.has('app_1/doc_crew')).toBe(false)
    })

    it('asks the native side for what it needs of each record, and for no document’s text', async () => {
      await read()
      await readCrew()

      await changesSince(APP, asking, { path: '/' })

      expect(platform.keptReads).toHaveBeenCalledWith('app_1', [
        'storyId',
        'document',
        'path',
        'revision',
      ])
      const handed = await platform.keptReads.mock.results.at(-1).value
      expect(handed).toHaveLength(2)
      for (const record of handed) expect(record).not.toHaveProperty('text')
    })

    it('knows nothing of another project’s documents, or another connection’s reads', async () => {
      await read()
      await keep(
        { ...APP, id: 'app_2' },
        { ...(await stateAt(asking, 'Plan')).seen, revision: 'old' }
      )
      records.kept.set('app_1/doc_else', {
        storyId: 'story_2',
        document: 'doc_else',
        path: 'Else',
        revision: 'x',
        text: '',
        threads: {},
      })

      expect((await changesSince(APP, asking, { path: '/' })).changed).toEqual([])
    })
  })
})
