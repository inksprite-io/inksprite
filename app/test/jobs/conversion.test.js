/* global structuredClone, Blob */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { startConversion, isRunning } from '@/jobs/index.js'
import { useDocumentsStore } from '@/stores/documentsStore.js'
import { useJobsStore } from '@/stores/jobsStore.js'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

const rows = new Map()
vi.mock('@/stores/db', () => ({
  default: {
    jobs: {
      put: vi.fn(async row => rows.set(row.id, structuredClone(row))),
      delete: vi.fn(async id => rows.delete(id)),
      toArray: vi.fn(async () => [...rows.values()]),
    },
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
      bulkGet: vi.fn(async () => []),
      get: vi.fn(async () => undefined),
    },
    files: { get: vi.fn(async () => ({ id: 'doc_pdf', blob: new Blob(['%PDF']) })) },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
}))

const provider = { id: 'p1', name: 'Test', type: 'generic', endpoint: 'http://x' }
vi.mock('@/composables/useAIConfig.js', () => ({
  useAIConfig: () => ({
    activeAIPreset: { value: { providerId: 'p1', model: 'glm' } },
    getProvider: id => (id === 'p1' ? provider : null),
  }),
}))
vi.mock('@/composables/useApplicationState.js', () => ({
  useApplicationState: () => ({ workflows: { value: { convert: {} } } }),
}))

/** A PDF's layout, with bookmarks, for the file path. */
vi.mock('@/files/pdf.js', () => ({
  readPdfLayout: vi.fn(async () => ({
    pages: [
      {
        number: 1,
        lines: [
          { text: 'Spells', size: 14, y: 800 },
          ...Array.from({ length: 20 }, (_, at) => ({
            text: `Spell sentence number ${at} is about magic.`,
            size: 8,
            y: 700 - at,
          })),
        ],
      },
    ],
    outline: [{ title: 'Spells', level: 1, page: 1, top: 800 }],
  })),
}))

/**
 * The model: it names the headings when asked for them, and otherwise gives
 * back the text it was sent, which is a conversion that passes every check.
 */
const asked = []
vi.mock('@/ai/complete.js', () => ({
  complete: vi.fn(async ({ messages }) => {
    const [system, user] = messages
    if (system.content.startsWith('You find the headings')) {
      asked.push('structure')
      const numbered = user.content.split('\n').filter(line => /^\d+ /.test(line))
      const found = numbered.filter(line => /^\d+ (Intro|Details)$/.test(line))
      return {
        content: found.map(line => line.replace(/^(\d+) (.*)$/, '$1 1 $2')).join('\n'),
        finishReason: 'stop',
      }
    }
    asked.push('convert')
    return { content: user.content.split('to Markdown:\n\n')[1], finishReason: 'stop' }
  }),
}))

const STORY = 'story_1'
const sentences = tag =>
  Array.from({ length: 20 }, (_, at) => `The ${tag} sentence number ${at} says something.`)

/** Wait for a job to stop running. */
const settled = async id => {
  for (let tries = 0; tries < 200 && isRunning(id); tries++) {
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  await new Promise(resolve => setTimeout(resolve, 5))
}

describe('converting a document, as a job', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let documents

  beforeEach(async () => {
    setActivePinia(createPinia())
    rows.clear()
    asked.length = 0
    documents = useDocumentsStore()
    await documents.loadStory(STORY)
    documents.ensureRoot(STORY, 'Project')
  })

  it('asks for the headings first, then converts, and writes a copy beside it', async () => {
    const source = documents.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'text',
      title: 'Notes',
      content: ['Intro', ...sentences('intro'), '', 'Details', ...sentences('detail')].join('\n'),
    })

    const job = await startConversion(STORY, source.id)
    expect(job.steps.map(step => step.id)).toEqual(['structure'])
    await settled(job.id)

    const done = useJobsStore().getJob(job.id)
    expect(done.status).toBe('done')
    expect(asked).toEqual(['structure', 'convert'])
    expect(done.steps.map(step => step.label)).toEqual(['Finding the sections', 'Intro +1'])

    const copy = [...documents.documents.values()].find(one => one.convertedFrom === source.id)
    expect(copy.title).toBe('Notes (Markdown)')
    expect(copy.parentId).toBe(rootIdFor(STORY))
    expect(copy.plain).toBeFalsy()
    expect(
      copy.content.startsWith('- [Intro](#intro)\n- [Details](#details)\n\n---\n\n# Intro')
    ).toBe(true)
    expect(copy.content).toContain('# Details\n\nThe detail sentence number 0 says something.')
    // The source is left as it was.
    expect(documents.getDocument(source.id).content.startsWith('Intro\nThe intro')).toBe(true)

    // Converting again replaces the copy rather than making another.
    const again = await startConversion(STORY, source.id)
    await settled(again.id)
    const copies = [...documents.documents.values()].filter(one => one.convertedFrom === source.id)
    expect(copies).toHaveLength(1)
  })

  it("plans a PDF's requests from its bookmarks, with no structure step", async () => {
    const pdf = documents.createDocument({
      id: 'doc_pdf',
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'file',
      title: 'Grimoire',
      mime: 'application/pdf',
      content: '[p.1]\nSpells\n...',
    })

    const job = await startConversion(STORY, pdf.id)
    expect(job.steps.map(step => step.label)).toEqual(['Spells · p. 1'])
    expect(job.plan.lines.every(line => !('y' in line))).toBe(true)
    await settled(job.id)

    expect(asked).toEqual(['convert'])
    const copy = [...documents.documents.values()].find(one => one.convertedFrom === pdf.id)
    expect(copy.title).toBe('Grimoire (Markdown)')
    expect(copy.content).toContain('# Spells\n\nSpell sentence number 0 is about magic.')
  })

  it('numbers the copy beside a document that already has its name', async () => {
    documents.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'text',
      title: 'Notes (Markdown)',
    })
    const source = documents.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'text',
      title: 'Notes',
      content: ['Intro', ...sentences('intro')].join('\n'),
    })

    await settled((await startConversion(STORY, source.id)).id)

    const copy = [...documents.documents.values()].find(one => one.convertedFrom === source.id)
    expect(copy.title).toBe('Notes (Markdown) (2)')
  })

  it('refuses a document with no text', async () => {
    const empty = documents.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'text',
      title: 'Empty',
      content: '   ',
    })
    await expect(startConversion(STORY, empty.id)).rejects.toThrow(/no text/)
  })
})
