import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  projectOverview,
  pinnedDocuments,
  readNotes,
  documentLocator,
  executeReadDocument,
  executeSearchDocuments,
  executeCreateDocument,
  executeCreateFolder,
  executeUpdateDocument,
  executeAppendDocument,
  executeEditDocument,
  executeListDocuments,
  LISTING_LIMIT,
  nearestContext,
  applyProposal,
  PROPOSED_NOTE,
} from '@/ai/tools/documents.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useChatsStore } from '@/stores/chatsStore'
import { useMessagesStore } from '@/stores/messagesStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { notesIdFor, manuscriptIdFor, rootIdFor } from '@/stores/migrations/projectTree.js'
import { setLibrarySkills } from '@/ai/skills/index.js'
import { textHash } from '@/ai/context/reads.js'

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
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const STORY = 'story_1'
const context = { storyId: STORY }

/**
 * The paths a listing of the whole project gives: what the model can see of
 * it, for the chat named or for none.
 *
 * @param {string} [chatId]
 */
const listedPaths = async chatId => {
  const listing = await executeListDocuments({}, { storyId: STORY, ...(chatId ? { chatId } : {}) })
  if (typeof listing !== 'string' || listing.endsWith('is empty.')) return []
  return listing.split('\n').map(line => line.split(' — ')[0].replace(/\/$/, ''))
}

/** The ids of what a chat has pinned. */
const pinnedIds = async chat => (await pinnedDocuments(STORY, chat)).map(entry => entry.id)

