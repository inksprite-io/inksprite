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
import { projectOverview } from '@/ai/tools/documents.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

const STORY = 'story_1'

const APP = {
  id: 'app_1',
  name: 'Claude Code',
  projects: [STORY],
  edit: 'suggesting',
  comment: true,
}

const signal = new AbortController().signal

/** What an answer says, its parts as they were sent. */
const parts = answer => answer.result.content.map(part => part.text)

describe('toolsFor', () => {
  it('offers the projects’ list and the tools that read, each read-only', () => {
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

  it('has every document tool take the project, as well as what it takes of a chat', () => {
    const [list, ...documents] = toolsFor(APP)
    expect(list.inputSchema.properties).toEqual({})
    for (const tool of documents) {
      expect(Object.keys(tool.inputSchema.properties)[0]).toBe('project')
      expect(tool.inputSchema.required || []).not.toContain('project')
    }
    const read = documents.find(tool => tool.name === 'read_document')
    expect(Object.keys(read.inputSchema.properties)).toContain('section')
    expect(read.inputSchema.required).toEqual(['path'])
  })

  it('says nothing of what only a chat has: its conversation, its block, tools not offered', () => {
    for (const tool of toolsFor(APP)) {
      expect(tool.description, tool.name).not.toMatch(
        /explore_documents|project block|conversation|use_skill|still above/
      )
    }
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
})
