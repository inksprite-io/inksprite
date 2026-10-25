/* global Blob */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { openProject, writeProject } from '@/scrivener/project.js'
import { useDocuments, clearDocumentInstances } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { barePng, minimalPdf } from '../files/helpers.js'
import { PARAGRAPH, plainRtf, projectOf, rtf } from './helpers.js'

vi.mock('@/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      filter: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
      bulkDelete: vi.fn(),
      bulkGet: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
    },
    files: { put: vi.fn(async () => undefined), get: vi.fn(async () => undefined) },
    stories: { toArray: vi.fn(async () => []) },
  },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const STORY = 'story_1'

/** A project with a little of everything the import handles. */
const harbour = () =>
  projectOf(
    'Harbour',
    [
      {
        id: 'DRAFT',
        type: 'DraftFolder',
        title: 'Manuscript',
        children: [
          {
            id: 'CH1',
            type: 'Folder',
            title: 'Chapter One',
            files: {
              'content.rtf': plainRtf('The chapter opens on the quay.'),
              'synopsis.txt': 'Arrival at the harbour.',
            },
            children: [
              {
                id: 'SC1',
                type: 'Text',
                title: 'Arrival',
                files: {
                  'content.rtf': rtf(String.raw`${PARAGRAPH}
\f0\fs24 \cf0 <$ScrKeepWithNext><$Scr_Ps::0>
\f1\fs56 Arrival\
<!$Scr_Ps::0>
\f0\fs26 The tide came in.`),
                  'content.styles': 'STYLE-TITLE',
                  'notes.rtf': plainRtf('Check the tide tables.'),
                },
              },
              { id: 'SC2', type: 'Text', title: 'Storm' },
            ],
          },
          {
            id: 'EPI',
            type: 'Text',
            title: 'Epilogue',
            files: { 'content.rtf': plainRtf('Years later.') },
            children: [
              {
                id: 'CODA',
                type: 'Text',
                title: 'Coda',
                files: { 'content.rtf': plainRtf('The end.') },
              },
            ],
          },
        ],
      },
      {
        id: 'CHARS',
        type: 'Folder',
        title: 'Characters',
        children: [
          { id: 'K', type: 'Text', title: ' ', files: { 'content.rtf': plainRtf('A keeper.') } },
        ],
      },
      {
        id: 'RES',
        type: 'ResearchFolder',
        title: 'Research',
        children: [
          {
            id: 'PDF1',
            type: 'PDF',
            title: 'Tide tables',
            extension: 'pdf',
            files: { 'content.pdf': minimalPdf([['High water at noon']]) },
          },
          {
            id: 'IMG',
            type: 'Image',
            title: 'Map',
            extension: 'png',
            files: { 'content.png': barePng() },
          },
          {
            id: 'BAD',
            type: 'PDF',
            title: 'Torn chart',
            extension: 'pdf',
            files: { 'content.pdf': 'not a pdf' },
          },
        ],
      },
      {
        id: 'TRASH',
        type: 'TrashFolder',
        title: 'Trash',
        children: [
          {
            id: 'CUT',
            type: 'Text',
            title: 'Cut scene',
            files: { 'content.rtf': plainRtf('Gone.') },
          },
        ],
      },
    ],
    { 'STYLE-TITLE': 'Title' }
  )

describe('openProject', () => {
  it('reads the binder and the styles', async () => {
    const project = await openProject(harbour())

    expect(project.name).toBe('Harbour')
    expect(project.binder.map(item => item.title)).toEqual(['Manuscript', 'Characters', 'Research'])
    expect(project.styles.get('STYLE-TITLE')).toBe('Title')
  })

  it('says why a package cannot be imported', async () => {
    const without = { name: 'Loose', files: new Map([['notes.txt', new Blob(['x'])]]) }
    await expect(openProject(without)).rejects.toThrow('There is no Scrivener project in it.')

    const older = {
      name: 'Old',
      files: new Map([
        ['Old.scrivx', new Blob(['<ScrivenerProject><Binder/></ScrivenerProject>'])],
        ['Files/Docs/3.rtf', new Blob(['{\\rtf1 x}'])],
      ]),
    }
    await expect(openProject(older)).rejects.toThrow('This project is from an older Scrivener.')
  })
})

