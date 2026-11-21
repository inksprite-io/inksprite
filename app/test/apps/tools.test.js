/* global AbortController */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
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

/** How often a document is taken as a connection reads it, counted: the real thing runs. */
vi.mock('@/apps/revisions.js', async importOriginal => {
  const real = await importOriginal()
  return { ...real, stateAt: vi.fn(real.stateAt) }
})

/** How often the editor is written out whole, counted: the real thing runs. */
const written = vi.hoisted(() => ({ out: 0 }))
vi.mock('@/composables/useEditor.js', async importOriginal => {
  const real = await importOriginal()
  return {
    ...real,
    useEditor: () => {
      const editor = real.useEditor()
      return {
        ...editor,
        flush: id => {
          if (id == null) written.out++
          editor.flush(id)
        },
      }
    },
  }
})

/** What makes an export ready for an app to fetch, stood in for (`apps/exports.test.js`). */
const exporting = vi.hoisted(() => ({ exportFor: vi.fn() }))
vi.mock('@/apps/exports.js', () => exporting)

const projects = vi.hoisted(() => ({
  projectsOf: vi.fn(),
  findProject: vi.fn(),
  inProject: vi.fn(),
}))
vi.mock('@/apps/projects.js', () => projects)

import { LIST_PROJECTS, callTool, toResult, toolsFor } from '@/apps/tools.js'
import { stateAt } from '@/apps/revisions.js'
import { executeReadDocument, projectOverview } from '@/ai/tools/documents.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { clearEditor, useEditor } from '@/composables/useEditor.js'
import { useComments } from '@/composables/useComments.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

const STORY = 'story_1'

/** A connection that only reads. */
const APP = {
  id: 'app_1',
  name: 'Claude Code',
  projects: [STORY],
  readOnly: true,
}

