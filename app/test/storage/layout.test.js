// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { layoutProject, wantedTexts, STORY_FILE } from '@/storage/layout.js'
import { readFrontmatter } from '@/storage/frontmatter.js'
import { memoryDisk } from './memoryDisk.js'
import {
  ROOT,
  SCHEMA,
  STORY,
  sample,
  doc,
  folder,
  asRead,
  byIdSorted,
  writeFresh,
  readBack,
  story,
} from './project.js'

/** @param {Map<string, import('@/storage/layout.js').Entry>} entries */
const paths = entries => Object.fromEntries([...entries].map(([id, entry]) => [id, entry.path]))

describe('where a project’s documents go', () => {
  it('puts each where its folder is, named from its title, numbered in an ordered folder', () => {
    expect(paths(layoutProject(sample(), ROOT))).toEqual({
      [ROOT]: '',
      manuscript: 'Manuscript',
      act1: 'Manuscript/01 - Act 1',
      ch1: 'Manuscript/01 - Act 1/01 - Chapter 1.md',
      ch2: 'Manuscript/01 - Act 1/02 - Chapter 2.md',
      notes: 'Notes',
      elara: 'Notes/Elara.md',
      pdf: 'Notes/Rulebook.pdf',
      repo: 'Notes/tool',
      src: 'Notes/tool/src',
      main: 'Notes/tool/src/main.js',
      readme: 'Notes/tool/README.md',
    })
  })

  it('says what kind of thing each is on disk', () => {
    const kinds = Object.fromEntries(
      [...layoutProject(sample(), ROOT)].map(([id, entry]) => [id, entry.kind])
    )
    expect(kinds).toMatchObject({
      [ROOT]: 'root',
      manuscript: 'folder',
      ch1: 'text',
      pdf: 'file',
      repo: 'repository',
      src: 'repoFolder',
      main: 'repoFile',
    })
  })

  it('numbers by the order the folder keeps, widening past ninety-nine', () => {
    const children = Array.from({ length: 100 }, (_, at) =>
      doc(`c${at}`, ROOT, { title: `Part ${at}`, order: 99 - at })
    )
    const entries = layoutProject([folder(ROOT, STORY, { ordered: true }), ...children], ROOT)
    expect(entries.get('c99')?.path).toBe('001 - Part 99.md')
    expect(entries.get('c0')?.path).toBe('100 - Part 0.md')
  })

  it('gives a name in use to the first the folder shows, and (2) to the next', () => {
    const entries = layoutProject(
      [
        folder(ROOT, STORY),
        doc('b', ROOT, { title: 'a/b' }),
        doc('a', ROOT, { title: 'a:b' }),
        folder('f', ROOT, { title: 'Notes.md' }),
        doc('n', ROOT, { title: 'notes' }),
      ],
      ROOT
    )
    expect(paths(entries)).toMatchObject({
      a: 'a-b.md',
      b: 'a-b (2).md',
      n: 'notes.md',
      f: 'Notes.md (2)',
    })
  })

  it('gives a name and a number to what is in the folder before what is in the trash', () => {
    const entries = layoutProject(
      [
        folder(ROOT, STORY, { ordered: true }),
        doc('old', ROOT, { title: 'Chapter', order: 0, trashed: 1000 }),
        doc('new', ROOT, { title: 'Chapter', order: 1 }),
        doc('next', ROOT, { title: 'Next', order: 2 }),
      ],
      ROOT
    )
    expect(paths(entries)).toMatchObject({
      new: '01 - Chapter.md',
      next: '02 - Next.md',
      old: '03 - Chapter.md',
    })
  })

  it('writes when a document went to the trash, and reads it back', () => {
    const disk = memoryDisk()
    const rows = sample().map(row =>
      row.id === 'elara' ? { ...row, trashed: 1700000000000 } : row
    )
    writeFresh(disk, rows)

    const read = readBack(disk)

    expect(read.documents.find(row => row.id === 'elara')?.trashed).toBe(1700000000000)
    expect(disk.files.get('Notes/Elara.md')).toContain('trashed: 2023-11-14')
  })

  it('keeps clear of names in use by what is not a document', () => {
    const entries = layoutProject([folder(ROOT, STORY), doc('a', ROOT, { title: 'Draft' })], ROOT, [
      'Draft.md',
      '.inksprite/story.json',
    ])
    expect(entries.get('a')?.path).toBe('Draft (2).md')
  })

  it('puts at the top what has no folder in the project to go in', () => {
    const entries = layoutProject(
      [
        folder(ROOT, STORY),
        doc('lost', 'gone'),
        folder('x', 'y', { title: 'X' }),
        folder('y', 'x', { title: 'Y' }),
      ],
      ROOT
    )
    expect(paths(entries)).toMatchObject({ lost: 'lost.md', x: 'X', y: 'Y' })
  })
})

