/* global AbortController */
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

const projects = vi.hoisted(() => ({
  projectsOf: vi.fn(),
  findProject: vi.fn(),
  inProject: vi.fn(),
}))
vi.mock('@/apps/projects.js', () => projects)

import { LIST_PROJECTS, callTool, toResult, toolsFor } from '@/apps/tools.js'
import { executeReadDocument, projectOverview } from '@/ai/tools/documents.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

const STORY = 'story_1'

/** A connection that only reads. */
const APP = {
  id: 'app_1',
  name: 'Claude Code',
  projects: [STORY],
  edit: 'off',
  comment: false,
}

/** One that edits and comments. */
const WRITER = { ...APP, edit: 'editing', comment: true }

/** One whose edits are suggested, and that comments. */
const SUGGESTER = { ...APP, edit: 'suggesting', comment: true }

const signal = new AbortController().signal

/** What an answer says, its parts as they were sent. */
const parts = answer => answer.result.content.map(part => part.text)

describe('toolsFor', () => {
  it('offers a connection that only reads the projects’ list and the tools that read', () => {
    const tools = toolsFor(APP)
    expect(tools.map(tool => tool.name)).toEqual([
      'list_projects',
      'list_documents',
      'read_document',
      'describe_document',
      'search_documents',
    ])
    for (const tool of tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true })
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('offers the tools that edit to a connection that edits', () => {
    const names = toolsFor({ ...APP, edit: 'editing' }).map(tool => tool.name)
    expect(names).toEqual([
      'list_projects',
      'list_documents',
      'read_document',
      'describe_document',
      'search_documents',
      'create_document',
      'create_folder',
      'update_document',
      'edit_document',
      'append_document',
      'move_document',
      'delete_document',
    ])
  })

  it('offers the same tools to one that suggests, whose changes wait on the writer', () => {
    expect(toolsFor({ ...APP, edit: 'suggesting' })).toEqual(toolsFor({ ...APP, edit: 'editing' }))
  })

  it('offers the tools that comment to a connection that comments', () => {
    const names = toolsFor({ ...APP, comment: true }).map(tool => tool.name)
    expect(names.slice(5)).toEqual([
      'list_comments',
      'add_comment',
      'reply_comment',
      'resolve_comment',
    ])
  })

  it('says which tools change nothing, which only add, and which may take away', () => {
    const hints = Object.fromEntries(toolsFor(WRITER).map(tool => [tool.name, tool.annotations]))
    expect(hints.list_comments).toEqual({ readOnlyHint: true })
    for (const name of ['create_document', 'create_folder', 'append_document', 'add_comment']) {
      expect(hints[name], name).toEqual({ readOnlyHint: false, destructiveHint: false })
    }
    for (const name of ['edit_document', 'update_document', 'move_document', 'delete_document']) {
      expect(hints[name], name).toEqual({ readOnlyHint: false, destructiveHint: true })
    }
  })

  it('has every document tool take the project, as well as what it takes of a chat', () => {
    const [list, ...documents] = toolsFor(WRITER)
    expect(list.inputSchema.properties).toEqual({})
    for (const tool of documents) {
      expect(Object.keys(tool.inputSchema.properties)[0], tool.name).toBe('project')
      expect(tool.inputSchema.required || [], tool.name).not.toContain('project')
    }
    const read = documents.find(tool => tool.name === 'read_document')
    expect(Object.keys(read.inputSchema.properties)).toContain('section')
    expect(read.inputSchema.required).toEqual(['path'])
  })

  it('says nothing of what only a chat has: its conversation, its block, its asking first', () => {
    for (const tool of toolsFor(WRITER)) {
      const words = `${tool.description} ${JSON.stringify(tool.inputSchema)}`
      expect(words, tool.name).not.toMatch(
        /explore_documents|project block|conversation|use_skill|still above|in the chat|approves changes first|\bchat\b/
      )
    }
  })

  it('lets an edit be several, or of every place a passage appears', () => {
    const edit = toolsFor(WRITER).find(tool => tool.name === 'edit_document')
    const { properties, required } = edit.inputSchema

    expect(Object.keys(properties)).toEqual(['project', 'path', 'old', 'new', 'all', 'edits'])
    expect(required).toEqual(['path'])
    expect(properties.all.type).toBe('boolean')
    expect(properties.edits.items.required).toEqual(['old', 'new'])
    expect(Object.keys(properties.edits.items.properties)).toEqual(['old', 'new', 'all'])
    expect(edit.description).toContain('`edits`')
  })
})

describe('toResult', () => {
  it('sends text as it is', () => {
    expect(toResult('a/b — 12 words')).toEqual({
      content: [{ type: 'text', text: 'a/b — 12 words' }],
    })
  })

  it('marks what went wrong as an error, in its own words', () => {
    expect(toResult({ error: 'No document at "x".' })).toEqual({
      content: [{ type: 'text', text: 'No document at "x".' }],
      isError: true,
    })
    const more = toResult({ error: 'No section.', sections: [{ link: '#a' }] })
    expect(more.isError).toBe(true)
    expect(JSON.parse(more.content[0].text)).toEqual({
      error: 'No section.',
      sections: [{ link: '#a' }],
    })
  })

  it('sends a document’s text as written, after what is said about it and before its comments', () => {
    const answer = toResult({
      path: 'notes/Plan',
      words: 4,
      content: 'A "quoted" line.\n\nAnother.',
      comments: [{ id: 'c1', passage: 'quoted' }],
    })
    expect(answer.content.map(part => part.text)).toEqual([
      '{"path":"notes/Plan","words":4}',
      'A "quoted" line.\n\nAnother.',
      '{"comments":[{"id":"c1","passage":"quoted"}]}',
    ])
    expect(answer.isError).toBeUndefined()
  })

  it('sends how a write was stored as it reads, after what is said of the write', () => {
    const answer = toResult({
      success: true,
      document: { path: 'notes/Plan' },
      stored: '- one\n- two',
      note: 'Quote from that.',
    })
    expect(answer.content.map(part => part.text)).toEqual([
      '{"success":true,"document":{"path":"notes/Plan"},"note":"Quote from that."}',
      '- one\n- two',
    ])
  })

  it('sends anything else as JSON', () => {
    expect(toResult({ results: [] }).content[0].text).toBe('{"results":[]}')
    expect(toResult(undefined).content[0].text).toBe('null')
  })
})

describe('callTool', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    vi.clearAllMocks()
    store = useDocumentsStore()
    projects.projectsOf.mockResolvedValue([
      { id: STORY, name: 'Thief', summary: 'A heist in a walled city.' },
      { id: 'story_2', name: 'Designs', summary: '' },
    ])
    projects.findProject.mockResolvedValue({ id: STORY, name: 'Thief', summary: '' })
    projects.inProject.mockImplementation(async (_, work) => ({ value: await work() }))

    await projectOverview(STORY)
    store.createDocument({
      id: 'folder_notes',
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'folder',
      title: 'notes',
    })
    store.createDocument({
      id: 'doc_plan',
      storyId: STORY,
      parentId: 'folder_notes',
      type: 'text',
      title: 'Plan',
      content: 'The vault opens at "noon".\n\nBring rope.',
    })
    store.createDocument({
      id: 'doc_secret',
      storyId: STORY,
      parentId: 'folder_notes',
      type: 'text',
      title: 'Secret',
      content: 'Nobody reads this.',
      hidden: true,
    })
  })

  it('names the app’s projects, with what each is about', async () => {
    const answer = await callTool(APP, LIST_PROJECTS, {}, signal)

    expect(JSON.parse(parts(answer)[0])).toEqual({
      projects: [{ name: 'Thief', summary: 'A heist in a walled city.' }, { name: 'Designs' }],
    })
    expect(projects.inProject).not.toHaveBeenCalled()
  })

  it('reads a document in the project named, its text as it is written', async () => {
    const answer = await callTool(
      APP,
      'read_document',
      { project: 'Thief', path: 'notes/Plan' },
      signal
    )

    expect(projects.findProject).toHaveBeenCalledWith(APP, 'Thief')
    expect(projects.inProject).toHaveBeenCalledWith(STORY, expect.any(Function))
    const [about, text] = parts(answer)
    expect(JSON.parse(about)).toMatchObject({ id: 'doc_plan', path: 'notes/Plan', type: 'text' })
    expect(text).toBe('The vault opens at "noon".\n\nBring rope.')
  })

  it('sends the text again on a second read: nothing is "still above" for an app', async () => {
    const args = { project: 'Thief', path: 'notes/Plan' }
    await callTool(APP, 'read_document', args, signal)
    const again = await callTool(APP, 'read_document', args, signal)
    expect(parts(again)[1]).toBe('The vault opens at "noon".\n\nBring rope.')
  })

  it('lists and searches without what is hidden', async () => {
    const listing = parts(await callTool(APP, 'list_documents', {}, signal))[0]
    expect(listing).toContain('notes/Plan')
    expect(listing).not.toContain('Secret')

    const found = parts(await callTool(APP, 'search_documents', { query: 'reads' }, signal))[0]
    expect(found).not.toContain('Secret')

    const read = await callTool(APP, 'read_document', { path: 'notes/Secret' }, signal)
    expect(read.result.isError).toBe(true)
  })

  it('answers with why when the project is not one of the app’s, and reads nothing', async () => {
    projects.findProject.mockResolvedValue({ error: 'No project named "Private".' })

    const answer = await callTool(
      APP,
      'read_document',
      { project: 'Private', path: 'notes/Plan' },
      signal
    )

    expect(answer).toEqual({
      result: { content: [{ type: 'text', text: 'No project named "Private".' }], isError: true },
    })
    expect(projects.inProject).not.toHaveBeenCalled()
  })

  it('passes the call on when this is not the window to run it in', async () => {
    projects.inProject.mockResolvedValue({ pass: 'elsewhere' })
    expect(await callTool(APP, 'read_document', { path: 'notes/Plan' }, signal)).toEqual({
      pass: 'elsewhere',
    })
  })

  it('marks a tool’s own refusal as an error for the app’s model', async () => {
    const answer = await callTool(APP, 'read_document', { path: 'notes/Nothing' }, signal)
    expect(answer.result.isError).toBe(true)
    expect(parts(answer)[0]).toContain('No document at "notes/Nothing"')
  })

  it('refuses a tool the connection is not offered, changing nothing', async () => {
    const edit = await callTool(
      APP,
      'edit_document',
      { path: 'notes/Plan', old: 'rope', new: 'a ladder' },
      signal
    )
    const comment = await callTool(
      APP,
      'add_comment',
      { path: 'notes/Plan', passage: 'rope', text: 'Why rope?' },
      signal
    )

    expect(edit.result).toEqual({
      content: [{ type: 'text', text: 'Unknown tool: edit_document' }],
      isError: true,
    })
    expect(comment.result.isError).toBe(true)
    expect(store.getDocument('doc_plan').content).toBe('The vault opens at "noon".\n\nBring rope.')
  })

  it('writes for a connection that edits: a document made, added to, changed and moved', async () => {
    const made = await callTool(
      WRITER,
      'create_document',
      { path: 'notes/Crew', content: 'Mara picks locks.' },
      signal
    )
    expect(JSON.parse(parts(made)[0])).toMatchObject({
      success: true,
      document: { path: 'notes/Crew' },
    })

    await callTool(WRITER, 'append_document', { path: 'notes/Crew', text: 'Tov drives.' }, signal)
    await callTool(
      WRITER,
      'edit_document',
      { path: 'notes/Crew', old: 'picks locks', new: 'opens the vault' },
      signal
    )
    const read = await callTool(WRITER, 'read_document', { path: 'notes/Crew' }, signal)
    expect(parts(read)[1]).toBe('Mara opens the vault.\n\nTov drives.')

    await callTool(WRITER, 'move_document', { path: 'notes/Crew', to: 'notes/The crew' }, signal)
    const listing = parts(await callTool(WRITER, 'list_documents', {}, signal))[0]
    expect(listing).toContain('notes/The crew')

    await callTool(WRITER, 'delete_document', { path: 'notes/The crew' }, signal)
    expect(parts(await callTool(WRITER, 'list_documents', {}, signal))[0]).not.toContain('crew')
  })

  it('never has a write wait on the writer, there being no chat to ask in', async () => {
    const made = await callTool(
      WRITER,
      'create_document',
      { path: 'notes/Crew', content: 'Mara.' },
      signal
    )
    expect(parts(made)[0]).not.toContain('proposed')
    expect(parts(await callTool(WRITER, 'list_documents', {}, signal))[0]).toContain('notes/Crew')
  })

  it('makes several edits in one call, through the tool as an app has it', async () => {
    const answer = await callTool(
      WRITER,
      'edit_document',
      {
        path: 'notes/Plan',
        edits: [
          { old: 'noon', new: 'midnight' },
          { old: 'rope', new: 'a ladder' },
        ],
      },
      signal
    )

    expect(JSON.parse(parts(answer)[0])).toMatchObject({ success: true, edits: 2 })
    expect(store.getDocument('doc_plan').content).toBe(
      'The vault opens at "midnight".\n\nBring a ladder.'
    )
  })

  it('comments under the connection’s name', async () => {
    const added = await callTool(
      WRITER,
      'add_comment',
      { path: 'notes/Plan', passage: 'Bring rope', text: 'How much?' },
      signal
    )
    const { comment } = JSON.parse(parts(added)[0])
    await callTool(
      WRITER,
      'reply_comment',
      { path: 'notes/Plan', id: comment, text: 'Thirty metres.' },
      signal
    )

    const thread = store.getDocument('doc_plan').comments[comment]
    expect(thread.posts.map(post => [post.author, post.name, post.text])).toEqual([
      ['model', 'Claude Code', 'How much?'],
      ['model', 'Claude Code', 'Thirty metres.'],
    ])

    const listed = parts(await callTool(WRITER, 'list_comments', {}, signal))[0]
    expect(listed).toContain('"author":"Claude Code"')

    await callTool(WRITER, 'resolve_comment', { path: 'notes/Plan', id: comment }, signal)
    expect(store.getDocument('doc_plan').comments[comment].status).toBe('resolved')
  })

  it('says how a write was stored where the editor wrote it another way', async () => {
    const answer = await callTool(
      WRITER,
      'append_document',
      { path: 'notes/Plan', text: '* rope\n* a lamp' },
      signal
    )

    const [about, stored] = parts(answer)
    expect(JSON.parse(about)).toMatchObject({
      success: true,
      note: expect.stringContaining('`stored`'),
    })
    expect(stored).toBe('- rope\n- a lamp')
  })
})

