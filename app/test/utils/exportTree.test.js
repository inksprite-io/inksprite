import { describe, it, expect } from 'vitest'
import {
  afterReading,
  documentsWith,
  exportPick,
  exportTree,
  leavesOf,
  selectionKeys,
  tickedLeaves,
} from '@/utils/exportTree.js'

const ROOT = 'root_story_a'

/** A document of project A. */
const doc = (id, parentId, title, extra = {}) => ({
  id,
  storyId: 'story_a',
  parentId,
  title,
  type: 'text',
  order: 0,
  ...extra,
})

const DOCUMENTS = [
  doc(ROOT, 'story_a', 'Thief', { type: 'folder' }),
  doc('doc_manuscript', ROOT, 'Manuscript', { type: 'folder', ordered: true }),
  doc('doc_two', 'doc_manuscript', 'Chapter 2', { order: 2 }),
  doc('doc_one', 'doc_manuscript', 'Chapter 1', { order: 1 }),
  doc('doc_notes', ROOT, 'Notes'),
  doc('doc_empty', ROOT, 'Empty folder', { type: 'folder' }),
]

const CHATS = [
  { id: 'chat_old', storyId: 'story_a', title: 'Older', lastMessageAt: 1 },
  { id: 'chat_new', storyId: 'story_a', title: 'Newer', lastMessageAt: 5 },
]

const SETTINGS = [
  { key: 'aiProviders/provider_proxy', kind: 'aiProviders', name: 'Team proxy' },
  {
    key: 'aiProfiles/profile_team',
    kind: 'aiProfiles',
    name: 'Team',
    needs: ['aiProviders/provider_proxy'],
  },
  { key: 'settings/preferences', kind: 'settings', name: 'Preferences' },
]

/** Project A read, project B not yet, a card, and the settings. */
const exportable = (contents = { documents: DOCUMENTS, chats: CHATS }) => ({
  projects: [
    { id: 'story_b', title: 'Field notes' },
    { id: 'story_a', title: 'Thief', contents },
  ],
  cards: [{ id: 'libcard_wren', title: 'Wren' }],
  settings: SETTINGS,
})

/** The labels of a tree, nested as it is. */
const shape = nodes =>
  nodes.map(node => (node.children ? { [node.label]: shape(node.children) } : node.label))

describe('exportTree', () => {
  it('has the projects, the cards and the settings, each project as the outline has it', () => {
    expect(shape(exportTree(exportable()))).toEqual([
      {
        Projects: [
          'Field notes',
          {
            Thief: [
              {
                Documents: ['Empty folder', { Manuscript: ['Chapter 1', 'Chapter 2'] }, 'Notes'],
              },
              { Chats: ['Newer', 'Older'] },
            ],
          },
        ],
      },
      { 'Character cards': ['Wren'] },
      {
        Settings: [
          { Connections: ['Team proxy'] },
          { Presets: ['Team'] },
          { 'App settings': ['Preferences'] },
        ],
      },
    ])
  })

  it('leaves a project not read yet to be opened', () => {
    const [projects] = exportTree(exportable())
    expect(projects.children[0]).toEqual({
      key: 'project:story_b',
      label: 'Field notes',
      leaf: false,
    })
  })

  it('opens a project with nothing in it on a line with no box, and ticks it for itself', () => {
    const nodes = exportTree(exportable({ documents: [DOCUMENTS[0]], chats: [] }))
    const empty = nodes[0].children[1]
    expect(empty).toEqual({
      key: 'project:story_a',
      label: 'Thief',
      leaf: false,
      children: [{ key: 'empty:story_a', label: 'Empty', selectable: false }],
    })

    expect(leavesOf(nodes)).toContain('project:story_a')
    expect(leavesOf(nodes)).not.toContain('empty:story_a')
    const ticked = new Set(['project:story_a'])
    expect(selectionKeys(nodes, ticked)['project:story_a']).toEqual({
      checked: true,
      partialChecked: false,
    })
    expect(afterReading(ticked, nodes, 'story_a')).toBe(ticked)
    expect(exportPick(nodes, ticked).projects).toEqual([
      { id: 'story_a', whole: true, documentIds: [], chatIds: [] },
    ])
  })

  it('leaves out what there is none of', () => {
    expect(shape(exportTree({ projects: [], cards: [], settings: SETTINGS.slice(0, 1) }))).toEqual([
      { Settings: [{ Connections: ['Team proxy'] }] },
    ])
  })
})