describe('a document that holds others', () => {
  /** The sample, with a chapter holding its scenes and a portrait holding a card's fields. */
  const holding = () => [
    ...sample(),
    doc('arrival', 'ch1', { title: 'Arrival', content: 'She came by the river.', order: 0 }),
    doc('leaving', 'ch1', { title: 'Leaving', content: 'And went by the road.', order: 1 }),
    doc('portrait', 'notes', {
      type: 'file',
      title: 'Wren',
      mime: 'image/png',
      size: 10,
      content: '',
      kind: 'portrait',
    }),
    doc('description', 'portrait', { title: 'Description', content: 'Quick and quiet.' }),
    doc('namesake', 'portrait', { title: 'Wren', content: 'Named as the picture is.' }),
  ]

  it('is a directory of its name, its own file in it under that name', () => {
    const entries = layoutProject(holding(), ROOT)

    expect(entries.get('ch1')).toEqual({
      id: 'ch1',
      kind: 'text',
      path: 'Manuscript/01 - Act 1/01 - Chapter 1/01 - Chapter 1.md',
      dir: 'Manuscript/01 - Act 1/01 - Chapter 1',
    })
    expect(entries.get('portrait')).toEqual({
      id: 'portrait',
      kind: 'file',
      path: 'Notes/Wren/Wren.png',
      dir: 'Notes/Wren',
    })
    expect(paths(entries)).toMatchObject({
      arrival: 'Manuscript/01 - Act 1/01 - Chapter 1/Arrival.md',
      leaving: 'Manuscript/01 - Act 1/01 - Chapter 1/Leaving.md',
      description: 'Notes/Wren/Description.md',
      // Its stem is the portrait's own, whatever the extension.
      namesake: 'Notes/Wren/Wren (2).md',
      elara: 'Notes/Elara.md',
    })
  })

  it('numbers what it holds when it is kept in order', () => {
    const rows = holding().map(row => (row.id === 'ch1' ? { ...row, ordered: true } : row))
    expect(paths(layoutProject(rows, ROOT))).toMatchObject({
      arrival: 'Manuscript/01 - Act 1/01 - Chapter 1/01 - Arrival.md',
      leaving: 'Manuscript/01 - Act 1/01 - Chapter 1/02 - Leaving.md',
    })
  })

  it('reads back as the rows it was written from, kept in order and all', () => {
    const rows = holding().map(row => (row.id === 'ch1' ? { ...row, ordered: true } : row))
    const disk = memoryDisk()
    const entries = writeFresh(disk, rows)

    const read = readBack(disk)

    expect(byIdSorted(read.documents)).toEqual(asRead(rows))
    expect(read.entries).toEqual(entries)
    expect(read.adopted).toEqual([])
    expect(read.unknown).toEqual([])
    expect(disk.list().filter(path => path.startsWith('Notes/Wren/'))).toEqual([
      'Notes/Wren/.Wren.png.md',
      'Notes/Wren/Description.md',
      'Notes/Wren/Wren (2).md',
      'Notes/Wren/Wren.png',
    ])
    expect(readFrontmatter(disk.read(entries.get('ch1')?.path || '') || '').fields).toMatchObject({
      ordered: true,
    })
  })

  it('keeps one whose bytes are gone, and what it holds', () => {
    const disk = memoryDisk()
    writeFresh(disk, holding())
    disk.trash('Notes/Wren/Wren.png')

    const read = readBack(disk)

    expect(read.entries.get('portrait')).toMatchObject({ kind: 'file', missing: true })
    expect(read.documents.find(d => d.id === 'description')?.parentId).toBe('portrait')
  })

  it('is left at the top when it is a file of a repository', () => {
    const entries = layoutProject([...sample(), doc('stray', 'main', { title: 'Stray' })], ROOT)
    expect(entries.get('main')).toEqual({
      id: 'main',
      kind: 'repoFile',
      path: 'Notes/tool/src/main.js',
      repository: 'repo',
    })
    expect(entries.get('stray')?.path).toBe('Stray.md')
  })
})