/** One that writes as well: what a connection is unless the writer says otherwise. */
const WRITER = { ...APP, readOnly: false }

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
      'changes_since',
      'export_document',
      'list_comments',
    ])
    for (const tool of tools) {
      expect(tool.annotations).toEqual({ readOnlyHint: true })
      expect(tool.inputSchema.type).toBe('object')
    }
  })

  it('offers every tool to a connection that writes: those that edit and those that comment as well', () => {
    const names = toolsFor(WRITER).map(tool => tool.name)
    expect(names).toEqual([
      'list_projects',
      'list_documents',
      'read_document',
      'describe_document',
      'search_documents',
      'changes_since',
      'export_document',
      'create_document',
      'create_folder',
      'update_document',
      'edit_document',
      'append_document',
      'move_document',
      'delete_document',
      'list_comments',
      'add_comment',
      'reply_comment',
      'resolve_comment',
    ])
  })

  it('writes unless its connection says it only reads', () => {
    const { readOnly: _, ...unsaid } = APP
    expect(toolsFor(unsaid)).toEqual(toolsFor(WRITER))
  })

  it('says which tools change nothing, which only add, and which may take away', () => {
    const hints = Object.fromEntries(toolsFor(WRITER).map(tool => [tool.name, tool.annotations]))
    expect(hints.list_comments).toEqual({ readOnlyHint: true })
    // An export changes nothing here: the app writes the files, on its side.
    expect(hints.export_document).toEqual({ readOnlyHint: true })
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

  it('lets a read name the revision held, and offers what changed since one', () => {
    const tools = toolsFor(APP)
    const read = tools.find(tool => tool.name === 'read_document')
    expect(Object.keys(read.inputSchema.properties)).toContain('revision')
    expect(read.inputSchema.required).toEqual(['path'])

    const since = tools.find(tool => tool.name === 'changes_since')
    expect(Object.keys(since.inputSchema.properties)).toEqual(['project', 'path', 'revision'])
    expect(since.annotations).toEqual({ readOnlyHint: true })
  })

  it('lets an edit be several, or of every place a passage appears', () => {
    const edit = toolsFor(WRITER).find(tool => tool.name === 'edit_document')
    const { properties, required } = edit.inputSchema

    expect(Object.keys(properties)).toEqual([
      'project',
      'path',
      'old',
      'new',
      'all',
      'edits',
      'suggest',
    ])
    expect(required).toEqual(['path'])
    expect(properties.all.type).toBe('boolean')
    expect(properties.edits.items.required).toEqual(['old', 'new'])
    expect(Object.keys(properties.edits.items.properties)).toEqual(['old', 'new', 'all'])
    expect(edit.description).toContain('`edits`')
  })

  it('lets a change to a document’s text be suggested, call by call, and nothing else', () => {
    const taking = toolsFor(WRITER)
      .filter(tool => 'suggest' in tool.inputSchema.properties)
      .map(tool => tool.name)

    expect(taking).toEqual(['update_document', 'edit_document', 'append_document'])
    for (const tool of toolsFor(WRITER).filter(one => taking.includes(one.name))) {
      expect(tool.inputSchema.properties.suggest.type).toBe('boolean')
      expect(tool.inputSchema.required, tool.name).not.toContain('suggest')
    }
  })

  it('says of the comments and the folders what is so for an app', () => {
    const said = Object.fromEntries(toolsFor(WRITER).map(tool => [tool.name, tool.description]))

    // Not all "by the writer and by you": inksprite's own assistant comments too.
    expect(said.list_comments).toMatch(/^The open comments on passages: each with its id/)
    // Every open comment is counted, whoever left it.
    expect(said.list_documents).toContain('how many open comments are on it')
    expect(said.list_documents).not.toContain('the user left')
    // A project starts with no folders.
    expect(said.create_folder).toContain('the folders the project has are usually the right ones')
    // Settling a suggestion is nobody's but the user's, said where suggestions are.
    expect(said.read_document).toContain('Only the user accepts or rejects a suggestion')
    expect(said.list_comments).toContain('Only the writer accepts or rejects a suggestion')
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

  it('sends the suggestions still waiting with the comments, after the text', () => {
    const waiting = [{ id: 's1', from: 'rope', to: 'wire' }]
    const both = toResult({
      path: 'Plan',
      content: 'Bring wire.',
      comments: [{ id: 'c1', passage: 'Bring' }],
      suggestions: waiting,
    })
    expect(JSON.parse(both.content[2].text)).toEqual({
      comments: [{ id: 'c1', passage: 'Bring' }],
      suggestions: waiting,
    })

    const alone = toResult({ path: 'Plan', content: 'Bring wire.', suggestions: waiting })
    expect(alone.content.map(part => part.text)).toEqual([
      '{"path":"Plan"}',
      'Bring wire.',
      '{"suggestions":[{"id":"s1","from":"rope","to":"wire"}]}',
    ])
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
    records.kept = new Map()
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

  it('answers a read with the document’s revision, and says so when it is still at it', async () => {
    const args = { project: 'Thief', path: 'notes/Plan' }
    const first = await callTool(APP, 'read_document', args, signal)
    const { revision } = JSON.parse(parts(first)[0])
    expect(revision).toEqual(expect.any(String))

    const again = await callTool(APP, 'read_document', { ...args, revision }, signal)
    expect(parts(again)).toHaveLength(1)
    expect(JSON.parse(parts(again)[0])).toEqual({
      path: 'notes/Plan',
      revision,
      unchanged: 'Unchanged since that revision.',
    })

    store.updateDocument('doc_plan', { content: 'The vault opens at dusk.' })
    const changed = await callTool(APP, 'read_document', { ...args, revision }, signal)
    expect(parts(changed)[1]).toBe('The vault opens at dusk.')
    expect(JSON.parse(parts(changed)[0]).revision).not.toBe(revision)
  })

  it('says what the writer changed since a revision, as a diff after what is said of it', async () => {
    const read = await callTool(APP, 'read_document', { path: 'notes/Plan' }, signal)
    const { revision } = JSON.parse(parts(read)[0])
    store.updateDocument('doc_plan', { content: 'The vault opens at "noon".\n\nBring wire.' })

    const since = await callTool(APP, 'changes_since', { path: 'notes/Plan', revision }, signal)

    const [about, diff] = parts(since)
    expect(JSON.parse(about)).toMatchObject({ path: 'notes/Plan', since: revision })
    expect(diff).toContain('-Bring rope.')
    expect(diff).toContain('+Bring wire.')
    expect(projects.inProject).toHaveBeenCalledWith(STORY, expect.any(Function))

    const all = await callTool(APP, 'changes_since', {}, signal)
    expect(JSON.parse(parts(all)[0]).changed).toEqual([])
  })

  it('answers a write with the revision it left', async () => {
    const read = await callTool(WRITER, 'read_document', { path: 'notes/Plan' }, signal)
    const before = JSON.parse(parts(read)[0]).revision
    const edit = await callTool(
      WRITER,
      'edit_document',
      { path: 'notes/Plan', old: 'rope', new: 'wire' },
      signal
    )

    const { revision, changedSince } = JSON.parse(parts(edit)[0])
    expect(revision).not.toBe(before)
    expect(changedSince).toBeUndefined()
    const since = await callTool(WRITER, 'changes_since', { path: 'notes/Plan', revision }, signal)
    expect(JSON.parse(parts(since)[0]).unchanged).toBe('Nothing has changed since that revision.')

    const made = await callTool(
      WRITER,
      'create_document',
      { path: 'notes/Crew', content: 'Mara.' },
      signal
    )
    expect(JSON.parse(parts(made)[0]).revision).toEqual(expect.any(String))
    const comment = await callTool(
      WRITER,
      'add_comment',
      { path: 'notes/Crew', passage: 'Mara', text: 'Who?' },
      signal
    )
    expect(JSON.parse(parts(comment)[0]).revision).toEqual(expect.any(String))
  })

  it('tells a write that the document had changed since the connection last had it', async () => {
    const read = await callTool(WRITER, 'read_document', { path: 'notes/Plan' }, signal)
    const had = JSON.parse(parts(read)[0]).revision
    store.updateDocument('doc_plan', { content: 'The vault opens at "dusk".\n\nBring rope.' })

    const edit = await callTool(
      WRITER,
      'edit_document',
      { path: 'notes/Plan', old: 'rope', new: 'wire' },
      signal
    )

    const said = JSON.parse(parts(edit)[0])
    expect(said.success).toBe(true)
    expect(said.changedSince.revision).toBe(had)
    const since = await callTool(
      WRITER,
      'changes_since',
      { path: 'notes/Plan', revision: had },
      signal
    )
    expect(parts(since)[1]).toContain('+The vault opens at "dusk".')
  })

  it('reaches a document by the id an exported file’s stamp carries, whatever it is called now', async () => {
    const read = await callTool(APP, 'read_document', { path: 'id:doc_plan' }, signal)
    expect(JSON.parse(parts(read)[0])).toMatchObject({ id: 'doc_plan', path: 'notes/Plan' })

    await callTool(WRITER, 'move_document', { path: 'notes/Plan', to: 'notes/The plan' }, signal)
    const edit = await callTool(
      WRITER,
      'edit_document',
      { path: 'id:doc_plan', old: 'rope', new: 'wire' },
      signal
    )
    expect(JSON.parse(parts(edit)[0])).toMatchObject({
      success: true,
      document: { path: 'notes/The plan' },
    })

    const since = await callTool(
      WRITER,
      'changes_since',
      { path: ' id:doc_plan'.trim(), revision: 'x' },
      signal
    )
    expect(JSON.parse(parts(since)[0]).path).toBe('notes/The plan')
  })

  it('answers an id of a hidden document, or of another project’s, as one nobody has', async () => {
    // Another project's document, at the path one has here.
    await projectOverview('story_2')
    store.createDocument({
      id: 'folder_notes_2',
      storyId: 'story_2',
      parentId: rootIdFor('story_2'),
      type: 'folder',
      title: 'notes',
    })
    store.createDocument({
      id: 'doc_other',
      storyId: 'story_2',
      parentId: 'folder_notes_2',
      type: 'text',
      title: 'Plan',
      content: 'Another project’s plan.',
    })
    /** What an id that is no document's is answered with: nothing of where one is. */
    const nobodys = id => ({
      content: [
        {
          type: 'text',
          text: `No document with the id "${id}" in "Thief". list_documents shows what the project holds.`,
        },
      ],
      isError: true,
    })

    for (const id of ['doc_nothing', 'doc_secret', 'doc_other']) {
      for (const tool of ['read_document', 'describe_document', 'changes_since']) {
        const answer = await callTool(APP, tool, { path: `id:${id}`, revision: 'x' }, signal)
        expect(answer.result, `${tool} ${id}`).toEqual(nobodys(id))
      }
      const exported = await callTool(APP, 'export_document', { path: `id:${id}` }, signal)
      expect(exported.result, `export_document ${id}`).toEqual(nobodys(id))
    }
    expect(exporting.exportFor).not.toHaveBeenCalled()

    // A write by another project's id is not made to the document that is at
    // that one's path here.
    const write = await callTool(
      WRITER,
      'update_document',
      { path: 'id:doc_other', content: 'Rewritten.' },
      signal
    )
    expect(write.result).toEqual(nobodys('doc_other'))
    expect(store.getDocument('doc_plan').content).toBe('The vault opens at "noon".\n\nBring rope.')
    expect(store.getDocument('doc_other').content).toBe('Another project’s plan.')
  })

  it('hands a document or a folder over as files, for any connection, in the window that has the project', async () => {
    exporting.exportFor.mockResolvedValue({
      file: 'Plan.md',
      url: 'http://127.0.0.1:4657/export/abc',
      command: 'curl -fsS "http://127.0.0.1:4657/export/abc" -o Plan.md',
    })

    for (const app of [APP, WRITER]) {
      const answer = await callTool(app, 'export_document', { path: 'notes/Plan' }, signal)

      expect(JSON.parse(parts(answer)[0]).command).toContain('/export/abc')
      expect(exporting.exportFor).toHaveBeenLastCalledWith(
        app,
        expect.objectContaining({ storyId: STORY, chatId: 'app:app_1' }),
        { path: 'notes/Plan' }
      )
    }
    expect(projects.inProject).toHaveBeenCalledWith(STORY, expect.any(Function))
  })

  it('exports a document by the id an exported file’s stamp carries', async () => {
    exporting.exportFor.mockResolvedValue({ file: 'Plan.md' })

    await callTool(APP, 'export_document', { path: 'id:doc_plan' }, signal)

    expect(exporting.exportFor).toHaveBeenLastCalledWith(APP, expect.anything(), {
      path: 'notes/Plan',
    })
  })

  it('says what kept an export from being made, as an error for the app’s model', async () => {
    exporting.exportFor.mockResolvedValue({ error: '"notes" holds nothing to export.' })
    const none = await callTool(APP, 'export_document', { path: 'notes' }, signal)
    expect(none.result.isError).toBe(true)
    expect(parts(none)[0]).toBe('"notes" holds nothing to export.')

    vi.spyOn(console, 'error').mockImplementation(() => {})
    exporting.exportFor.mockRejectedValue(new Error('That is more than can be handed over.'))
    const failed = await callTool(APP, 'export_document', { path: 'notes' }, signal)
    expect(failed.result.isError).toBe(true)
    expect(parts(failed)[0]).toBe("export_document couldn't be run.")
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

describe('around a call', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  const PLAN = 'The vault opens at noon.\n\nBring {==rope==}{>>cabcd1<<} and a lamp.'

  /** Type into the plan where it is open in the editor, after some words of it. */
  const type = (after, typed) => {
    const editor = useEditor()
    const state = editor.stateOf('doc_plan')
    let at = -1
    state.doc.descendants((node, pos) => {
      const found = node.isText ? node.text.indexOf(after) : -1
      if (found !== -1) at = pos + found + after.length
    })
    editor.dispatch('doc_plan', state.tr.insertText(typed, at))
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    clearEditor()
    vi.clearAllMocks()
    records.kept = new Map()
    written.out = 0
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
      comments: {
        cabcd1: {
          status: 'open',
          quote: 'rope',
          posts: [{ author: 'writer', text: 'How much?', created: 1 }],
        },
      },
    })
    store.createDocument({
      id: 'doc_script',
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'text',
      title: 'odds.py',
      content: 'print(1)',
      plain: true,
    })
    useEditor().open('doc_plan', PLAN)
  })

  afterEach(() => clearEditor())

  it('reads what was typed up to it, whichever tool is called', async () => {
    type('at noon', ', by the harbour clock')
    type('ro', 'wing ro')
    // Not yet written out: the store hears of typing after a pause.
    expect(store.getDocument('doc_plan').content).toBe(PLAN)

    const listed = parts(await callTool(APP, 'list_documents', {}, signal))[0]
    expect(listed).toContain('Plan — 15 words')

    type('lamp', ' with a blue shade')
    const found = JSON.parse(
      parts(await callTool(APP, 'search_documents', { query: 'blue shade' }, signal))[0]
    )
    expect(found.results.map(hit => hit.path)).toEqual(['Plan'])

    type('shade', ', trimmed')
    const described = JSON.parse(
      parts(await callTool(APP, 'describe_document', { path: 'Plan' }, signal))[0]
    )
    expect(described.words).toBe(20)

    type('rowing ro', 'pe and ro')
    const comments = JSON.parse(parts(await callTool(APP, 'list_comments', {}, signal))[0])
    expect(comments.comments.map(comment => comment.passage)).toEqual(['rowing rope and rope'])

    type('trimmed', ' twice')
    const read = parts(await callTool(APP, 'read_document', { path: 'Plan' }, signal))
    expect(read[1]).toBe(
      'The vault opens at noon, by the harbour clock.\n\nBring rowing rope and rope and a lamp with a blue shade, trimmed twice.'
    )
  })

  it('writes the editor out once, and takes the document once before and once after', async () => {
    const counted = async (app, name, args) => {
      written.out = 0
      stateAt.mockClear()
      const answer = await callTool(app, name, args, signal)
      return { answer, flushed: written.out, taken: stateAt.mock.calls.length }
    }

    const read = await counted(WRITER, 'read_document', { path: 'Plan' })
    expect(read).toMatchObject({ flushed: 1, taken: 2 })
    const { revision } = JSON.parse(parts(read.answer)[0])

    // Still at the revision held: answered from the document as it is.
    expect(await counted(WRITER, 'read_document', { path: 'Plan', revision })).toMatchObject({
      flushed: 1,
      taken: 1,
    })

    const edit = { path: 'Plan', old: 'at noon', new: 'at dusk' }
    const made = await counted(WRITER, 'edit_document', edit)
    expect(made).toMatchObject({ flushed: 1, taken: 2 })
    expect(JSON.parse(parts(made.answer)[0])).toMatchObject({ success: true })

    const suggested = await counted(WRITER, 'append_document', {
      path: 'Plan',
      text: '* chalk',
      suggest: true,
    })
    expect(suggested).toMatchObject({ flushed: 1, taken: 2 })
    expect(parts(suggested.answer)[1]).toBe('- chalk')

    // Refused from the document as it is before: the tool is not run.
    const refused = await counted(WRITER, 'edit_document', {
      path: 'odds.py',
      old: 'print(1)',
      new: 'print(2)',
      suggest: true,
    })
    expect(refused).toMatchObject({ flushed: 1, taken: 1 })
    expect(refused.answer.result.isError).toBe(true)

    for (const [name, args] of [
      ['list_documents', {}],
      ['search_documents', { query: 'vault' }],
      ['describe_document', { path: 'Plan' }],
      ['list_comments', {}],
      ['move_document', { path: 'odds.py', to: 'evens.py' }],
    ]) {
      expect(await counted(WRITER, name, args), name).toMatchObject({ flushed: 1, taken: 0 })
    }
  })

  it('says what a write left from one pair: its revision, and how the text was stored', async () => {
    const read = await callTool(WRITER, 'read_document', { path: 'Plan' }, signal)
    type('at noon', ' sharp')

    const answer = await callTool(
      WRITER,
      'edit_document',
      { path: 'Plan', old: 'Bring rope and a lamp.', new: '* rope\n* a lamp' },
      signal
    )

    const [about, stored] = parts(answer)
    expect(stored).toBe('- rope\n- a lamp')
    // What was typed before the call is not the call's own change.
    expect(JSON.parse(about).changedSince).toEqual({
      revision: JSON.parse(parts(read)[0]).revision,
      note: expect.stringContaining('changes_since'),
    })
    expect(JSON.parse(about).revision).toBe(
      (await stateAt({ storyId: STORY, chatId: 'app:app_1' }, 'Plan')).seen.revision
    )
  })
})

describe('a change that is suggested', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  const PLAN = 'The vault opens at noon.\n\nBring rope and a lamp.'

  /** The plan as someone else reads it: the text as it stands. */
  const asItStands = async () =>
    (await executeReadDocument({ path: 'Plan' }, { storyId: STORY })).content

  /** The plan as the connection reads it. */
  const asRead = async app =>
    parts(await callTool(app, 'read_document', { path: 'Plan' }, signal))[1]

  /** A call that suggests its change, as an app asked for suggestions makes it. */
  const suggest = (app, name, args) => callTool(app, name, { ...args, suggest: true }, signal)

  /** The plan's suggestions, by their ids. */
  const suggestions = () =>
    Object.entries(store.getDocument('doc_plan').comments || {}).filter(
      ([, thread]) => thread.suggestion
    )

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    vi.clearAllMocks()
    records.kept = new Map()
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

  it('is laid out in the text for the writer, under the connection’s name, and read as made', async () => {
    const answer = await suggest(WRITER, 'edit_document', {
      path: 'Plan',
      old: 'Bring rope',
      new: 'Bring wire',
    })

    const said = JSON.parse(parts(answer)[0])
    expect(said).toMatchObject({ suggested: true, document: { path: 'Plan' } })
    expect(said.note).toContain('accepts or rejects')

    expect(await asItStands()).toBe(PLAN)
    expect(await asRead(WRITER)).toBe(PLAN.replace('rope', 'wire'))

    const [[id, thread]] = suggestions()
    expect(id).toBe(said.suggestion)
    expect(thread.suggestion).toMatchObject({ chat: 'app:app_1', name: 'Claude Code' })
    expect(thread.status).toBe('open')
  })

  it('folds a later change that touches its suggestion into it', async () => {
    const first = JSON.parse(
      parts(
        await suggest(WRITER, 'edit_document', {
          path: 'Plan',
          old: 'Bring rope',
          new: 'Bring wire',
        })
      )[0]
    )
    const second = JSON.parse(
      parts(
        await suggest(WRITER, 'edit_document', {
          path: 'Plan',
          old: 'Bring wire',
          new: 'Bring thin wire',
        })
      )[0]
    )

    expect(second.suggestion).toBe(first.suggestion)
    expect(suggestions()).toHaveLength(1)
    expect(await asRead(WRITER)).toContain('Bring thin wire and a lamp.')
    expect(await asItStands()).toBe(PLAN)
  })

  it('is one connection’s: another reads the text as it stands, and suggests apart', async () => {
    await suggest(WRITER, 'edit_document', { path: 'Plan', old: 'Bring rope', new: 'Bring wire' })
    const other = { ...WRITER, id: 'app_2', name: 'Another agent' }

    expect(await asRead(other)).toBe(PLAN)
    await suggest(other, 'edit_document', { path: 'Plan', old: 'at noon', new: 'at dusk' })

    expect(
      suggestions()
        .map(([, thread]) => thread.suggestion.name)
        .sort()
    ).toEqual(['Another agent', 'Claude Code'])
    expect(await asRead(other)).toBe(PLAN.replace('noon', 'dusk'))
    expect(await asRead(WRITER)).toBe(PLAN.replace('rope', 'wire'))
  })

  it('can be several edits in a call, and what is added to the end', async () => {
    const many = await suggest(WRITER, 'edit_document', {
      path: 'Plan',
      edits: [
        { old: 'noon', new: 'dusk' },
        { old: 'rope', new: 'wire' },
      ],
    })
    expect(JSON.parse(parts(many)[0])).toMatchObject({ suggested: true, edits: 2 })

    const added = await suggest(WRITER, 'append_document', { path: 'Plan', text: '* chalk' })
    const [about, stored] = parts(added)
    expect(JSON.parse(about).suggested).toBe(true)
    expect(stored).toBe('- chalk')

    expect(await asItStands()).toBe(PLAN)
    expect(await asRead(WRITER)).toBe(
      'The vault opens at dusk.\n\nBring wire and a lamp.\n\n- chalk'
    )
  })

  it('is listed where the connection reads until the writer settles it, with what was said on it', async () => {
    const made = JSON.parse(
      parts(await suggest(WRITER, 'edit_document', { path: 'Plan', old: 'rope', new: 'wire' }))[0]
    )
    await callTool(
      WRITER,
      'reply_comment',
      { path: 'Plan', id: made.suggestion, text: 'Wire holds more.' },
      signal
    )
    const waiting = {
      id: made.suggestion,
      by: 'you',
      from: 'rope',
      to: 'wire',
      posts: [{ author: 'Claude Code', text: 'Wire holds more.' }],
    }

    // After a read's text, where its comments would be.
    const read = parts(await callTool(WRITER, 'read_document', { path: 'Plan' }, signal))
    expect(read[1]).toBe(PLAN.replace('rope', 'wire'))
    expect(JSON.parse(read[2])).toEqual({ suggestions: [waiting] })

    // Among a list of comments, by its document.
    const all = await callTool(WRITER, 'list_comments', {}, signal)
    expect(JSON.parse(parts(all)[0])).toEqual({
      comments: [],
      suggestions: [{ ...waiting, path: 'Plan' }],
    })

    // Another connection is told of it as this one's: its text is as it stands.
    const other = { ...WRITER, id: 'app_2', name: 'Another agent' }
    const theirs = parts(await callTool(other, 'read_document', { path: 'Plan' }, signal))
    expect(theirs[1]).toBe(PLAN)
    expect(JSON.parse(theirs[2])).toEqual({ suggestions: [{ ...waiting, by: 'Claude Code' }] })

    // Settled, it waits no more.
    expect(useComments(STORY).accept('doc_plan', made.suggestion)).toBe(true)
    expect(parts(await callTool(WRITER, 'read_document', { path: 'Plan' }, signal))).toHaveLength(2)
    const after = await callTool(WRITER, 'list_comments', { path: 'Plan' }, signal)
    expect(JSON.parse(parts(after)[0])).toEqual({ comments: [] })
  })

  it('is listed beside the comments on what was read, in the text’s order', async () => {
    await callTool(
      WRITER,
      'add_comment',
      { path: 'Plan', passage: 'a lamp', text: 'Two lamps.' },
      signal
    )
    const rope = JSON.parse(
      parts(await suggest(WRITER, 'edit_document', { path: 'Plan', old: 'rope', new: 'wire' }))[0]
    )
    const noon = JSON.parse(
      parts(await suggest(WRITER, 'edit_document', { path: 'Plan', old: 'noon', new: 'dusk' }))[0]
    )

    const read = parts(await callTool(WRITER, 'read_document', { path: 'Plan' }, signal))
    const after = JSON.parse(read[2])

    expect(after.comments).toHaveLength(1)
    expect(after.suggestions).toEqual([
      { id: noon.suggestion, by: 'you', from: 'noon', to: 'dusk' },
      { id: rope.suggestion, by: 'you', from: 'rope', to: 'wire' },
    ])
  })

  it('can be a whole rewrite', async () => {
    const answer = await suggest(WRITER, 'update_document', {
      path: 'Plan',
      content: 'The vault opens at dusk.',
    })

    expect(JSON.parse(parts(answer)[0]).suggested).toBe(true)
    expect(await asItStands()).toBe(PLAN)
    expect(await asRead(WRITER)).toBe('The vault opens at dusk.')
  })

  it('is refused for a plain document, which has no room for the marks, and made without', async () => {
    await callTool(WRITER, 'create_document', { path: 'odds.py', content: 'print(1)' }, signal)
    const script = () => [...store.documents.values()].find(one => one.title === 'odds.py')

    const refused = await suggest(WRITER, 'edit_document', {
      path: 'odds.py',
      old: 'print(1)',
      new: 'print(2)',
    })
    expect(refused.result.isError).toBe(true)
    expect(parts(refused)[0]).toContain('A change to "odds.py" can\'t be suggested')
    expect(script().content).toBe('print(1)')

    const made = await callTool(
      WRITER,
      'edit_document',
      { path: 'odds.py', old: 'print(1)', new: 'print(2)' },
      signal
    )
    expect(JSON.parse(parts(made)[0])).toMatchObject({ success: true })
    expect(script().content).toBe('print(2)')
  })

  it('leaves the path to the tool to turn down, where nothing is at it', async () => {
    const answer = await suggest(WRITER, 'edit_document', { path: 'Nothing', old: 'a', new: 'b' })
    expect(answer.result.isError).toBe(true)
    expect(parts(answer)[0]).toContain('Nothing')
    expect(parts(answer)[0]).not.toContain('suggested')
  })

  it('is asked for with true or false: anything else is refused, and nothing is changed', async () => {
    const calls = {
      edit_document: { path: 'Plan', old: 'rope', new: 'wire' },
      append_document: { path: 'Plan', text: 'And a map.' },
      update_document: { path: 'Plan', content: 'All new.' },
    }
    // What a client sends for a yes when it has the type wrong: taken for a
    // no, each would have the change made where a suggestion was asked for.
    for (const suggest of ['true', 'please', 1, 0, null, {}, ['true']]) {
      for (const [name, args] of Object.entries(calls)) {
        const answer = await callTool(WRITER, name, { ...args, suggest }, signal)
        expect(answer.result, `${name} ${JSON.stringify(suggest)}`).toEqual({
          content: [
            {
              type: 'text',
              text: '"suggest" is true or false: true has the change suggested to the user, and false, or leaving it out, has it made. Nothing was changed.',
            },
          ],
          isError: true,
        })
      }
    }
    expect(await asItStands()).toBe(PLAN)
    expect(suggestions()).toHaveLength(0)

    // A plain no has the change made, as leaving it out does.
    await callTool(
      WRITER,
      'edit_document',
      { path: 'Plan', old: 'rope', new: 'wire', suggest: false },
      signal
    )
    expect(await asItStands()).toBe(PLAN.replace('rope', 'wire'))
    expect(suggestions()).toHaveLength(0)
  })

  it('is not how a change is made unless asked: an edit is in the text at once', async () => {
    await callTool(WRITER, 'edit_document', { path: 'Plan', old: 'rope', new: 'wire' }, signal)
    expect(await asItStands()).toBe(PLAN.replace('rope', 'wire'))
    expect(suggestions()).toHaveLength(0)
  })
})
