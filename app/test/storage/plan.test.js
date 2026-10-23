// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { layoutProject } from '@/storage/layout.js'
import { planProject } from '@/storage/plan.js'
import { random, anyChange } from './changes.js'
import { memoryDisk } from './memoryDisk.js'
import {
  ROOT,
  STORY,
  sample,
  doc,
  folder,
  asRead,
  byIdSorted,
  lookup,
  writeFresh,
  readBack,
} from './project.js'

/** @typedef {import('@/types/models.js').Document} Document */

/**
 * The rows that differ between two sets of them, as the sync store would
 * have been told.
 *
 * @param {Document[]} before
 * @param {Document[]} after
 */
function changedBetween(before, after) {
  const was = new Map(before.map(d => [d.id, JSON.stringify(d)]))
  return after.filter(d => was.get(d.id) !== JSON.stringify(d)).map(d => d.id)
}

/**
 * Plan the change from one set of rows to the next, carry it out on the
 * disk, and check the disk reads back as the new rows.
 *
 * @param {ReturnType<typeof memoryDisk>} disk
 * @param {Document[]} before
 * @param {Document[]} after
 */
function step(disk, before, after) {
  const previous = layoutProject(before, ROOT)
  const next = layoutProject(after, ROOT)
  const ops = planProject(previous, next, lookup(after), changedBetween(before, after))
  disk.apply(ops)
  // An imported file's bytes come on their own, after its row.
  for (const entry of next.values()) {
    if (entry.kind === 'file' && !previous.has(entry.id))
      disk.write(entry.path, `bytes of ${entry.id}`)
  }
  const read = readBack(disk)
  expect(byIdSorted(read.documents)).toEqual(asRead(after))
  expect(read.entries).toEqual(next)
  expect(read.unknown).toEqual([])
  return ops
}

/**
 * @param {Document[]} documents
 * @param {string} id
 * @param {Partial<Document>} fields
 */
const change = (documents, id, fields) =>
  documents.map(d => (d.id === id ? { ...d, ...fields } : d))

/** @param {Document[]} documents @param {string[]} ids */
const without = (documents, ids) => documents.filter(d => !ids.includes(d.id))