describe('a project written and read back', () => {
  it('is the rows it was written from', () => {
    const disk = memoryDisk()
    const entries = writeFresh(disk, sample())

    const read = readBack(disk)

    expect(byIdSorted(read.documents)).toEqual(asRead(sample()))
    expect(read.entries).toEqual(entries)
    expect(read.story).toEqual(story())
    expect(read.schema).toBe(SCHEMA)
    expect(read.adopted).toEqual([])
    expect(read.unknown).toEqual([])
  })

  it('writes what a writer would want to open elsewhere', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())

    expect(disk.list()).toEqual([
      '.folder.md',
      STORY_FILE,
      'Manuscript/.folder.md',
      'Manuscript/01 - Act 1/.folder.md',
      'Manuscript/01 - Act 1/01 - Chapter 1.md',
      'Manuscript/01 - Act 1/02 - Chapter 2.md',
      'Notes/.Rulebook.pdf.md',
      'Notes/.folder.md',
      'Notes/Elara.md',
      'Notes/Rulebook.pdf',
      'Notes/tool/.repository.json',
      'Notes/tool/README.md',
      'Notes/tool/src/main.js',
    ])
    expect(disk.read('Manuscript/01 - Act 1/02 - Chapter 2.md')).toBe(
      [
        '---',
        'id: ch2',
        'title: Chapter 2',
        "summary: 'Elara: finds the door.'",
        'created: 2026-10-10T09:30:00.123Z',
        'updated: 2026-10-10T09:30:00.123Z',
        '---',
        '',
        '## A heading',
        '',
        'And *more*.',
      ].join('\n')
    )
    expect(disk.read('Notes/tool/src/main.js')).toBe('console.log("hi")\n')
  })

  it('reads the text of every document and leaves the bytes of imported files', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())

    const wanted = wantedTexts(disk.list())

    expect(wanted).not.toContain('Notes/Rulebook.pdf')
    expect(wanted).toContain('Notes/.Rulebook.pdf.md')
    expect(wanted).toContain('Notes/tool/src/main.js')
  })

  it('keeps any field a row has, and keeps text that looks like frontmatter', () => {
    const documents = [
      folder(ROOT, STORY, { title: 'My Novel' }),
      doc('odd', ROOT, {
        title: 'yes',
        content: '---\nnot: frontmatter\n---\n\nStill the body.\n',
        summary: 'line one\nline two',
        convertedFrom: 'pdf',
        plain: true,
        // A field nothing knows about yet.
        mood: { colour: 'blue', levels: [1, 2] },
      }),
    ]
    const disk = memoryDisk()
    writeFresh(disk, documents)

    expect(byIdSorted(readBack(disk).documents)).toEqual(asRead(documents))
  })

  it("keeps a document's comment threads in its frontmatter, lines and all", () => {
    const documents = [
      folder(ROOT, STORY, { title: 'My Novel' }),
      doc('ch', ROOT, {
        title: 'Chapter',
        content: 'The {==ferry==}{>>cabcd1<<} left.\n',
        comments: {
          cabcd1: {
            status: 'open',
            quote: 'ferry',
            before: 'The ',
            after: ' left.',
            posts: [
              { author: 'writer', text: 'Which one?\n- the old one: no', created: 1760000000000 },
              {
                author: 'model',
                text: "The night ferry: it's the one in chapter 2.",
                created: 1760000001000,
              },
            ],
          },
        },
      }),
    ]
    const disk = memoryDisk()
    writeFresh(disk, documents)

    expect(byIdSorted(readBack(disk).documents)).toEqual(asRead(documents))
  })

  it('takes a file renamed somewhere else as retitled', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    disk.move('Notes/Elara.md', 'Notes/Elara Voss.md')
    disk.move('Manuscript/01 - Act 1/02 - Chapter 2.md', 'Manuscript/01 - Act 1/02 - The Door.md')

    const read = readBack(disk)
    const titleOf = (/** @type {string} */ id) => read.documents.find(d => d.id === id)?.title

    expect(titleOf('elara')).toBe('Elara Voss')
    expect(titleOf('ch2')).toBe('The Door')
    expect(titleOf('ch1')).toBe('Chapter 1')
  })

  it('keeps a title whose characters no file can have', () => {
    const documents = [
      folder(ROOT, STORY, { title: 'My Novel' }),
      doc('q', ROOT, { title: 'Why? Because: reasons' }),
    ]
    const disk = memoryDisk()
    writeFresh(disk, documents)

    expect(disk.list()).toContain('Why- Because- reasons.md')
    expect(readBack(disk).documents.find(d => d.id === 'q')?.title).toBe('Why? Because: reasons')
  })

  it('orders an ordered folder by its prefixes, and a file added without one last', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    disk.write('Manuscript/01 - Act 1/Interlude.md', 'Between.')
    disk.move('Manuscript/01 - Act 1/01 - Chapter 1.md', 'Manuscript/01 - Act 1/03 - Chapter 1.md')

    const read = readBack(disk)
    const inAct = read.documents
      .filter(d => d.parentId === 'act1')
      .sort((a, b) => a.order - b.order)
      .map(d => d.title)

    expect(inAct).toEqual(['Chapter 2', 'Chapter 1', 'Interlude'])
  })

  it('makes a document of a markdown file with no id, and says it wants writing', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    disk.write('Notes/Idea.md', 'Just a thought.')
    disk.write('Notes/Broken.md', '---\nid: [unclosed\n---\n\nText.')

    const read = readBack(disk)
    const idea = read.documents.find(d => d.title === 'Idea')
    const broken = read.documents.find(d => d.title === 'Broken')

    expect(idea).toMatchObject({ parentId: 'notes', content: 'Just a thought.', created: 99 })
    expect(broken?.content).toBe('---\nid: [unclosed\n---\n\nText.')
    expect(read.adopted.sort()).toEqual([idea?.id, broken?.id].sort())
  })

  it('makes a copy made somewhere else a document of its own', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    disk.write('Notes/Elara copy.md', /** @type {string} */ (disk.read('Notes/Elara.md')))

    const read = readBack(disk)
    const elaras = read.documents.filter(d => d.content === 'Tall.')

    expect(elaras).toHaveLength(2)
    expect(new Set(elaras.map(d => d.id)).size).toBe(2)
    expect(read.adopted).toHaveLength(1)
  })

  it('leaves alone what is not a document, and says what it left', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    disk.write('Notes/photo.jpg', 'pixels')
    disk.write('Notes/.DS_Store', 'finder')
    disk.write('Loose/thing.md', 'in a folder with no .folder.md')
    disk.write('Notes/tool/extra.txt', 'not in the repository’s list')

    const read = readBack(disk)

    expect(read.unknown.sort()).toEqual(
      ['Loose/thing.md', 'Notes/photo.jpg', 'Notes/tool/extra.txt'].sort()
    )
    expect(read.documents).toHaveLength(sample().length)
  })

  it('keeps an imported file whose bytes are gone, and says so', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    disk.trash('Notes/Rulebook.pdf')

    const read = readBack(disk)

    expect(read.documents.find(d => d.id === 'pdf')?.content).toBe('Rules, page one.')
    expect(read.entries.get('pdf')).toMatchObject({ kind: 'file', missing: true })
  })

  it('reads a narration back onto its document', () => {
    const speakers = [{ text: 'The door had been there all along.', index: 0, voiceId: 'voice_1' }]
    const documents = sample().map(d => (d.id === 'ch1' ? { ...d, speakers } : d))
    const disk = memoryDisk()
    writeFresh(disk, documents)

    expect(disk.list()).toContain('.inksprite/narration/ch1.json')
    const front = readFrontmatter(
      /** @type {string} */ (disk.read('Manuscript/01 - Act 1/01 - Chapter 1.md'))
    )
    expect(front.fields).not.toHaveProperty('speakers')
    expect(readBack(disk).documents.find(d => d.id === 'ch1')?.speakers).toEqual(speakers)
  })

  it("reads a digest back onto its document, and onto the project's root", () => {
    const digest = {
      line: 'Who Elara is.',
      text: 'Her history, and where she lives.',
      of: 'x',
      made: 1,
    }
    const whole = {
      line: 'A novel and its notes.',
      text: 'The manuscript, and notes.',
      of: 'y',
      made: 2,
    }
    const documents = sample().map(d =>
      d.id === 'elara' ? { ...d, digest } : d.id === ROOT ? { ...d, digest: whole } : d
    )
    const disk = memoryDisk()
    writeFresh(disk, documents)

    expect(disk.list()).toEqual(
      expect.arrayContaining(['.inksprite/digests/elara.json', `.inksprite/digests/${ROOT}.json`])
    )
    const front = readFrontmatter(/** @type {string} */ (disk.read('Notes/Elara.md')))
    expect(front.fields).not.toHaveProperty('digest')
    const read = readBack(disk)
    expect(read.documents.find(d => d.id === 'elara')?.digest).toEqual(digest)
    expect(read.documents.find(d => d.id === ROOT)?.digest).toEqual(whole)
    expect(read.entries.get(ROOT)?.digest).toBe(true)
  })

  it('reads no digest from a file that holds none', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    disk.write('.inksprite/digests/elara.json', '{"line": 3}\n')
    disk.write('.inksprite/digests/ch1.json', 'not json')

    const read = readBack(disk)

    expect(read.documents.find(d => d.id === 'elara')).not.toHaveProperty('digest')
    expect(read.documents.find(d => d.id === 'ch1')).not.toHaveProperty('digest')
  })

  it('brings back at the top what a move had out of the way when it stopped', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    disk.move('Notes/Elara.md', '.inksprite/moving/elara/Elara.md')

    const read = readBack(disk)

    expect(read.documents.find(d => d.id === 'elara')?.parentId).toBe(ROOT)
    expect(read.entries.get('elara')?.path).toBe('.inksprite/moving/elara/Elara.md')
  })

  it('is no project without its story file', () => {
    const disk = memoryDisk()
    writeFresh(disk, sample())
    disk.trash(STORY_FILE)
    expect(() => readBack(disk)).toThrow('No project there')
  })
})