describe('writeProject', () => {
  /** @type {ReturnType<typeof useDocuments>} */
  let api

  beforeEach(() => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    api = useDocuments(STORY)
  })

  /** @param {string} parentId */
  const childrenOf = parentId => api.childrenOf(parentId)
  /**
   * @param {string} parentId
   * @param {string} title
   */
  const childOf = (parentId, title) => {
    const found = childrenOf(parentId).find(child => child.title === title)
    if (!found) throw new Error(`No ${title} under ${parentId}`)
    return found
  }
  /** @param {string} parentId */
  const titlesUnder = parentId => childrenOf(parentId).map(child => child.title)
  /**
   * @param {string} parentId
   * @returns {string[]}
   */
  const allTitles = parentId =>
    childrenOf(parentId).flatMap(child => [child.title, ...allTitles(child.id)])

  it('writes the binder into a folder named after the project, in the binder’s order', async () => {
    const result = await writeProject(STORY, await openProject(harbour()), { asFolder: true })

    const root = rootIdFor(STORY)
    expect(titlesUnder(root)).toEqual(['Harbour'])
    const project = childOf(root, 'Harbour')
    expect(project).toMatchObject({ type: 'folder', ordered: true })
    expect(titlesUnder(project.id)).toEqual(['Manuscript', 'Characters', 'Research'])

    const manuscript = childOf(project.id, 'Manuscript')
    expect(titlesUnder(manuscript.id)).toEqual(['Chapter One', 'Epilogue'])

    // A folder's own text first, then its synopsis, then what is under it,
    // each with its notes after it.
    const chapter = childOf(manuscript.id, 'Chapter One')
    expect(chapter).toMatchObject({ type: 'folder', ordered: true })
    expect(titlesUnder(chapter.id)).toEqual([
      'Chapter One',
      'Chapter One synopsis',
      'Arrival',
      'Arrival notes',
      'Storm',
    ])
    expect(childOf(chapter.id, 'Chapter One').content).toBe('The chapter opens on the quay.')
    expect(childOf(chapter.id, 'Chapter One synopsis').content).toBe('Arrival at the harbour.')
    expect(childOf(chapter.id, 'Arrival').content).toBe('# Arrival\n\nThe tide came in.')
    expect(childOf(chapter.id, 'Arrival notes').content).toBe('Check the tide tables.')
    expect(childOf(chapter.id, 'Storm')).toMatchObject({ type: 'text', content: '' })

    // A text with items under it is that text, holding them in order.
    const epilogue = childOf(manuscript.id, 'Epilogue')
    expect(epilogue).toMatchObject({ type: 'text', content: 'Years later.', ordered: true })
    expect(titlesUnder(epilogue.id)).toEqual(['Coda'])
    expect(childOf(epilogue.id, 'Coda').content).toBe('The end.')

    const characters = childOf(project.id, 'Characters')
    expect(titlesUnder(characters.id)).toEqual(['Untitled'])

    const research = childOf(project.id, 'Research')
    expect(titlesUnder(research.id)).toEqual(['Tide tables', 'Map', 'Torn chart'])
    expect(childOf(research.id, 'Tide tables')).toMatchObject({
      type: 'file',
      mime: 'application/pdf',
    })
    expect(childOf(research.id, 'Tide tables').content).toContain('High water at noon')
    expect(childOf(research.id, 'Map')).toMatchObject({ type: 'file', mime: 'image/png' })
    // A file that cannot be read is kept, with no text.
    expect(childOf(research.id, 'Torn chart')).toMatchObject({
      type: 'file',
      mime: 'application/pdf',
      content: '',
    })

    expect(allTitles(root)).not.toContain('Cut scene')
    expect(result).toEqual({ documents: 11, folders: 5, cards: 0, scans: 1, skipped: [] })
  })

  it('writes a file with items under it as the file, its synopsis and notes first', async () => {
    const project = projectOf('Charts', [
      {
        id: 'PDF1',
        type: 'PDF',
        title: 'Tide tables',
        extension: 'pdf',
        files: {
          'content.pdf': minimalPdf([['High water at noon']]),
          'synopsis.txt': 'The spring tides.',
        },
        children: [
          {
            id: 'N1',
            type: 'Text',
            title: 'Reading them',
            files: { 'content.rtf': plainRtf('Count from the moon.') },
          },
        ],
      },
    ])
    await writeProject(STORY, await openProject(project))

    const tables = childOf(rootIdFor(STORY), 'Tide tables')
    expect(tables).toMatchObject({ type: 'file', mime: 'application/pdf', ordered: true })
    expect(titlesUnder(tables.id)).toEqual(['Tide tables synopsis', 'Reading them'])
  })

  it('writes straight into the project, which then keeps the binder’s order', async () => {
    await writeProject(STORY, await openProject(harbour()))

    const root = rootIdFor(STORY)
    expect(api.isOrdered(root)).toBe(true)
    expect(titlesUnder(root)).toEqual(['Manuscript', 'Characters', 'Research'])
  })
})
