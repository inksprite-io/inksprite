import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  projectOverview,
  executeListDocuments,
  executeReadDocument,
  executeDescribeDocument,
  executeSearchDocuments,
} from '@/ai/tools/documents.js'
import { writeRepository } from '@/source/write.js'
import { readInView, textHash } from '@/ai/context/reads.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { clearDocumentInstances } from '@/composables/useDocuments'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

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

/** A file of `count` numbered lines, each `const line<N> = <N>`. */
const numbered = count =>
  Array.from({ length: count }, (_, at) => `const line${at + 1} = ${at + 1}`).join('\n') + '\n'

const MERGE = [
  '# Merges two lists of operations.',
  'import { clock } from "./clock"',
  '',
  'def merge_ops(local, remote):',
  '    # Later clocks win.',
  '    return sorted(local + remote, key=clock)',
  '',
].join('\n')

describe('document tools, on a repository', () => {
  /** @type {ReturnType<typeof useDocumentsStore>} */
  let store

  beforeEach(async () => {
    setActivePinia(createPinia())
    clearDocumentInstances()
    store = useDocumentsStore()
    vi.clearAllMocks()

    await projectOverview(STORY)
    const design = store.createDocument({
      storyId: STORY,
      parentId: rootIdFor(STORY),
      type: 'folder',
      title: 'Design',
    })
    store.createDocument({
      storyId: STORY,
      parentId: design.id,
      type: 'text',
      title: 'Sync protocol',
      content: 'Operations merge by clock. See merge_ops.',
    })
    await writeRepository(STORY, {
      title: 'server',
      source: { from: 'github', name: 'acme/sync', commit: '3f2a9c1', imported: 1 },
      files: [
        { path: 'src/sync/merge.py', text: MERGE, size: MERGE.length },
        { path: 'src/sync/clock.py', text: 'def clock(op):\n    return op.at\n', size: 30 },
        { path: 'src/big.ts', text: numbered(3000), size: 1 },
        { path: 'README.md', text: '# Sync server\n\nMerges operations.\n', size: 30 },
      ],
    })
  })

  describe('list_documents', () => {
    it('lists a repository from above as one line, however deep the listing goes', async () => {
      const listing = await executeListDocuments({}, context)

      expect(String(listing).split('\n')).toEqual([
        'Design/',
        expect.stringMatching(/^Design\/Sync protocol — \d+ words$/),
        'server/ — repository acme/sync at 3f2a9c1, 4 files, not listed',
      ])
    })

    it("lists a repository's own path, its files in lines", async () => {
      const listing = await executeListDocuments({ path: 'server' }, context)

      expect(listing).toContain('server/src/sync/merge.py — code, 6 lines')
      expect(listing).toContain('server/src/big.ts — code, 3,000 lines')
      expect(listing).toContain('server/README.md — code, 3 lines')
    })
  })

  describe('read_document', () => {
    it('reads a short source file whole, with its line numbers', async () => {
      const result = await executeReadDocument({ path: 'server/src/sync/clock.py' }, context)

      expect(result).toMatchObject({
        path: 'server/src/sync/clock.py',
        type: 'file',
        language: 'Python',
        lines: 2,
        content: '1\tdef clock(op):\n2\t    return op.at',
      })
      expect(result).not.toHaveProperty('words')
      expect(result).not.toHaveProperty('line')
    })

    it('makes no sections of comments that start with #', async () => {
      const result = await executeReadDocument({ path: 'server/src/sync/merge.py' }, context)

      expect(result).not.toHaveProperty('sections')
      expect(result.content).toContain('5\t    # Later clocks win.')
    })

    it('reads the lines asked for, numbered to line up', async () => {
      const result = await executeReadDocument(
        { path: 'server/src/big.ts', line: 98, until: 101 },
        context
      )

      expect(result).toMatchObject({ line: 98, until: 101 })
      expect(result.content).toBe(
        [
          ' 98\tconst line98 = 98',
          ' 99\tconst line99 = 99',
          '100\tconst line100 = 100',
          '101\tconst line101 = 101',
        ].join('\n')
      )
      expect(result).not.toHaveProperty('next')
    })

    it('reads a long file as far as one read goes, with the line to go on from', async () => {
      const first = await executeReadDocument({ path: 'server/src/big.ts' }, context)
      expect(first.line).toBe(1)
      expect(first.next).toBeGreaterThan(1000)
      expect(first.until).toBe(first.next - 1)

      const second = await executeReadDocument(
        { path: 'server/src/big.ts', line: first.next },
        context
      )
      expect(second.content.startsWith(`${first.next}\tconst line${first.next} =`)).toBe(true)
    })

    it('takes a `from`, which a source file has no offsets for, as the first line', async () => {
      const result = await executeReadDocument(
        { path: 'server/src/big.ts', from: 940, until: 941 },
        context
      )

      expect(result).toMatchObject({ line: 940, until: 941 })
      expect(result.content).toBe('940\tconst line940 = 940\n941\tconst line941 = 941')
    })

    it('says so when a line is past the end', async () => {
      const result = await executeReadDocument(
        { path: 'server/src/sync/clock.py', line: 9 },
        context
      )
      expect(result).toEqual({
        error: '"server/src/sync/clock.py" has 2 lines; line 9 is past the end.',
      })
    })

    it('cuts a line too long to be worth reading whole', async () => {
      store.updateDocument(
        /** @type {string} */ (
          [...store.documents.values()].find(document => document.title === 'clock.py')?.id
        ),
        { content: `const data = "${'x'.repeat(5000)}"\n` }
      )
      const result = await executeReadDocument({ path: 'server/src/sync/clock.py' }, context)

      expect(result.content.length).toBeLessThan(2100)
      expect(result.content).toMatch(/… \(3,015 more characters\)$/)
    })
  })

  it('describes a source file without sections', async () => {
    const result = await executeDescribeDocument({ path: 'server/src/sync/merge.py' }, context)

    expect(result).toMatchObject({ lines: 6, language: 'Python' })
    expect(result).not.toHaveProperty('sections')
    expect(result.note).toMatch(/by line/)
  })

  describe('search_documents', () => {
    it('finds code by the lines that say it, beside prose by its passages', async () => {
      const { results } = await executeSearchDocuments({ query: 'merge_ops' }, context)

      const code = results.find(hit => hit.path === 'server/src/sync/merge.py')
      expect(code).toMatchObject({
        matches: 1,
        lines: 6,
        hits: [{ line: 4, text: 'def merge_ops(local, remote):' }],
      })
      expect(code).not.toHaveProperty('passages')
      const prose = results.find(hit => hit.path === 'Design/Sync protocol')
      expect(prose?.passages?.[0]?.text).toContain('merge_ops')
    })

    it('keeps to a folder, or to one document, when given a path', async () => {
      const inRepository = await executeSearchDocuments({ query: 'merge', path: 'server' }, context)
      expect(inRepository.results.map(hit => hit.path).sort()).toEqual([
        'server/README.md',
        'server/src/sync/merge.py',
      ])

      const inOne = await executeSearchDocuments(
        { query: 'clock', path: '/server/src/sync/clock.py' },
        context
      )
      expect(inOne.results.map(hit => hit.path)).toEqual(['server/src/sync/clock.py'])
    })

    it('says when there is nothing at the path to search in', async () => {
      expect(await executeSearchDocuments({ query: 'x', path: 'client' }, context)).toEqual({
        error: 'Nothing at "client" to search in. list_documents shows the folders that exist.',
      })
    })
  })
})

describe('a read of lines, still in view', () => {
  const turn = args => ({
    id: 'm1',
    role: 'assistant',
    content: '',
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
                arguments: JSON.stringify({ path: 'a.ts', ...args }),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'c1',
          content: '{}',
          _document: 'd1',
          _path: 'a.ts',
          _hash: textHash('x'),
        },
      ],
    },
  })

  it('is the same read only for the same lines', () => {
    const chat = [turn({ line: 40, until: 80 })]
    expect(readInView(chat, 'd1', { line: 40, until: 80 }, textHash('x'))).toBe(true)
    expect(readInView(chat, 'd1', { line: 40 }, textHash('x'))).toBe(false)
    expect(readInView(chat, 'd1', { line: 81 }, textHash('x'))).toBe(false)
  })

  it('takes line 1 for the top, the same as not saying', () => {
    expect(readInView([turn({})], 'd1', { line: 1 }, textHash('x'))).toBe(true)
  })
})