describe('a plan for a project’s folder', () => {
  it('writes the one file whose text changed, and nothing else', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())

    const ops = step(disk, sample(), change(sample(), 'elara', { content: 'Taller.' }))

    expect(ops).toEqual([{ op: 'write', path: 'Notes/Elara.md', text: expect.any(String) }])
  })

  it('does nothing when nothing changed', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    expect(step(disk, sample(), sample())).toEqual([])
  })

  it('renames a file for a new title', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())

    const ops = step(disk, sample(), change(sample(), 'elara', { title: 'Elara Voss' }))

    expect(ops.map(op => op.op)).toEqual(['move', 'write'])
    expect(ops[0]).toEqual({ op: 'move', from: 'Notes/Elara.md', to: 'Notes/Elara Voss.md' })
  })

  it('renames a folder in one move, whatever is in it', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())

    const ops = step(disk, sample(), change(sample(), 'notes', { title: 'Lore' }))

    expect(ops).toEqual([
      { op: 'move', from: 'Notes', to: 'Lore' },
      { op: 'write', path: 'Lore/.folder.md', text: expect.any(String) },
    ])
  })

  it('moves an imported file with the row beside it', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())

    const ops = step(disk, sample(), change(sample(), 'pdf', { parentId: ROOT, order: 5 }))

    expect(ops.filter(op => op.op === 'move')).toEqual([
      { op: 'move', from: 'Notes/Rulebook.pdf', to: 'Rulebook.pdf' },
      { op: 'move', from: 'Notes/.Rulebook.pdf.md', to: '.Rulebook.pdf.md' },
    ])
    expect(disk.read('Rulebook.pdf')).toBe('bytes of pdf')
  })

  it('renumbers an ordered folder when its order changes', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    const swapped = change(change(sample(), 'ch1', { order: 1 }), 'ch2', { order: 0 })

    step(disk, sample(), swapped)

    expect(disk.list()).toContain('Manuscript/01 - Act 1/01 - Chapter 2.md')
    expect(disk.list()).toContain('Manuscript/01 - Act 1/02 - Chapter 1.md')
  })

  it('trades two names through the way out', () => {
    const disk = memoryDisk()
    const before = [
      folder(ROOT, STORY, { title: 'My Novel' }),
      doc('x', ROOT, { title: 'First', content: 'x' }),
      doc('y', ROOT, { title: 'Second', content: 'y' }),
    ]
    writeFresh(disk, before)

    const ops = step(
      disk,
      before,
      change(change(before, 'x', { title: 'Second' }), 'y', { title: 'First' })
    )

    expect(ops.some(op => op.op === 'move' && op.to.startsWith('.inksprite/moving/'))).toBe(true)
    expect(disk.list().some(path => path.startsWith('.inksprite/moving/'))).toBe(false)
  })

  it('trashes a folder whole', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())

    const ops = step(disk, sample(), without(sample(), ['act1', 'ch1', 'ch2']))

    expect(ops).toEqual([{ op: 'trash', path: 'Manuscript/01 - Act 1' }])
  })

  it('moves out what is kept before trashing the folder it was in', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    const after = change(without(sample(), ['act1', 'ch1']), 'ch2', { parentId: 'manuscript' })

    const ops = step(disk, sample(), after)

    expect(ops.findIndex(op => op.op === 'move')).toBeLessThan(
      ops.findIndex(op => op.op === 'trash')
    )
    expect(disk.read('Manuscript/01 - Chapter 2.md')).toContain('And *more*.')
  })

  it('gives a gone document’s name to the one that takes it', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    const after = change(without(sample(), ['elara']), 'pdf', {
      type: 'text',
      title: 'Elara',
      plain: undefined,
    })

    step(disk, sample(), after)

    expect(disk.trashed.some(path => path.endsWith('Elara.md'))).toBe(true)
  })

  it('makes a new folder where a gone one was, with what is kept moved into it', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    const after = [
      ...without(sample(), ['notes', 'pdf', 'repo', 'src', 'main', 'readme']).map(d =>
        d.id === 'elara' ? { ...d, parentId: 'notes2' } : d
      ),
      folder('notes2', ROOT, { title: 'Notes', order: 1 }),
    ]

    step(disk, sample(), after)
  })

  it('moves a folder into a new one that takes its place', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    const after = [
      ...change(sample(), 'notes', { parentId: 'wrap' }),
      folder('wrap', ROOT, { title: 'Notes', order: 1 }),
    ]

    step(disk, sample(), after)

    expect(disk.list()).toContain('Notes/Notes/Elara.md')
  })

  it('changes only the case of a name on a disk that ignores case', () => {
    const disk = memoryDisk({ caseInsensitive: true })
    writeFresh(disk, sample())

    const ops = step(disk, sample(), change(sample(), 'elara', { title: 'ELARA' }))

    expect(ops[0]).toEqual({ op: 'move', from: 'Notes/Elara.md', to: 'Notes/ELARA.md' })
  })

  it('moves a repository whole, and writes its list again when something in it changes', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())

    const moved = change(sample(), 'repo', { parentId: ROOT, order: 9 })
    expect(step(disk, sample(), moved).filter(op => op.op === 'move')).toEqual([
      { op: 'move', from: 'Notes/tool', to: 'tool' },
    ])

    const refreshed = [
      ...without(change(moved, 'main', { content: 'console.log("bye")\n' }), ['readme']),
      doc('lib', 'src', { type: 'file', title: 'lib.js', mime: 'text/javascript', content: '1\n' }),
    ]
    const ops = step(disk, moved, refreshed)

    expect(
      ops
        .map(op =>
          op.op === 'write' ? `write ${op.path}` : `${op.op} ${'path' in op ? op.path : ''}`
        )
        .sort()
    ).toEqual(
      [
        'trash tool/README.md',
        'write tool/src/main.js',
        'write tool/src/lib.js',
        'write tool/.repository.json',
      ].sort()
    )
  })

  it('writes and trashes a document’s narration as it comes and goes', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    const speakers = [{ text: 'Tall.', index: 0, voiceId: 'voice_1' }]

    const added = change(sample(), 'elara', { speakers })
    expect(step(disk, sample(), added)).toContainEqual({
      op: 'write',
      path: '.inksprite/narration/elara.json',
      text: expect.any(String),
    })

    const cleared = change(added, 'elara', { speakers: undefined })
    expect(step(disk, added, cleared)).toContainEqual({
      op: 'trash',
      path: '.inksprite/narration/elara.json',
    })
  })

  it('writes and trashes a digest as it comes and goes, the root’s too', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    const digest = { line: 'Who Elara is.', text: 'Her history.', of: 'x', made: 1 }

    const added = change(change(sample(), 'elara', { digest }), ROOT, { digest })
    const written = step(disk, sample(), added)
    for (const id of ['elara', ROOT]) {
      expect(written).toContainEqual({
        op: 'write',
        path: `.inksprite/digests/${id}.json`,
        text: `${JSON.stringify(digest)}\n`,
      })
    }

    const cleared = change(added, 'elara', { digest: undefined })
    expect(step(disk, added, cleared)).toContainEqual({
      op: 'trash',
      path: '.inksprite/digests/elara.json',
    })
  })
})

describe('plans for any run of changes', () => {
  for (const caseInsensitive of [false, true]) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      it(`leave the folder reading back as the rows (seed ${seed}${caseInsensitive ? ', any case' : ''})`, () => {
        const next = random(seed)
        const disk = memoryDisk({ caseInsensitive })
        let documents = sample()
        writeFresh(disk, documents)
        for (let round = 0; round < 60; round++) {
          let after = documents
          // A few changes at once, as half a second of work saves together.
          const batch = 1 + Math.floor(next() * 3)
          for (let n = 0; n < batch; n++) after = anyChange(after, next, round * 10 + n)
          step(disk, documents, after)
          documents = after
        }
        expect(disk.list().some(path => path.startsWith('.inksprite/moving/'))).toBe(false)
      })
    }
  }
})