describe('the ticks', () => {
  const nodes = exportTree(exportable())

  it('checks a node with all under it ticked, and partly one with some', () => {
    const keys = selectionKeys(nodes, new Set(['document:doc_one', 'card:libcard_wren']))
    expect(keys['document:doc_one']).toEqual({ checked: true, partialChecked: false })
    expect(keys['document:doc_manuscript']).toEqual({ checked: false, partialChecked: true })
    expect(keys['project:story_a']).toEqual({ checked: false, partialChecked: true })
    expect(keys.cards).toEqual({ checked: true, partialChecked: false })
    expect(keys.settings).toBeUndefined()
  })

  it('reads the leaves back from the ticks, with what a setting needs', () => {
    const before = new Set()
    const keys = { 'setting:aiProfiles/profile_team': { checked: true }, chats: { checked: true } }
    expect([...tickedLeaves(nodes, keys, before, SETTINGS)].sort()).toEqual([
      'setting:aiProfiles/profile_team',
      'setting:aiProviders/provider_proxy',
    ])
  })

  it('leaves a need unticked when the writer unticks it', () => {
    const before = new Set([
      'setting:aiProfiles/profile_team',
      'setting:aiProviders/provider_proxy',
    ])
    const keys = { 'setting:aiProfiles/profile_team': { checked: true } }
    expect([...tickedLeaves(nodes, keys, before, SETTINGS)]).toEqual([
      'setting:aiProfiles/profile_team',
    ])
  })

  it('ticks all of a project ticked whole once it has been read', () => {
    const unread = exportTree({ ...exportable(), projects: [{ id: 'story_a', title: 'Thief' }] })
    const ticked = new Set(leavesOf(unread))
    expect(ticked.has('project:story_a')).toBe(true)

    const after = afterReading(ticked, exportTree(exportable()), 'story_a')
    expect(after.has('project:story_a')).toBe(false)
    expect(after.has('document:doc_two')).toBe(true)
    expect(after.has('chat:chat_old')).toBe(true)
  })

  it('leaves a project unticked as it was once read', () => {
    const after = afterReading(new Set(['card:libcard_wren']), nodes, 'story_a')
    expect([...after]).toEqual(['card:libcard_wren'])
  })
})

describe('exportPick', () => {
  const nodes = exportTree(exportable())

  it('is everything with every box ticked', () => {
    const pick = exportPick(nodes, new Set(leavesOf(nodes)))
    expect(pick.everything).toBe(true)
    expect(pick.projects).toEqual([
      { id: 'story_b', whole: true, documentIds: [], chatIds: [] },
      {
        id: 'story_a',
        whole: true,
        documentIds: ['doc_empty', 'doc_one', 'doc_two', 'doc_notes'],
        chatIds: ['chat_new', 'chat_old'],
      },
    ])
  })

  it('has the documents and chats ticked of a project, and the cards and settings', () => {
    const pick = exportPick(
      nodes,
      new Set([
        'document:doc_two',
        'chat:chat_new',
        'card:libcard_wren',
        'setting:settings/preferences',
      ])
    )
    expect(pick.everything).toBe(false)
    expect(pick.projects).toEqual([
      { id: 'story_a', whole: false, documentIds: ['doc_two'], chatIds: ['chat_new'] },
    ])
    expect(pick.cardIds).toEqual(['libcard_wren'])
    expect([...pick.settings]).toEqual(['settings/preferences'])
  })

  it('has no project with nothing of it ticked', () => {
    expect(exportPick(nodes, new Set(['card:libcard_wren'])).projects).toEqual([])
  })
})

describe('documentsWith', () => {
  it('keeps those picked, the folders above them and the root', () => {
    expect(documentsWith(DOCUMENTS, 'story_a', ['doc_two']).map(row => row.id)).toEqual([
      ROOT,
      'doc_manuscript',
      'doc_two',
    ])
  })

  it('keeps the root alone with nothing picked, for the project’s name', () => {
    expect(documentsWith(DOCUMENTS, 'story_a', []).map(row => row.id)).toEqual([ROOT])
  })
})