describe('a connection that suggests', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  const PLAN = 'The vault opens at noon.\n\nBring rope and a lamp.'

  /** The plan as someone else reads it: the text as it stands. */
  const asItStands = async () =>
    (await executeReadDocument({ path: 'Plan' }, { storyId: STORY })).content

  /** The plan as the connection reads it. */
  const asRead = async app =>
    parts(await callTool(app, 'read_document', { path: 'Plan' }, signal))[1]

  /** The plan's suggestions, by their ids. */
  const suggestions = () =>
    Object.entries(store.getDocument('doc_plan').comments || {}).filter(
      ([, thread]) => thread.suggestion
    )

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    vi.clearAllMocks()
    store = useDocumentsStore()
    projects.findProject.mockResolvedValue({ id: STORY, name: 'Thief', summary: '' })
    projects.inProject.mockImplementation(async (_, work) => ({ value: await work() }))
    await projectOverview(STORY)
    store.createDocument({
      id: 'doc_plan',
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'text',
      title: 'Plan',
      content: PLAN,
    })
  })

  it('has its edit laid out in the text for the writer, under its name, and reads it as made', async () => {
    const answer = await callTool(
      SUGGESTER,
      'edit_document',
      { path: 'Plan', old: 'Bring rope', new: 'Bring wire' },
      signal
    )

    const said = JSON.parse(parts(answer)[0])
    expect(said).toMatchObject({ suggested: true, document: { path: 'Plan' } })
    expect(said.note).toContain('accepts or rejects')

    expect(await asItStands()).toBe(PLAN)
    expect(await asRead(SUGGESTER)).toBe(PLAN.replace('rope', 'wire'))

    const [[id, thread]] = suggestions()
    expect(id).toBe(said.suggestion)
    expect(thread.suggestion).toMatchObject({ chat: 'app:app_1', name: 'Claude Code' })
    expect(thread.status).toBe('open')
  })

  it('folds a later change that touches its suggestion into it', async () => {
    const first = JSON.parse(
      parts(
        await callTool(
          SUGGESTER,
          'edit_document',
          { path: 'Plan', old: 'Bring rope', new: 'Bring wire' },
          signal
        )
      )[0]
    )
    const second = JSON.parse(
      parts(
        await callTool(
          SUGGESTER,
          'edit_document',
          { path: 'Plan', old: 'Bring wire', new: 'Bring thin wire' },
          signal
        )
      )[0]
    )

    expect(second.suggestion).toBe(first.suggestion)
    expect(suggestions()).toHaveLength(1)
    expect(await asRead(SUGGESTER)).toContain('Bring thin wire and a lamp.')
    expect(await asItStands()).toBe(PLAN)
  })

  it('is one connection’s: another reads the text as it stands, and suggests apart', async () => {
    await callTool(
      SUGGESTER,
      'edit_document',
      { path: 'Plan', old: 'Bring rope', new: 'Bring wire' },
      signal
    )
    const other = { ...SUGGESTER, id: 'app_2', name: 'Another agent' }

    expect(await asRead(other)).toBe(PLAN)
    await callTool(other, 'edit_document', { path: 'Plan', old: 'at noon', new: 'at dusk' }, signal)

    expect(
      suggestions()
        .map(([, thread]) => thread.suggestion.name)
        .sort()
    ).toEqual(['Another agent', 'Claude Code'])
    expect(await asRead(other)).toBe(PLAN.replace('noon', 'dusk'))
    expect(await asRead(SUGGESTER)).toBe(PLAN.replace('rope', 'wire'))
  })

  it('suggests several edits in a call, and what is added to the end', async () => {
    const many = await callTool(
      SUGGESTER,
      'edit_document',
      {
        path: 'Plan',
        edits: [
          { old: 'noon', new: 'dusk' },
          { old: 'rope', new: 'wire' },
        ],
      },
      signal
    )
    expect(JSON.parse(parts(many)[0])).toMatchObject({ suggested: true, edits: 2 })

    const added = await callTool(
      SUGGESTER,
      'append_document',
      { path: 'Plan', text: '* chalk' },
      signal
    )
    const [about, stored] = parts(added)
    expect(JSON.parse(about).suggested).toBe(true)
    expect(stored).toBe('- chalk')

    expect(await asItStands()).toBe(PLAN)
    expect(await asRead(SUGGESTER)).toBe(
      'The vault opens at dusk.\n\nBring wire and a lamp.\n\n- chalk'
    )
  })

  it('makes a new document, a move and a delete at once, there being no chat to propose them in', async () => {
    const made = await callTool(
      SUGGESTER,
      'create_document',
      { path: 'Crew', content: 'Mara picks locks.' },
      signal
    )
    expect(JSON.parse(parts(made)[0])).toMatchObject({ success: true, document: { path: 'Crew' } })

    await callTool(SUGGESTER, 'move_document', { path: 'Crew', to: 'The crew' }, signal)
    expect(parts(await callTool(SUGGESTER, 'list_documents', {}, signal))[0]).toContain('The crew')

    const gone = await callTool(SUGGESTER, 'delete_document', { path: 'The crew' }, signal)
    expect(JSON.parse(parts(gone)[0])).toMatchObject({ success: true })
    expect(parts(await callTool(SUGGESTER, 'list_documents', {}, signal))[0]).not.toContain('crew')
  })

  it('changes a plain document at once, which has no room for the marks', async () => {
    await callTool(SUGGESTER, 'create_document', { path: 'odds.py', content: 'print(1)' }, signal)
    const edit = await callTool(
      SUGGESTER,
      'edit_document',
      { path: 'odds.py', old: 'print(1)', new: 'print(2)' },
      signal
    )

    expect(JSON.parse(parts(edit)[0])).toMatchObject({ success: true })
    const script = [...store.documents.values()].find(document => document.title === 'odds.py')
    expect(script.content).toBe('print(2)')
  })

  it('comments at once, as any connection that comments does', async () => {
    const added = await callTool(
      SUGGESTER,
      'add_comment',
      { path: 'Plan', passage: 'Bring rope', text: 'How much?' },
      signal
    )

    const { comment, success } = JSON.parse(parts(added)[0])
    expect(success).toBe(true)
    expect(store.getDocument('doc_plan').comments[comment].posts[0]).toMatchObject({
      author: 'model',
      name: 'Claude Code',
    })
  })

  it('is not told to say why with a tool it is not offered', async () => {
    const quiet = { ...SUGGESTER, comment: false }
    const answer = await callTool(
      quiet,
      'edit_document',
      { path: 'Plan', old: 'rope', new: 'wire' },
      signal
    )

    const { note } = JSON.parse(parts(answer)[0])
    expect(note).toContain('accepts or rejects')
    expect(note).not.toContain('reply_comment')
  })

  it('makes a change at once for a connection that edits', async () => {
    await callTool(WRITER, 'edit_document', { path: 'Plan', old: 'rope', new: 'wire' }, signal)
    expect(await asItStands()).toBe(PLAN.replace('rope', 'wire'))
    expect(suggestions()).toHaveLength(0)
  })
})