describe('document tools', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    store = useDocumentsStore()
    vi.clearAllMocks()
  })

  /** Seed a story that has been through the project-tree migration. */
  const seed = async () => {
    // init() builds the root; a migrated story's manuscript and notes are its
    // own, so they are laid down here like any other folder.
    await projectOverview(STORY)

    store.createDocument({
      id: manuscriptIdFor(STORY),
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'folder',
      title: 'manuscript',
      ordered: true,
    })
    store.createDocument({
      id: notesIdFor(STORY),
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'folder',
      title: 'notes',
    })

    store.updateDocument(rootIdFor(STORY), {
      title: 'My Story',
      summary: 'A knight rides north.',
    })
    store.createDocument({
      id: 'cat_1',
      storyId: STORY,
      parentId: notesIdFor(STORY),
      type: 'folder',
      title: 'Characters',
    })
    store.createDocument({
      id: 'lore_1',
      storyId: STORY,
      parentId: 'cat_1',
      type: 'text',
      title: 'Elara',
      content: 'A knight of the north.',
    })
    store.updateDocument('lore_1', { summary: 'A knight.' })
    store.createDocument({
      id: 'sc_1',
      storyId: STORY,
      parentId: manuscriptIdFor(STORY),
      type: 'text',
      title: 'Chapter 1',
      content: 'Snow fell on the road.',
    })
  }

  describe('pinnedDocuments', () => {
    it('resolves a document to itself, with its path and length', async () => {
      await seed()

      expect(await pinnedDocuments(STORY, { pinnedIds: ['lore_1'] })).toEqual([
        { id: 'lore_1', path: 'notes/Characters/Elara', type: 'text', words: expect.any(Number) },
      ])
    })

    it('resolves a folder to the text under it, however deep', async () => {
      await seed()

      // A writer points at the character's folder, not at the six documents
      // inside it.
      expect(await pinnedIds({ pinnedIds: [notesIdFor(STORY)] })).toEqual(['lore_1'])
    })

    it('leaves out folders themselves', async () => {
      await seed()

      // A folder is a line in the listing already, and the listing is its
      // content.
      const ids = await pinnedIds({ pinnedIds: [rootIdFor(STORY)] })
      expect(ids).not.toContain('cat_1')
      expect(ids.sort()).toEqual(['lore_1', 'sc_1'])
    })

    it('leaves out anything hidden, and anything under something hidden', async () => {
      await seed()
      store.updateDocument('cat_1', { hidden: true })

      // Pinning the folder above it must not smuggle back in what the writer
      // took out of the model's reach.
      expect(await pinnedIds({ pinnedIds: [notesIdFor(STORY)] })).toEqual([])
      expect(await pinnedIds({ pinnedIds: ['lore_1'] })).toEqual([])
    })

    it('names each document once however many pins reach it', async () => {
      await seed()

      expect(await pinnedIds({ pinnedIds: ['lore_1', 'cat_1', notesIdFor(STORY)] })).toEqual([
        'lore_1',
      ])
    })

    it('skips a pin on a document that is gone', async () => {
      await seed()

      // The writer deleted it, which is an answer. Not an error to raise at a
      // turn that is trying to be taken.
      expect(await pinnedIds({ pinnedIds: ['nothing_here', 'lore_1'] })).toEqual(['lore_1'])
    })

    it('does nothing when the chat has pinned nothing', async () => {
      await seed()

      expect(await pinnedIds({ pinnedIds: [] })).toEqual([])
      expect(await pinnedIds(null)).toEqual([])
    })

    it('leaves out what the chat hid inside a pinned folder', async () => {
      await seed()

      const chat = { pinnedIds: [rootIdFor(STORY)], hiddenIds: ['cat_1'] }
      expect(await pinnedIds(chat)).toEqual(['sc_1'])
    })

    it('leaves out what the chat only shows inside a pinned folder', async () => {
      // A card's greetings are shown, not pinned: in context as well as in the
      // conversation would be the same words twice.
      await seed()

      const chat = { pinnedIds: [rootIdFor(STORY)], shownIds: ['lore_1'] }
      expect(await pinnedIds(chat)).toEqual(['sc_1'])
    })

    it('keeps a pin under a folder the chat hid', async () => {
      await seed()

      const chat = { pinnedIds: ['lore_1'], hiddenIds: [notesIdFor(STORY)] }
      expect(await pinnedIds(chat)).toEqual(['lore_1'])
    })
  })

  describe('a chat’s own marks', () => {
    const CHAT = 'chat_1'
    const inChat = { storyId: STORY, chatId: CHAT }

    /** @param {Object} marks */
    const markChat = marks =>
      useChatsStore().chats.set(CHAT, { id: CHAT, storyId: STORY, ...marks })

    it('keeps what the chat hid out of a listing', async () => {
      await seed()
      markChat({ hiddenIds: [notesIdFor(STORY)] })

      expect(await listedPaths(CHAT)).toEqual(['manuscript', 'manuscript/Chapter 1'])
    })

    it('lists one thing shown under a folder the chat hid, at its full path', async () => {
      await seed()
      markChat({ hiddenIds: [notesIdFor(STORY)], shownIds: ['lore_1'] })

      expect(await listedPaths(CHAT)).toEqual([
        'manuscript',
        'manuscript/Chapter 1',
        'notes/Characters/Elara',
      ])
    })

    it('says how to read a skill’s file asked for as a document', async () => {
      await seed()
      setLibrarySkills([
        {
          id: 'skill_style',
          text: '---\nname: house-style\ndescription: The house style.\n---\n\nSee references/voice.md.\n',
          files: [{ path: 'references/voice.md', content: 'No dashes.' }],
        },
      ])

      try {
        // Asked the way GLM 5.2 asked in the harness, after loading the skill.
        const { error } = await executeReadDocument({ path: 'references/voice.md' }, inChat)

        expect(error).toContain('No document at "references/voice.md"')
        expect(error).toContain('use_skill(name: "house-style", file: "references/voice.md")')
        expect((await executeReadDocument({ path: 'notes/Nobody' }, inChat)).error).toBe(
          'No document at "notes/Nobody". list_documents shows what the project holds.'
        )
      } finally {
        setLibrarySkills([])
      }
    })

    it('does not find, search or write at what the chat hid', async () => {
      await seed()
      markChat({ hiddenIds: ['cat_1'] })

      // To the model a hidden path is not there, so a right guess reads like a
      // wrong one.
      expect(await executeReadDocument({ path: 'notes/Characters/Elara' }, inChat)).toEqual({
        error:
          'No document at "notes/Characters/Elara". list_documents shows what the project holds.',
      })
      expect((await executeSearchDocuments({ query: 'knight' }, inChat)).results).toEqual([])
      expect(
        await executeUpdateDocument(
          { path: 'notes/Characters/Elara', content: 'x' },
          { ...inChat, edits: [] }
        )
      ).toHaveProperty('error')
    })

    it('reads what another chat hid', async () => {
      await seed()
      markChat({ hiddenIds: ['cat_1'] })

      const read = await executeReadDocument({ path: 'notes/Characters/Elara' }, context)
      expect(read.content).toBe('A knight of the north.')
    })

    it('names no child the chat hid when a folder is read', async () => {
      await seed()
      markChat({ hiddenIds: ['cat_1'] })

      expect(await executeListDocuments({ path: 'notes' }, inChat)).toBe('"notes" is empty.')
    })

    it('will not rename on top of what the chat hid', async () => {
      await seed()
      store.createDocument({
        id: 'lore_2',
        storyId: STORY,
        parentId: 'cat_1',
        type: 'text',
        title: 'Riley',
      })
      markChat({ hiddenIds: ['lore_2'] })

      const renamed = await executeUpdateDocument(
        { path: 'notes/Characters/Elara', updates: { title: 'Riley' } },
        { ...inChat, edits: [] }
      )
      expect(renamed).toEqual({
        error: '"notes/Characters/Riley" is not available. Choose a different title.',
      })
    })

    it('will not create on top of what the chat hid', async () => {
      await seed()
      markChat({ hiddenIds: ['lore_1'] })

      const made = await executeCreateDocument(
        { path: 'notes/Characters/Elara', content: 'x' },
        { ...inChat, edits: [] }
      )
      expect(made).toEqual({
        error: '"notes/Characters/Elara" is not available. Choose a different title.',
      })
    })
  })

  describe('projectOverview', () => {
    it('names the project and says how much is in it, and lists none of it', async () => {
      await seed()
      const overview = await projectOverview(STORY)

      // The project is the container, so its name and the story's overview are
      // what the block says of it; what is in it is a listing away.
      expect(overview).toEqual({
        project: 'My Story',
        summary: 'A knight rides north.',
        size: { documents: 2, folders: 3 },
      })
    })

    it('counts only what the chat can see', async () => {
      await seed()

      expect((await projectOverview(STORY, { hiddenIds: [notesIdFor(STORY)] })).size).toEqual({
        documents: 1,
        folders: 1,
      })
    })

    it('omits an overview nobody wrote rather than sending it empty', async () => {
      await seed()
      store.updateDocument(rootIdFor(STORY), { summary: '' })

      expect(await projectOverview(STORY)).not.toHaveProperty('summary')
    })
  })

  describe('readNotes', () => {
    it('notes the document a read returned, where it was, and its text', async () => {
      await seed()
      const result = await executeReadDocument({ path: 'notes/Characters/Elara' }, context)

      expect(readNotes('read_document', result)).toEqual({
        _document: 'lore_1',
        _path: 'notes/Characters/Elara',
        _hash: textHash('A knight of the north.'),
      })
    })

    it('ignores a write, which the model already knows the contents of', async () => {
      await seed()
      const result = await executeCreateDocument({ path: 'Places', content: '' }, context)

      expect(readNotes('create_document', result)).toBeNull()
    })

    it('ignores a read that found nothing', async () => {
      await seed()
      const result = await executeReadDocument({ path: 'Nowhere' }, context)

      expect(readNotes('read_document', result)).toBeNull()
    })
  })

  describe('documentLocator', () => {
    it('says where a document is now and what it says, and nothing of what is gone', async () => {
      await seed()
      const locate = await documentLocator(STORY)

      expect(locate('lore_1')).toEqual({
        path: 'notes/Characters/Elara',
        text: 'A knight of the north.',
      })
      expect(locate('nothing')).toBeNull()
      expect(locate(notesIdFor(STORY))).toBeNull()
    })

    it('says nothing of a document hidden from the chat', async () => {
      await seed()
      const locate = await documentLocator(STORY, { hiddenIds: ['lore_1'] })

      expect(locate('lore_1')).toBeNull()
    })
  })

  describe('reads and pins', () => {
    const CHAT = 'chat_1'

    it('says nothing of pins or of how often it was read, and pins nothing', async () => {
      await seed()
      useChatsStore().chats.set(CHAT, { id: CHAT, storyId: STORY })

      const result = await executeReadDocument(
        { path: 'notes/Characters/Elara', keep: true },
        { storyId: STORY, chatId: CHAT }
      )

      expect(result.content).toBe('A knight of the north.')
      expect(result).not.toHaveProperty('pinned-by')
      expect(result).not.toHaveProperty('reads')
      expect(useChatsStore().getChatById(CHAT).pinnedIds).toBeUndefined()
    })
  })

  describe('list_documents', () => {
    it('lists the whole project by full path, with lengths and pins', async () => {
      await seed()
      const CHAT = 'chat_1'
      useChatsStore().chats.set(CHAT, { id: CHAT, storyId: STORY, pinnedIds: ['lore_1'] })

      const listing = await executeListDocuments({}, { storyId: STORY, chatId: CHAT })

      expect(listing).toBe(
        [
          'manuscript/',
          'manuscript/Chapter 1 — 5 words',
          'notes/',
          'notes/Characters/',
          'notes/Characters/Elara — 5 words, pinned',
        ].join('\n')
      )
    })

    it('lists under one folder, and as deep as asked', async () => {
      await seed()

      expect(await executeListDocuments({ path: 'notes' }, context)).toBe(
        'notes/Characters/\nnotes/Characters/Elara — 5 words'
      )
      expect(await executeListDocuments({ path: '/', depth: 1 }, context)).toBe(
        'manuscript/ — 1 inside, not listed\nnotes/ — 2 inside, not listed'
      )
    })

    it('lists less deep when everything would not fit, saying what each folder holds', async () => {
      await seed()
      for (let i = 0; i < LISTING_LIMIT; i++) {
        store.createDocument({
          id: `many_${i}`,
          storyId: STORY,
          parentId: 'cat_1',
          type: 'text',
          title: `Person ${i}`,
        })
      }

      const listing = await executeListDocuments({}, context)

      expect(listing).toContain(`notes/Characters/ — ${LISTING_LIMIT + 1} inside, not listed`)
      expect(listing).not.toContain('Person 0')
    })

    it('says a file is one, with its pages', async () => {
      await seed()
      store.createDocument({
        id: 'pdf_1',
        storyId: STORY,
        parentId: notesIdFor(STORY),
        type: 'file',
        title: 'Rules.pdf',
        pages: 12,
        content: 'Roll high.',
      })

      expect(await executeListDocuments({ path: 'notes' }, context)).toContain(
        'notes/Rules.pdf — file, 12 pages, 2 words'
      )
    })

    it('refuses a document, naming the tool that reads one', async () => {
      await seed()
      const result = await executeListDocuments({ path: 'notes/Characters/Elara' }, context)

      expect(result.error).toMatch(/read_document/)
    })

    it('reports a folder that is not there', async () => {
      await seed()
      expect((await executeListDocuments({ path: 'nowhere' }, context)).error).toContain('nowhere')
    })

    it('says an empty folder is empty', async () => {
      await seed()
      store.createDocument({
        id: 'empty',
        storyId: STORY,
        parentId: rootIdFor(STORY),
        type: 'folder',
        title: 'Places',
      })

      expect(await executeListDocuments({ path: 'Places' }, context)).toBe('"Places" is empty.')
      expect(await executeListDocuments({ path: '/', depth: 1 }, context)).toContain(
        'Places/ — empty'
      )
    })

    it('gives the paths the tools resolve, so the model can hand one back', async () => {
      await seed()
      const listed = (await listedPaths()).find(path => path.endsWith('Elara'))

      expect((await executeReadDocument({ path: listed }, context)).title).toBe('Elara')
    })

    it('addresses the project the same way every tool does', async () => {
      // Whatever is listed has to be what the tools accept: "/" is the top.
      await seed()

      expect(await executeListDocuments({ path: '/' }, context)).toContain('notes/')

      const created = await executeCreateFolder({ path: 'Places' }, context)
      expect(store.getDocument(created.document.id).parentId).toBe(rootIdFor(STORY))
    })

    it('takes a leading slash off a path that has one', async () => {
      // A model shown a root of "/" will write "/notes/Elara" eventually.
      await seed()
      const result = await executeReadDocument({ path: '/notes/Characters/Elara' }, context)

      expect(result.title).toBe('Elara')
    })
  })

  describe('read_document', () => {
    it('reads a document by path, as the markdown it holds', async () => {
      await seed()
      const result = await executeReadDocument({ path: 'notes/Characters/Elara' }, context)

      expect(result).toMatchObject({
        id: 'lore_1',
        title: 'Elara',
        type: 'text',
        // Exactly what is stored: the model reads back what it wrote.
        content: 'A knight of the north.',
      })
    })

    it('reports where a document lives', async () => {
      await seed()
      const result = await executeReadDocument({ path: 'notes/Characters/Elara' }, context)
      expect(result.path).toBe('notes/Characters/Elara')
    })

    it('tells two documents with one title apart', async () => {
      await seed()
      // A second "Elara", elsewhere in the tree. A bare title took the first
      // match in tree order, so one of these was unreachable and nothing said
      // which. The path is the only address for exactly this reason.
      store.createDocument({
        id: 'other',
        storyId: STORY,
        parentId: manuscriptIdFor(STORY),
        type: 'text',
        title: 'Elara',
      })

      expect((await executeReadDocument({ path: 'notes/Characters/Elara' }, context)).id).toBe(
        'lore_1'
      )
      expect((await executeReadDocument({ path: 'manuscript/Elara' }, context)).id).toBe('other')
    })

    it('refuses a bare title, which addresses nothing', async () => {
      await seed()
      const result = await executeReadDocument({ path: 'Elara' }, context)

      expect(result.error).toContain('Elara')
      expect(result.content).toBeUndefined()
    })

    it('refuses a folder, naming the tool that lists one', async () => {
      await seed()
      const result = await executeReadDocument({ path: 'notes/Characters' }, context)

      expect(result.error).toMatch(/list_documents/)
      expect(result.content).toBeUndefined()
    })

    it('reports a miss rather than guessing', async () => {
      await seed()
      const result = await executeReadDocument({ path: 'Nobody' }, context)
      expect(result.error).toContain('Nobody')
    })

    describe('a read still in the conversation', () => {
      const CHAT = 'chat_1'
      const inChat = {
        storyId: STORY,
        chatId: CHAT,
        conversation: () => useMessagesStore().getMessagesForChat(CHAT),
      }

      /** A turn that read Elara as she read then, keeping its document calls. */
      const readBefore = (text, args = {}) => {
        useChatsStore().chats.set(CHAT, { id: CHAT, storyId: STORY })
        useMessagesStore().messages.set('m1', {
          id: 'm1',
          chatId: CHAT,
          role: 'assistant',
          content: 'Read.',
          metadata: {
            documentCallsKept: true,
            apiTrajectory: [
              {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'c1',
                    type: 'function',
                    function: {
                      name: 'read_document',
                      arguments: JSON.stringify({ path: 'notes/Characters/Elara', ...args }),
                    },
                  },
                ],
              },
              {
                role: 'tool',
                tool_call_id: 'c1',
                content: '{}',
                _document: 'lore_1',
                _path: 'notes/Characters/Elara',
                _hash: textHash(text),
              },
            ],
          },
          deleted: false,
        })
      }

      it('is not sent twice while the text is the same', async () => {
        await seed()
        readBefore('A knight of the north.')

        const result = await executeReadDocument({ path: 'notes/Characters/Elara' }, inChat)

        expect(result.content).toBeUndefined()
        expect(result.unchanged).toMatch(/above/)
        expect(result.path).toBe('notes/Characters/Elara')
      })

      it('is sent to a caller that does not see the conversation’s calls', async () => {
        // A skill reads the conversation as a transcript: the read above is not
        // in front of it, so it gets the text.
        await seed()
        readBefore('A knight of the north.')

        const result = await executeReadDocument(
          { path: 'notes/Characters/Elara' },
          { storyId: STORY, chatId: CHAT }
        )

        expect(result.content).toBe('A knight of the north.')
      })

      it('is sent again once the text has changed, or for another part', async () => {
        await seed()
        readBefore('A knight of the south.')
        expect(
          (await executeReadDocument({ path: 'notes/Characters/Elara' }, inChat)).content
        ).toBe('A knight of the north.')

        readBefore('A knight of the north.', { from: 5 })
        expect(
          (await executeReadDocument({ path: 'notes/Characters/Elara' }, inChat)).content
        ).toBe('A knight of the north.')
      })
    })

    it('needs a story', async () => {
      const result = await executeReadDocument({ path: 'x' }, {})
      expect(result.error).toContain('No story context')
    })
  })

  describe('the root is addressable', () => {
    // "/" is what every listing prints for the project, so it has to be what
    // the tools take.
    it('resolves as "/"', async () => {
      await seed()
      expect(await executeListDocuments({ path: '/' }, context)).toContain('notes/Characters/Elara')
    })

    it('leaves the overview to the writer: a summary is not a field it takes', async () => {
      await seed()
      const before = store.getDocument(rootIdFor(STORY)).summary
      const result = await executeUpdateDocument(
        { path: '/', updates: { summary: 'A knight rides south instead.' } },
        context
      )

      expect(result.error).toContain('No supported fields')
      expect(store.getDocument(rootIdFor(STORY)).summary).toBe(before)
    })
  })

  describe('search_documents', () => {
    it('searches content across the whole project, not just notes', async () => {
      await seed()
      const result = await executeSearchDocuments({ query: 'snow' }, context)

      expect(result.results).toHaveLength(1)
      expect(result.results[0]).toMatchObject({ id: 'sc_1', path: 'manuscript/Chapter 1' })
      expect(result.results[0].passages[0].text).toContain('Snow fell')
    })

    it('matches titles too', async () => {
      await seed()
      const result = await executeSearchDocuments({ query: 'elara' }, context)
      expect(result.results.map(r => r.id)).toEqual(['lore_1'])
    })

    it('returns nothing for an empty query', async () => {
      await seed()
      expect(await executeSearchDocuments({ query: '  ' }, context)).toEqual({ results: [] })
    })
  })

  describe('create_document', () => {
    it('creates a document at the path it was given', async () => {
      await seed()
      const result = await executeCreateDocument(
        { path: 'The Crystal Caves', content: 'Deep.\n\nCold.' },
        context
      )

      expect(result.success).toBe(true)
      expect(result.document.type).toBe('text')
      expect(result.document.path).toBe('The Crystal Caves')
      const created = store.getDocument(result.document.id)
      expect(created.parentId).toBe(rootIdFor(STORY))
      expect(created.content).toBe('Deep.\n\nCold.')
    })

    it('stores what the model wrote, as written', async () => {
      await seed()
      const result = await executeCreateDocument(
        { path: 'Verse', content: '# Verse\n\nOnce *upon* a time\nlong ago' },
        context
      )

      expect(store.getDocument(result.document.id).content).toBe(
        '# Verse\n\nOnce *upon* a time\nlong ago'
      )
    })

    it('reads the folder off the front of the path', async () => {
      await seed()
      const result = await executeCreateDocument(
        { path: 'notes/Characters/Bram', content: 'A smith.' },
        context
      )

      expect(store.getDocument(result.document.id).parentId).toBe('cat_1')
      expect(result.document.title).toBe('Bram')
    })

    it('can create a chapter, which the lore tools never could', async () => {
      await seed()
      const result = await executeCreateDocument(
        { path: 'manuscript/Chapter 2', content: 'Prose.' },
        context
      )
      expect(store.getDocument(result.document.id).parentId).toBe(manuscriptIdFor(STORY))
    })

    it('takes a leading slash, the same as everything else', async () => {
      await seed()
      const result = await executeCreateDocument(
        { path: '/notes/Characters/Bram', content: 'A smith.' },
        context
      )
      expect(store.getDocument(result.document.id).parentId).toBe('cat_1')
    })

    it('ignores a summary, which is not the model’s to write', async () => {
      await seed()
      const result = await executeCreateDocument(
        { path: 'Bram', content: '', summary: 'A smith.' },
        context
      )
      expect(store.getDocument(result.document.id).summary).toBe('')
    })

    it('refuses a folder that is not there rather than inventing one', async () => {
      await seed()
      const result = await executeCreateDocument(
        // One letter off "notes". Inventing the parent would leave two folders
        // a letter apart and nothing to notice it by.
        { path: 'note/Characters/Bram', content: 'A smith.' },
        context
      )

      expect(result.error).toContain('note/Characters')
      expect(result.error).toContain('create_folder')
      expect(result.success).toBeUndefined()
    })

    it('refuses a parent that is a document, not a folder', async () => {
      await seed()
      const result = await executeCreateDocument(
        { path: 'notes/Characters/Elara/Sword', content: 'Hers.' },
        context
      )
      expect(result.error).toContain('not a folder')
    })

    it('refuses a path that is already taken', async () => {
      // When the path is the address, two documents sharing one makes the
      // second unreachable.
      await seed()
      const result = await executeCreateDocument(
        { path: 'notes/Characters/Elara', content: 'Another one.' },
        context
      )

      expect(result.error).toContain('already exists')
      expect(result.error).toContain('update_document')
    })

    it('needs a path to put it at', async () => {
      await seed()
      const result = await executeCreateDocument({ path: '  ', content: 'Prose.' }, context)

      expect(result.error).toContain('full path')
      expect(result.success).toBeUndefined()
    })

    it('needs a story', async () => {
      const result = await executeCreateDocument({ path: 'x', content: '' }, {})
      expect(result.error).toContain('No story context')
    })
  })

  describe('create_folder', () => {
    it('creates a folder at the path it was given', async () => {
      await seed()
      const result = await executeCreateFolder({ path: 'notes/Factions' }, context)

      expect(result.success).toBe(true)
      expect(result.document.type).toBe('folder')
      expect(result.document.path).toBe('notes/Factions')
      expect(store.getDocument(result.document.id).parentId).toBe(notesIdFor(STORY))
    })

    it('creates at the top level for a bare name', async () => {
      await seed()
      const result = await executeCreateFolder({ path: 'Places' }, context)
      expect(store.getDocument(result.document.id).parentId).toBe(rootIdFor(STORY))
    })

    it('holds documents once it exists', async () => {
      await seed()
      await executeCreateFolder({ path: 'notes/Factions' }, context)
      const result = await executeCreateDocument(
        { path: 'notes/Factions/The Ashen Court', content: 'They keep the pass.' },
        context
      )

      expect(result.success).toBe(true)
      expect(result.document.path).toBe('notes/Factions/The Ashen Court')
    })

    it('does not invent its own parent either', async () => {
      await seed()
      const result = await executeCreateFolder({ path: 'note/Factions' }, context)
      expect(result.error).toContain('No folder at "note"')
    })

    it('refuses a path that is already taken', async () => {
      await seed()
      const result = await executeCreateFolder({ path: 'notes/Characters' }, context)
      expect(result.error).toContain('already exists')
    })

    it('needs a story', async () => {
      const result = await executeCreateFolder({ path: 'x' }, {})
      expect(result.error).toContain('No story context')
    })
  })

  describe('update_document', () => {
    it('replaces content', async () => {
      await seed()
      const result = await executeUpdateDocument(
        { path: 'notes/Characters/Elara', updates: { content: 'A knight of the south.' } },
        context
      )

      expect(result.success).toBe(true)
      expect(store.getDocument('lore_1').content).toContain('A knight of the south.')
    })

    it('renames, and leaves the summary alone', async () => {
      await seed()
      await executeUpdateDocument(
        { path: 'notes/Characters/Elara', updates: { title: 'Elara Vance', summary: 'A knight' } },
        context
      )

      expect(store.getDocument('lore_1')).toMatchObject({
        title: 'Elara Vance',
        summary: 'A knight.',
      })
    })

    it('refuses a title something beside it has, in any case', async () => {
      await seed()
      await executeCreateDocument({ path: 'notes/Characters/Riley', content: 'x' }, context)

      const result = await executeUpdateDocument(
        { path: 'notes/Characters/Elara', updates: { title: ' riley ', content: 'y' } },
        context
      )

      // Two of one name would be one path for two documents.
      expect(result).toEqual({
        error: '"notes/Characters/Riley" already exists. Choose a different title.',
      })
      expect(store.getDocument('lore_1')).toMatchObject({
        title: 'Elara',
        content: 'A knight of the north.',
      })
    })

    it('takes a title without the spaces round it', async () => {
      await seed()
      const result = await executeUpdateDocument(
        { path: 'notes/Characters/Elara', updates: { title: ' Elara Vance ' } },
        context
      )

      expect(result.document.path).toBe('notes/Characters/Elara Vance')
    })

    it('refuses to put content in a folder', async () => {
      await seed()
      const result = await executeUpdateDocument(
        { path: 'notes/Characters', updates: { content: 'x' } },
        context
      )
      expect(result.error).toContain('folder has no content')
    })

    it('rejects an update with nothing it can apply', async () => {
      await seed()
      const result = await executeUpdateDocument(
        { path: 'notes/Characters/Elara', updates: { nonsense: true } },
        context
      )
      expect(result.error).toContain('No supported fields')
    })
  })

  describe('append_document', () => {
    it('adds to the end, leaving what is there alone', async () => {
      await seed()
      const result = await executeAppendDocument(
        { path: 'manuscript/Chapter 1', text: 'The gate stood open.' },
        context
      )

      expect(result.success).toBe(true)
      const content = store.getDocument('sc_1').content
      expect(content).toContain('Snow fell on the road.')
      expect(content).toContain('The gate stood open.')
      expect(content.indexOf('Snow fell')).toBeLessThan(content.indexOf('The gate'))
    })

    it('refuses a folder', async () => {
      await seed()
      const result = await executeAppendDocument({ path: 'notes/Characters', text: 'x' }, context)
      expect(result.error).toContain('folder has no content')
    })

    it('refuses empty text', async () => {
      await seed()
      const result = await executeAppendDocument(
        { path: 'manuscript/Chapter 1', text: '  ' },
        context
      )
      expect(result.error).toContain('No text provided')
    })

    it('reports a miss rather than guessing', async () => {
      await seed()
      const result = await executeAppendDocument({ path: 'Nobody', text: 'x' }, context)
      expect(result.error).toContain('Nobody')
    })
  })

  describe('hidden documents', () => {
    // The writer decides what the model gets to see. A hidden document is not
    // in the model's project: not listed, not readable, not searchable — and a
    // path it was never shown reads the same whether it guessed it or not.
    it('are left out of the project listing', async () => {
      await seed()
      store.updateDocument('lore_1', { hidden: true })

      const paths = await listedPaths()
      expect(paths).not.toContain('notes/Characters/Elara')
      expect(paths).toContain('manuscript/Chapter 1')
    })

    it('take everything under a hidden folder with them', async () => {
      await seed()
      store.updateDocument('cat_1', { hidden: true })

      const paths = await listedPaths()
      expect(paths).not.toContain('notes/Characters')
      expect(paths).not.toContain('notes/Characters/Elara')
      expect(paths).toContain('notes')
    })

    it('cannot be read, even by a path guessed right', async () => {
      await seed()
      store.updateDocument('lore_1', { hidden: true })

      const result = await executeReadDocument({ path: 'notes/Characters/Elara' }, context)
      expect(result.error).toContain('notes/Characters/Elara')
      expect(result.content).toBeUndefined()
    })

    it('are left out of a folder read', async () => {
      await seed()
      store.updateDocument('lore_1', { hidden: true })

      expect(await executeListDocuments({ path: 'notes/Characters' }, context)).toBe(
        '"notes/Characters" is empty.'
      )
    })

    it('are not searched', async () => {
      await seed()
      store.updateDocument('lore_1', { hidden: true })

      const result = await executeSearchDocuments({ query: 'knight' }, context)
      expect(result.results).toEqual([])
    })

    it('cannot be written to', async () => {
      await seed()
      store.updateDocument('lore_1', { hidden: true })

      const update = await executeUpdateDocument(
        { path: 'notes/Characters/Elara', updates: { summary: 'x' } },
        context
      )
      const append = await executeAppendDocument(
        { path: 'notes/Characters/Elara', text: 'x' },
        context
      )
      const edit = await executeEditDocument(
        { path: 'notes/Characters/Elara', old: 'knight', new: 'baker' },
        context
      )

      expect(update.error).toBeDefined()
      expect(append.error).toBeDefined()
      expect(edit.error).toBeDefined()
      expect(store.getDocument('lore_1').summary).toBe('A knight.')
      expect(store.getDocument('lore_1').content).toBe('A knight of the north.')
    })

    it('still hold their path, so nothing is created on top of one', async () => {
      await seed()
      store.updateDocument('lore_1', { hidden: true })

      const result = await executeCreateDocument(
        { path: 'notes/Characters/Elara', content: 'Another one.' },
        context
      )

      expect(result.error).toContain('not available')
      // Not the visible collision's advice: update_document would find nothing there.
      expect(result.error).not.toContain('update_document')
      expect(store.getChildren('cat_1')).toHaveLength(1)
    })

    it('come back when shown again', async () => {
      await seed()
      store.updateDocument('lore_1', { hidden: true })
      store.updateDocument('lore_1', { hidden: false })

      const paths = await listedPaths()
      expect(paths).toContain('notes/Characters/Elara')
    })
  })

  describe('edit_document', () => {
    const chapter = 'manuscript/Chapter 1'

    it('replaces one passage and leaves the rest as it was', async () => {
      await seed()
      store.updateDocument('sc_1', { content: '# One\n\nSnow fell on the road.\nIt was cold.' })

      const result = await executeEditDocument(
        { path: chapter, old: 'Snow fell on the road.', new: 'Rain lashed the road.' },
        context
      )

      expect(result).toMatchObject({
        success: true,
        document: { id: 'sc_1', path: chapter },
        charactersRemoved: 22,
        charactersWritten: 21,
      })
      expect(store.getDocument('sc_1').content).toBe('# One\n\nRain lashed the road.\nIt was cold.')
    })

    it('removes a passage when the new text is empty', async () => {
      await seed()
      await executeEditDocument({ path: chapter, old: ' on the road', new: '' }, context)
      expect(store.getDocument('sc_1').content).toBe('Snow fell.')
    })

    it('writes a dollar sign as a dollar sign', async () => {
      await seed()
      await executeEditDocument({ path: chapter, old: 'Snow', new: 'It cost $& and' }, context)
      expect(store.getDocument('sc_1').content).toBe('It cost $& and fell on the road.')
    })

    it('refuses a passage that is not there, and shows the nearest lines', async () => {
      await seed()
      store.updateDocument('sc_1', {
        content: '# One\n\nSnow fell on the road.\nThe gate was shut.\nNobody came.',
      })

      const result = await executeEditDocument(
        { path: chapter, old: 'The gate was open.', new: 'x' },
        context
      )

      expect(result.error).toContain('not found')
      expect(result.error).toContain('exactly as read_document gave it')
      expect(result.nearest).toBe('Snow fell on the road.\nThe gate was shut.\nNobody came.')
      expect(store.getDocument('sc_1').content).toContain('The gate was shut.')
    })

    it('says so when only the spacing differs', async () => {
      await seed()
      const result = await executeEditDocument(
        { path: chapter, old: 'Snow fell\non the road.', new: 'x' },
        context
      )
      expect(result.error).toContain('line breaks or spacing differ')
      expect(result.nearest).toBe('Snow fell on the road.')
    })

    it('refuses a passage that appears more than once, with the count', async () => {
      await seed()
      store.updateDocument('sc_1', { content: 'The road. The road. The end.' })

      const result = await executeEditDocument(
        { path: chapter, old: 'The road.', new: 'x' },
        context
      )

      expect(result.error).toContain('appears 2 times')
      expect(store.getDocument('sc_1').content).toBe('The road. The road. The end.')
    })

    it('needs a passage', async () => {
      await seed()
      const result = await executeEditDocument({ path: chapter, old: '', new: 'x' }, context)
      expect(result.error).toContain('append_document')
    })

    it('refuses a folder and a path that is not there', async () => {
      await seed()
      expect(
        (await executeEditDocument({ path: 'notes', old: 'a', new: 'b' }, context)).error
      ).toContain('folder')
      expect(
        (await executeEditDocument({ path: 'Nobody', old: 'a', new: 'b' }, context)).error
      ).toContain('Nobody')
    })
  })

  /** What a context recorded, without the names each change is given. */
  const recorded = ctx => ctx.edits.map(({ id: _id, ...edit }) => edit)

  describe('what a turn records', () => {
    const chapter = 'manuscript/Chapter 1'
    /** A context keeping a record, the way the turn does. */
    const recording = () => ({ ...context, edits: [] })

    it('records an edit as the pair it applied', async () => {
      await seed()
      const ctx = recording()
      await executeEditDocument({ path: chapter, old: 'Snow', new: 'Rain' }, ctx)
      expect(recorded(ctx)).toEqual([
        { documentId: 'sc_1', path: chapter, tool: 'edit_document', old: 'Snow', new: 'Rain' },
      ])
    })

    it('names each change, so a decision on it can be told from the copy', async () => {
      await seed()
      const ctx = recording()
      await executeEditDocument({ path: chapter, old: 'Snow', new: 'Rain' }, ctx)
      await executeAppendDocument({ path: chapter, text: 'More.' }, ctx)
      const ids = ctx.edits.map(edit => edit.id)
      expect(ids.every(id => typeof id === 'string' && id.length > 0)).toBe(true)
      expect(new Set(ids).size).toBe(2)
    })

    it('records a rewrite as the smallest pair the two bodies allow', async () => {
      await seed()
      const ctx = recording()
      await executeUpdateDocument(
        { path: chapter, updates: { content: 'Snow fell on the hill.', title: 'One' } },
        ctx
      )
      expect(recorded(ctx)).toEqual([
        { documentId: 'sc_1', path: chapter, tool: 'update_document', old: 'road', new: 'hill' },
      ])
    })

    it('records an append as what arrived at the end', async () => {
      await seed()
      const ctx = recording()
      await executeAppendDocument({ path: chapter, text: 'Then hail.' }, ctx)
      expect(recorded(ctx)).toEqual([
        {
          documentId: 'sc_1',
          path: chapter,
          tool: 'append_document',
          old: '',
          new: '\n\nThen hail.',
        },
      ])
    })

    it('records a creation with what was created', async () => {
      await seed()
      const ctx = recording()
      const result = await executeCreateDocument({ path: 'Verse', content: 'Once.' }, ctx)
      expect(recorded(ctx)).toEqual([
        {
          documentId: result.document.id,
          path: 'Verse',
          tool: 'create_document',
          old: '',
          new: 'Once.',
        },
      ])
    })

    it('records nothing for a change that did not happen', async () => {
      await seed()
      const ctx = recording()
      await executeEditDocument({ path: chapter, old: 'Nope', new: 'x' }, ctx)
      await executeUpdateDocument({ path: chapter, updates: { summary: 'only this' } }, ctx)
      expect(recorded(ctx)).toEqual([])
    })

    it('writes anyway when nobody is keeping a record', async () => {
      await seed()
      await executeEditDocument({ path: chapter, old: 'Snow', new: 'Rain' }, context)
      expect(store.getDocument('sc_1').content).toBe('Rain fell on the road.')
    })
  })

  describe('asking the writer first', () => {
    const chapter = 'manuscript/Chapter 1'
    /** A context that asks first and keeps a record, the way the turn does in ask mode. */
    const asking = () => ({ ...context, propose: true, edits: [] })

    it('proposes an edit instead of making it, and tells the model so', async () => {
      await seed()
      const ctx = asking()
      const result = await executeEditDocument({ path: chapter, old: 'Snow', new: 'Rain' }, ctx)

      expect(result).toEqual({ proposed: true, document: { path: chapter }, note: PROPOSED_NOTE })
      expect(store.getDocument('sc_1').content).toBe('Snow fell on the road.')
      expect(recorded(ctx)).toEqual([
        {
          documentId: 'sc_1',
          path: chapter,
          tool: 'edit_document',
          old: 'Snow',
          new: 'Rain',
          status: 'proposed',
        },
      ])
    })

    it('still refuses a misquote, so it is corrected before the writer sees it', async () => {
      await seed()
      const ctx = asking()
      const result = await executeEditDocument({ path: chapter, old: 'Sleet', new: 'x' }, ctx)
      expect(result.error).toContain('not found')
      expect(recorded(ctx)).toEqual([])
    })

    it('proposes a rewrite, and a summary sent with it changes nothing', async () => {
      await seed()
      const ctx = asking()
      const before = store.getDocument('sc_1').summary
      await executeUpdateDocument(
        { path: chapter, updates: { content: 'Rewritten.', summary: 'New summary.' } },
        ctx
      )
      expect(store.getDocument('sc_1').content).toBe('Snow fell on the road.')
      expect(store.getDocument('sc_1').summary).toBe(before)
      expect(recorded(ctx)).toEqual([
        {
          documentId: 'sc_1',
          path: chapter,
          tool: 'update_document',
          old: 'Snow fell on the road.',
          new: 'Rewritten.',
          status: 'proposed',
        },
      ])
    })

    it('proposes an append and a creation', async () => {
      await seed()
      const ctx = asking()
      await executeAppendDocument({ path: chapter, text: 'Then hail.' }, ctx)
      await executeCreateDocument({ path: 'Verse', content: 'Once.', summary: 'A verse.' }, ctx)

      expect(store.getDocument('sc_1').content).toBe('Snow fell on the road.')
      expect(store.getChildren(rootIdFor(STORY)).map(d => d.title)).not.toContain('Verse')
      expect(recorded(ctx)).toEqual([
        {
          documentId: 'sc_1',
          path: chapter,
          tool: 'append_document',
          old: '',
          new: 'Then hail.',
          status: 'proposed',
        },
        {
          documentId: '',
          path: 'Verse',
          tool: 'create_document',
          old: '',
          new: 'Once.',
          status: 'proposed',
        },
      ])
    })

    describe('applyProposal', () => {
      it('makes an edit the writer accepted and returns the pair as applied', async () => {
        await seed()
        const applied = await applyProposal(STORY, {
          documentId: 'sc_1',
          path: chapter,
          tool: 'edit_document',
          old: 'Snow',
          new: 'Rain',
          status: 'proposed',
        })
        expect(applied).toEqual({ documentId: 'sc_1', path: chapter, old: 'Snow', new: 'Rain' })
        expect(store.getDocument('sc_1').content).toBe('Rain fell on the road.')
      })

      it('refuses an edit whose passage has changed since', async () => {
        await seed()
        store.updateDocument('sc_1', { content: 'Sleet fell.' })
        const applied = await applyProposal(STORY, {
          documentId: 'sc_1',
          path: chapter,
          tool: 'edit_document',
          old: 'Snow',
          new: 'Rain',
          status: 'proposed',
        })
        expect(applied).toEqual({ error: 'The passage has changed since this was proposed.' })
        expect(store.getDocument('sc_1').content).toBe('Sleet fell.')
      })

      it('appends and rewrites as the tools would have', async () => {
        await seed()
        const appended = await applyProposal(STORY, {
          documentId: 'sc_1',
          path: chapter,
          tool: 'append_document',
          old: '',
          new: 'Then hail.',
          status: 'proposed',
        })
        expect(appended).toMatchObject({ old: '', new: '\n\nThen hail.' })
        const before = store.getDocument('sc_1').content
        const rewritten = await applyProposal(STORY, {
          documentId: 'sc_1',
          path: chapter,
          tool: 'update_document',
          old: 'x',
          new: 'All new.',
          status: 'proposed',
        })
        expect(store.getDocument('sc_1').content).toBe('All new.')
        // The pair as applied, cut small: enough to undo it with.
        expect('All new.'.replace(rewritten.new, rewritten.old)).toBe(before)
      })

      it('creates what was proposed, summary and all', async () => {
        await seed()
        const created = await applyProposal(STORY, {
          documentId: '',
          path: 'Verse',
          tool: 'create_document',
          old: '',
          new: 'Once.',
          summary: 'A verse.',
          status: 'proposed',
        })
        expect(created).toMatchObject({ path: 'Verse', old: '', new: 'Once.' })
        const document = store.getDocument(created.documentId)
        expect(document).toMatchObject({ title: 'Verse', content: 'Once.', summary: 'A verse.' })
      })

      it('reports a document that is gone', async () => {
        await seed()
        const applied = await applyProposal(STORY, {
          documentId: 'nobody',
          path: 'x',
          tool: 'edit_document',
          old: 'a',
          new: 'b',
          status: 'proposed',
        })
        expect(applied.error).toContain('No document')
      })
    })
  })

  describe('nearestContext', () => {
    it('picks the line most like the first line of the passage, with its neighbours', () => {
      const content = 'a b c\nsnow fell on the road\nthe gate was shut\nnobody came\nthe end'
      expect(nearestContext(content, 'the gate was open\nand more')).toBe(
        'snow fell on the road\nthe gate was shut\nnobody came'
      )
    })

    it('falls back to the opening when nothing is alike', () => {
      expect(nearestContext('one\ntwo\nthree\nfour', 'zzz qqq')).toBe('one\ntwo\nthree')
      expect(nearestContext('', 'x')).toBe('')
    })
  })

  describe('content goes through the document API', () => {
    // Which knows whether the editor holds the document. These tests have no
    // editor open, so the store is where the words land.
    it('appends as a block of its own', async () => {
      await seed()
      await executeAppendDocument({ path: 'manuscript/Chapter 1', text: 'The gate.' }, context)
      expect(store.getDocument('sc_1').content).toBe('Snow fell on the road.\n\nThe gate.')
    })

    it('replaces content, and leaves the summary alone', async () => {
      await seed()
      const before = store.getDocument('sc_1').summary
      await executeUpdateDocument(
        {
          path: 'manuscript/Chapter 1',
          updates: { content: 'Rain, this time.', summary: 'Elara leaves.' },
        },
        context
      )
      expect(store.getDocument('sc_1').content).toBe('Rain, this time.')
      expect(store.getDocument('sc_1').summary).toBe(before)
    })
  })
})
