// @vitest-environment node
/* global Blob, TextEncoder */
import 'fake-indexeddb/auto'
import { describe, it, expect, beforeEach } from 'vitest'
import { libraryStorage } from '@/storage/library.js'
import { dexieStorage } from '@/storage/dexie.js'
import { memoryLibrary } from './memoryLibrary.js'
import { random, anyChange, TITLES } from './changes.js'
import { STORY, ROOT, story, sample, doc, folder, asRead, byIdSorted } from './project.js'

/** @typedef {import('@/types/models.js').Change} Change */

/** @param {string} table @param {any} row @returns {Change} */
const put = (table, row) => ({ entityType: table, id: row.id, op: 'put', data: row, timestamp: 0 })

/** @param {string} table @param {string} id @returns {Change} */
const gone = (table, id) => ({ entityType: table, id, op: 'delete', data: null, timestamp: 0 })

/** @param {any} row */
const withoutVersion = ({ version: _version, ...rest }) => rest

const chat = (/** @type {string} */ id, fields = {}) => ({
  id,
  storyId: STORY,
  title: id,
  titleSet: true,
  lastMessageAt: 1,
  version: 1,
  created: 1,
  updated: 1,
  ...fields,
})

const message = (
  /** @type {string} */ id,
  /** @type {string} */ chatId,
  created = 1,
  content = id
) => ({
  id,
  chatId,
  role: 'user',
  content,
  created,
})

/** A library with the sample project written into it the way the stores would. */
async function withProject() {
  const library = memoryLibrary()
  const storage = libraryStorage(library.disk)
  await storage.stories()
  await storage.putFileBytes(
    'pdf',
    STORY,
    new Blob(['%PDF-1.7 bytes'], { type: 'application/pdf' })
  )
  await storage.write('stories', [put('stories', story())])
  await storage.write(
    'documents',
    sample().map(row => put('documents', row))
  )
  return { ...library, storage }
}

/** The same library, as the app finds it when it opens again. */
const reopened = (/** @type {ReturnType<typeof memoryLibrary>} */ library) =>
  libraryStorage(library.disk)

beforeEach(async () => {
  await dexieStorage.replaceAll({})
})

describe('the library as storage', () => {
  it('writes a project once its story and its root have come, and reads it back', async () => {
    const library = await withProject()

    expect(library.outside.list()).toEqual(
      expect.arrayContaining([
        'My Novel/.inksprite/story.json',
        'My Novel/.folder.md',
        'My Novel/Notes/Rulebook.pdf',
        'My Novel/Notes/.Rulebook.pdf.md',
      ])
    )
    expect(library.outside.list().some(path => path.startsWith('.inksprite-new'))).toBe(false)

    const again = reopened(library)
    expect(await again.stories()).toEqual([withoutVersion(story())])
    expect((await again.roots([STORY, 'story_none'])).map(root => root.title)).toEqual(['My Novel'])
    expect(byIdSorted(await again.documents(STORY))).toEqual(asRead(sample()))
    expect(await (await again.fileBytes('pdf'))?.text()).toBe('%PDF-1.7 bytes')
  })

  it('says where an imported file’s bytes are in the library, for Python to read', async () => {
    const library = await withProject()
    expect(await library.storage.filePath('pdf')).toBe('My Novel/Notes/Rulebook.pdf')

    const again = reopened(library)
    await again.documents(STORY)
    expect(await again.filePath('pdf')).toBe('My Novel/Notes/Rulebook.pdf')
    expect(await again.filePath('ch1')).toBeNull()
    expect(await again.filePath('none')).toBeNull()
  })

  it('has a file’s bytes once they come, that weren’t there when the project was read', async () => {
    const library = await withProject()
    library.files.delete('My Novel/Notes/Rulebook.pdf')

    const again = reopened(library)
    await again.documents(STORY)
    expect(await again.filePath('pdf')).toBeNull()
    expect(await again.fileBytes('pdf')).toBeNull()

    await again.putFileBytes('pdf', STORY, new Blob(['fetched'], { type: 'application/pdf' }))
    expect(await again.filePath('pdf')).toBe('My Novel/Notes/Rulebook.pdf')
    expect(await (await again.fileBytes('pdf'))?.text()).toBe('fetched')
  })

  it('moves a file into a directory of its name when it gets what it holds, bytes and all', async () => {
    const library = await withProject()
    const copy = doc('copy', 'pdf', { title: 'Rulebook (Markdown)', content: '# Rules' })
    await library.storage.write('documents', [put('documents', copy)])

    expect(await library.storage.filePath('pdf')).toBe('My Novel/Notes/Rulebook/Rulebook.pdf')
    expect(library.outside.list()).toEqual(
      expect.arrayContaining([
        'My Novel/Notes/Rulebook/Rulebook.pdf',
        'My Novel/Notes/Rulebook/.Rulebook.pdf.md',
        'My Novel/Notes/Rulebook/Rulebook (Markdown).md',
      ])
    )

    const again = reopened(library)
    expect(byIdSorted(await again.documents(STORY))).toEqual(asRead([...sample(), copy]))
    expect(await (await again.fileBytes('pdf'))?.text()).toBe('%PDF-1.7 bytes')
  })

  it('keeps a card that is its picture, with a folder of lore in it, as it was written', async () => {
    const library = await withProject()
    await library.storage.putFileBytes(
      'wren',
      STORY,
      new Blob(['png bytes'], { type: 'image/png' })
    )
    const card = [
      doc('wren', 'notes', {
        type: 'file',
        title: 'Wren',
        kind: 'card',
        mime: 'image/png',
        size: 9,
      }),
      doc('description', 'wren', { title: 'Description', content: 'Quick.', kind: 'description' }),
      doc('sidecar', 'wren', { title: '.card.json', content: '{}', kind: 'sidecar', hidden: true }),
      folder('lore', 'wren', { title: 'Lore', kind: 'lore' }),
      doc('harbour', 'lore', { title: 'Harbour', content: 'Tides.', kind: 'lore-entry' }),
    ]
    await library.storage.write(
      'documents',
      card.map(row => put('documents', row))
    )

    expect(await library.storage.filePath('wren')).toBe('My Novel/Notes/Wren/Wren.png')
    expect(library.outside.list()).toEqual(
      expect.arrayContaining([
        'My Novel/Notes/Wren/Wren.png',
        'My Novel/Notes/Wren/Description.md',
        'My Novel/Notes/Wren/Lore/.folder.md',
        'My Novel/Notes/Wren/Lore/Harbour.md',
      ])
    )
    const again = reopened(library)
    expect(byIdSorted(await again.documents(STORY))).toEqual(asRead([...sample(), ...card]))
    expect(await (await again.fileBytes('wren'))?.text()).toBe('png bytes')
  })

  it('writes a project whose rows come before its story', async () => {
    const library = memoryLibrary()
    const storage = libraryStorage(library.disk)
    await storage.write(
      'documents',
      sample().map(row => put('documents', row))
    )
    expect(library.outside.list()).toEqual([])

    await storage.write('stories', [put('stories', story())])

    expect(byIdSorted(await reopened(library).documents(STORY))).toEqual(asRead(sample()))
  })

  it('keeps a new project’s folder clear of what is in the library already', async () => {
    const library = memoryLibrary()
    library.outside.write('My Novel/notes.txt', 'mine')
    const storage = libraryStorage(library.disk)
    await storage.write('stories', [put('stories', story())])
    await storage.write(
      'documents',
      sample().map(row => put('documents', row))
    )

    expect(library.outside.list()).toContain('My Novel (2)/.folder.md')
    expect(library.outside.read('My Novel/notes.txt')).toBe('mine')
  })

  it('writes only the file of a document that changed', async () => {
    const library = await withProject()
    const before = library.outside.list().map(path => [path, library.files.get(path)?.mtime])
    await library.storage.documents(STORY)

    const elara = sample().find(row => row.id === 'elara')
    await library.storage.write('documents', [put('documents', { ...elara, content: 'Taller.' })])

    const after = library.outside.list().map(path => [path, library.files.get(path)?.mtime])
    const touched = after.filter(([path, mtime]) => before.find(([p]) => p === path)?.[1] !== mtime)
    expect(touched.map(([path]) => path)).toEqual(['My Novel/Notes/Elara.md'])
  })

  it('renames the project’s folder with its root', async () => {
    const library = await withProject()
    await library.storage.documents(STORY)
    const root = sample().find(row => row.id === ROOT)

    await library.storage.write('documents', [put('documents', { ...root, title: 'The Door' })])

    expect(library.outside.list().every(path => path.startsWith('The Door/'))).toBe(true)
    expect((await reopened(library).roots([STORY]))[0].title).toBe('The Door')
  })

  it('trashes a project’s folder whole when it is deleted', async () => {
    const library = await withProject()
    await library.storage.documents(STORY)

    await library.storage.write(
      'documents',
      sample().map(row => gone('documents', row.id))
    )
    await library.storage.write('stories', [gone('stories', STORY)])

    expect(library.trashed).toEqual(['My Novel'])
    expect(library.outside.list()).toEqual([])
    expect(await reopened(library).stories()).toEqual([])
  })

  it('keeps a document in the trash where it was, marked, and lets a new one take its name', async () => {
    const library = await withProject()
    await library.storage.documents(STORY)
    const elara = sample().find(row => row.id === 'elara')

    await library.storage.write('documents', [put('documents', { ...elara, trashed: 5000 })])
    expect(library.trashed).toEqual([])
    expect(library.outside.read('My Novel/Notes/Elara.md')).toContain(
      'trashed: 1970-01-01T00:00:05'
    )

    const fresh = doc('fresh', 'notes', { title: elara.title, content: 'Another.' })
    await library.storage.write('documents', [put('documents', fresh)])
    expect(library.outside.read('My Novel/Notes/Elara.md')).toContain('Another.')
    expect(library.outside.read('My Novel/Notes/Elara (2).md')).toContain('trashed:')

    const read = await reopened(library).documents(STORY)
    expect(read.find(row => row.id === 'elara')?.trashed).toBe(5000)

    await library.storage.write('documents', [gone('documents', 'elara')])
    expect(library.trashed).toEqual(['My Novel/Notes/Elara (2).md'])
  })

  it('writes an imported file’s bytes when its row comes, and trashes both with it', async () => {
    const library = await withProject()
    await library.storage.documents(STORY)
    await library.storage.putFileBytes('map', STORY, new Blob(['pixels'], { type: 'image/png' }))
    const map = doc('map', 'notes', { type: 'file', title: 'Map', mime: 'image/png', content: '' })

    await library.storage.write('documents', [put('documents', map)])
    expect(library.outside.read('My Novel/Notes/Map.png')).toBe('pixels')

    await library.storage.write('documents', [gone('documents', 'map')])
    expect(library.trashed).toEqual(['My Novel/Notes/Map.png', 'My Novel/Notes/.Map.png.md'])
  })

  it('keeps a chat’s messages, writing only the end of them as a reply comes in', async () => {
    const library = await withProject()
    await library.storage.chats(STORY)
    await library.storage.write('chats', [put('chats', chat('chat_1'))])
    await library.storage.write('messages', [
      put('messages', message('m1', 'chat_1', 1)),
      put('messages', message('m2', 'chat_1', 2, 'Th')),
    ])
    for (const content of ['The', 'The door', 'The door opened.']) {
      await library.storage.write('messages', [
        put('messages', message('m2', 'chat_1', 2, content)),
      ])
    }

    const again = reopened(library)
    expect((await again.chats(STORY)).map(withoutVersion)).toEqual([withoutVersion(chat('chat_1'))])
    expect(await again.messages('chat_1')).toEqual([
      message('m1', 'chat_1', 1),
      message('m2', 'chat_1', 2, 'The door opened.'),
    ])
  })

  it('writes a chat’s messages whole for a change further back', async () => {
    const library = await withProject()
    await library.storage.chats(STORY)
    await library.storage.write('chats', [put('chats', chat('chat_1'))])
    await library.storage.write(
      'messages',
      [1, 2, 3].map(n => put('messages', message(`m${n}`, 'chat_1', n)))
    )

    await library.storage.write('messages', [
      put('messages', message('m1', 'chat_1', 1, 'edited')),
      gone('messages', 'm2'),
    ])

    // Asked for straight away, as a chat's export does, before the project's chats.
    expect((await reopened(library).messages('chat_1')).map(m => [m.id, m.content])).toEqual([
      ['m1', 'edited'],
      ['m3', 'm3'],
    ])
  })

  it('keeps messages that come before their chat until it does', async () => {
    const library = await withProject()
    await library.storage.chats(STORY)

    await library.storage.write('messages', [put('messages', message('m1', 'chat_new', 1))])
    await library.storage.write('chats', [put('chats', chat('chat_new'))])

    const again = reopened(library)
    await again.chats(STORY)
    expect(await again.messages('chat_new')).toEqual([message('m1', 'chat_new', 1)])
  })

  it('trashes a chat’s files when it is deleted', async () => {
    const library = await withProject()
    await library.storage.chats(STORY)
    await library.storage.write('chats', [put('chats', chat('chat_1'))])
    await library.storage.write('messages', [put('messages', message('m1', 'chat_1'))])

    await library.storage.write('chats', [gone('chats', 'chat_1')])

    expect(library.trashed.sort()).toEqual([
      'My Novel/.inksprite/chats/chat_1.json',
      'My Novel/.inksprite/chats/chat_1.jsonl',
    ])
  })

  it('trashes a file changed elsewhere before writing over it, and says so', async () => {
    const library = memoryLibrary()
    /** @type {string[]} */
    const told = []
    const storage = libraryStorage(library.disk, {
      onConflict: changed => told.push(...changed.map(({ path, title }) => `${title}: ${path}`)),
    })
    await storage.write('stories', [put('stories', story())])
    await storage.write(
      'documents',
      sample().map(row => put('documents', row))
    )
    await storage.documents(STORY)
    library.outside.write('My Novel/Notes/Elara.md', 'Edited in another app.')

    const elara = sample().find(row => row.id === 'elara')
    await storage.write('documents', [put('documents', { ...elara, content: 'Edited here.' })])

    expect(told).toEqual(['Elara: My Novel/Notes/Elara.md'])
    expect(library.trash.at(-1)?.files.get('My Novel/Notes/Elara.md')).toEqual(
      new TextEncoder().encode('Edited in another app.')
    )
    expect(library.outside.read('My Novel/Notes/Elara.md')).toContain('Edited here.')
  })

  it('reads what was changed while it was closed, and writes after it as its own', async () => {
    const library = await withProject()
    await library.storage.chats(STORY)
    await library.storage.write('chats', [put('chats', chat('chat_1'))])
    await library.storage.write('messages', [
      put('messages', message('m1', 'chat_1', 1, 'What next?')),
      put('messages', message('m2', 'chat_1', 2, 'The door opens.')),
    ])

    // Edited in another app, with inksprite closed.
    const elara = 'My Novel/Notes/Elara.md'
    library.outside.write(
      elara,
      String(library.outside.read(elara)).replace('Tall.', 'Tall, and kind.')
    )
    library.outside.move('My Novel/Notes/Elara.md', 'My Novel/Notes/Elara Vance.md')
    const chatFile = 'My Novel/.inksprite/chats/chat_1.jsonl'
    library.outside.write(
      chatFile,
      String(library.outside.read(chatFile)).replace('The door opens.', 'The door stays shut.')
    )

    /** @type {string[]} */
    const told = []
    const again = libraryStorage(library.disk, {
      onConflict: changed => told.push(...changed.map(({ path }) => path)),
    })
    const read = (await again.documents(STORY)).find(row => row.id === 'elara')
    expect(read).toMatchObject({ title: 'Elara Vance', content: 'Tall, and kind.' })
    await again.chats(STORY)
    expect((await again.messages('chat_1')).map(row => row.content)).toEqual([
      'What next?',
      'The door stays shut.',
    ])

    await again.write('documents', [
      put('documents', { ...read, content: 'Tall, and kind, and late.' }),
    ])
    await again.write('messages', [put('messages', message('m3', 'chat_1', 3, 'Knock.'))])
    expect(told).toEqual([])
    expect(library.outside.read('My Novel/Notes/Elara Vance.md')).toContain('and late.')
    expect(library.outside.read(chatFile)).toContain('The door stays shut.')
    expect(library.outside.read(chatFile)).toContain('Knock.')
  })

  it('gives a markdown file found without an id one, and writes it so', async () => {
    const library = await withProject()
    library.outside.write('My Novel/Notes/Idea.md', 'Just a thought.')

    const documents = await reopened(library).documents(STORY)
    const idea = documents.find(row => row.title === 'Idea')

    expect(idea?.id).toMatch(/^doc_/)
    expect(library.outside.read('My Novel/Notes/Idea.md')).toContain(`id: ${idea?.id}`)
  })

  it('brings a project written at an older schema forward, and writes it so', async () => {
    const library = await withProject()
    const path = 'My Novel/.inksprite/story.json'
    const written = JSON.parse(/** @type {string} */ (library.outside.read(path)))
    library.outside.write(path, JSON.stringify({ ...written, schema: written.schema - 1 }))

    const documents = await reopened(library).documents(STORY)

    expect(byIdSorted(documents)).toEqual(asRead(sample()))
    expect(JSON.parse(/** @type {string} */ (library.outside.read(path))).schema).toBe(
      written.schema
    )
  })

  it('leaves alone a project written by a newer app', async () => {
    const library = await withProject()
    const path = 'My Novel/.inksprite/story.json'
    const written = JSON.parse(/** @type {string} */ (library.outside.read(path)))
    library.outside.write(path, JSON.stringify({ ...written, schema: written.schema + 1 }))

    expect(await reopened(library).stories()).toEqual([])
  })

  it('changes every chat and message asked for, in projects not opened too', async () => {
    const library = await withProject()
    await library.storage.chats(STORY)
    await library.storage.write('chats', [put('chats', chat('chat_1', { disabledTools: ['old'] }))])
    await library.storage.write('messages', [
      put('messages', { ...message('m1', 'chat_1'), metadata: { context: [] } }),
      put('messages', message('m2', 'chat_1', 2)),
    ])

    const again = reopened(library)
    expect(
      await again.updateEach('chats', row =>
        row.disabledTools ? { disabledTools: ['new'] } : null
      )
    ).toBe(1)
    expect(
      await again.updateEach('messages', row => (row.metadata?.context ? { metadata: {} } : null))
    ).toBe(1)

    const after = reopened(library)
    expect((await after.chats(STORY))[0].disabledTools).toEqual(['new'])
    expect((await after.messages('chat_1'))[0].metadata).toEqual({})
  })

  it('adds a project read from a file, all of it, under a folder of its own', async () => {
    const library = memoryLibrary()
    const storage = libraryStorage(library.disk)
    await storage.addProject({
      story: story(),
      documents: sample(),
      files: [{ id: 'pdf', storyId: STORY, blob: new Blob(['%PDF']) }],
      chats: [chat('chat_1')],
      messages: [message('m1', 'chat_1')],
    })

    const again = reopened(library)
    expect(byIdSorted(await again.documents(STORY))).toEqual(asRead(sample()))
    await again.chats(STORY)
    expect(await again.messages('chat_1')).toEqual([message('m1', 'chat_1')])
    expect(await (await again.fileBytes('pdf'))?.text()).toBe('%PDF')
  })

  it('adds a big project a batch at a time, saying how far it has got, and names it only at the end', async () => {
    const library = memoryLibrary()
    library.outside.write(`.inksprite-new-${STORY}/Left.md`, 'From a write that never finished.')
    const applied = []
    const disk = {
      ...library.disk,
      apply: async (/** @type {any[]} */ ops) => {
        applied.push(ops)
        return library.disk.apply(ops)
      },
    }
    const chapters = Array.from({ length: 120 }, (_, n) =>
      doc(`ch${n}`, ROOT, { title: `Chapter ${n}`, content: 'Words.' })
    )
    const told = []

    await libraryStorage(disk).addProject(
      {
        story: story(),
        documents: [folder(ROOT, STORY, { title: 'Long Book' }), ...chapters],
        files: [],
        chats: [],
        messages: [],
      },
      (done, total) => told.push([done, total])
    )

    expect(applied.length).toBeGreaterThan(2)
    expect(applied[0][0]).toEqual({ op: 'trash', path: `.inksprite-new-${STORY}` })
    expect(
      applied
        .slice(0, -1)
        .flat()
        .some(op => op.op === 'move')
    ).toBe(false)
    expect(applied.at(-1).at(-1)).toEqual({
      op: 'move',
      from: `.inksprite-new-${STORY}`,
      to: 'Long Book',
    })
    const total = told[0][1]
    expect(told.map(([done]) => done)).toEqual(
      [...told.map(([done]) => done)].sort((a, b) => a - b)
    )
    expect(told.at(-1)).toEqual([total, total])
    expect(library.trashed).toEqual([`.inksprite-new-${STORY}`])
    expect(library.outside.list().some(path => path.startsWith('.inksprite-new'))).toBe(false)
    expect(await reopened(library).documents(STORY)).toHaveLength(121)
  })

  it('backs up every project and restores them into another library', async () => {
    const library = await withProject()
    await library.storage.chats(STORY)
    await library.storage.write('chats', [put('chats', chat('chat_1'))])
    await library.storage.write('messages', [put('messages', message('m1', 'chat_1'))])

    const tables = await reopened(library).dump()
    expect(tables.stories).toHaveLength(1)
    expect(tables.files.map(file => file.id)).toEqual(['pdf'])

    const other = memoryLibrary()
    other.outside.write('Old/.inksprite/story.json', JSON.stringify({ id: 'story_old', schema: 1 }))
    const restored = await libraryStorage(other.disk).replaceAll(tables)

    expect(restored).toBeGreaterThan(sample().length)
    expect(other.trashed).toEqual(['Old'])
    const again = reopened(other)
    expect(byIdSorted(await again.documents(STORY))).toEqual(asRead(sample()))
  })

  it('keeps a digest out of the frontmatter, and in a backup', async () => {
    const library = await withProject()
    await library.storage.documents(STORY)
    const elara = sample().find(row => row.id === 'elara')
    const digest = { line: 'Who Elara is.', text: 'Her history.', of: 'x', made: 1 }

    await library.storage.write('documents', [put('documents', { ...elara, digest })])

    expect(library.outside.read('My Novel/Notes/Elara.md')).not.toContain('Who Elara is.')
    expect(library.outside.read('My Novel/.inksprite/digests/elara.json')).toContain(
      'Who Elara is.'
    )
    const again = reopened(library)
    expect((await again.documents(STORY)).find(row => row.id === 'elara')?.digest).toEqual(digest)
    const tables = await again.dump()
    expect(tables.documents.find(row => row.id === 'elara')?.digest).toEqual(digest)
  })

  it("keeps a document's narration in its project's folder, and finds it when reopened", async () => {
    const library = await withProject()
    await library.storage.documents(STORY)
    const clip = new TextEncoder().encode('RIFF one').buffer

    await library.storage.writeAudio(STORY, 'ch1', 'abc', clip)
    await library.storage.writeAudio(STORY, 'ch1', 'def', clip)

    expect(library.outside.read('My Novel/.inksprite/audio/ch1/abc.wav')).toBe('RIFF one')
    const again = reopened(library)
    expect(await again.audioKeys(STORY, 'ch1')).toEqual(['abc', 'def'])
    expect(new Uint8Array(await again.readAudio(STORY, 'ch1', 'abc'))).toEqual(new Uint8Array(clip))
    expect(await again.readAudio(STORY, 'ch1', 'nope')).toBeNull()
    expect(await again.audioKeys(STORY, 'ch2')).toEqual([])
    // What a project is read from leaves its narration out.
    expect(byIdSorted(await again.documents(STORY))).toEqual(asRead(sample()))
  })

  it('moves the narration with a renamed project, and leaves it out of a backup', async () => {
    const library = await withProject()
    await library.storage.documents(STORY)
    await library.storage.writeAudio(STORY, 'ch1', 'abc', new TextEncoder().encode('RIFF').buffer)
    const root = sample().find(row => row.id === ROOT)

    await library.storage.write('documents', [put('documents', { ...root, title: 'The Door' })])

    expect(await library.storage.audioKeys(STORY, 'ch1')).toEqual(['abc'])
    const tables = await reopened(library).dump()
    expect(JSON.stringify(tables)).not.toContain('RIFF')
  })

  it('deletes narration for good: clips asked for, a document gone, a project gone', async () => {
    const library = await withProject()
    await library.storage.documents(STORY)
    const clip = new TextEncoder().encode('RIFF').buffer
    for (const [id, key] of [
      ['ch1', 'a'],
      ['ch1', 'b'],
      ['ch1', 'c'],
      ['ch2', 'd'],
      ['elara', 'e'],
    ]) {
      await library.storage.writeAudio(STORY, id, key, clip)
    }

    await library.storage.removeAudio(STORY, 'ch1', ['a', 'b'])
    expect(await library.storage.audioKeys(STORY, 'ch1')).toEqual(['c'])
    await library.storage.removeAudio(STORY, 'ch1')
    expect(await library.storage.audioKeys(STORY, 'ch1')).toEqual([])

    await library.storage.write('documents', [gone('documents', 'ch2')])
    expect(await library.storage.audioKeys(STORY, 'ch2')).toEqual([])

    await library.storage.write(
      'documents',
      sample().map(row => gone('documents', row.id))
    )
    expect(library.trashed.filter(path => path.includes('audio'))).toEqual([])
    expect(library.trash.flatMap(item => [...item.files.keys()])).not.toContainEqual(
      expect.stringContaining('/audio/')
    )
  })

  it('keeps a linked document’s base in its folder, out of a backup, gone with the document', async () => {
    const library = await withProject()
    await library.storage.documents(STORY)
    const base = {
      id: 'ch1',
      storyId: STORY,
      docId: 'doc_1',
      tabId: 't.0',
      revisionId: 'rev_1',
      markdown: 'The base of it.',
      at: 1,
    }

    await library.storage.writeBase(base)

    expect(JSON.parse(library.outside.read('My Novel/.inksprite/bases/ch1.json'))).toEqual(base)
    const again = reopened(library)
    expect(await again.readBase(STORY, 'ch1')).toEqual(base)
    expect(await again.readBase(STORY, 'ch2')).toBeNull()
    expect(byIdSorted(await again.documents(STORY))).toEqual(asRead(sample()))
    expect(JSON.stringify(await again.dump())).not.toContain('The base of it.')

    // It goes to the trash with its document, the document being linked.
    const ch1 = sample().find(row => row.id === 'ch1')
    await library.storage.write('documents', [put('documents', { ...ch1, drive: { id: 'doc_1' } })])
    await library.storage.write('documents', [gone('documents', 'ch1')])
    expect(await library.storage.readBase(STORY, 'ch1')).toBeNull()
    expect(library.outside.list()).not.toContainEqual(expect.stringContaining('/bases/'))
    expect(library.trashed).toContain('My Novel/.inksprite/bases/ch1.json')

    await library.storage.writeBase({ ...base, id: 'ch2' })
    await library.storage.removeBase(STORY, 'ch2')
    expect(await library.storage.readBase(STORY, 'ch2')).toBeNull()
  })

  it('keeps no narration in IndexedDB', async () => {
    expect(dexieStorage.audioKept()).toBe(false)
    await dexieStorage.writeAudio(STORY, 'ch1', 'abc', new ArrayBuffer(4))
    expect(await dexieStorage.audioKeys(STORY, 'ch1')).toEqual([])
    expect(await dexieStorage.readAudio(STORY, 'ch1', 'abc')).toBeNull()
  })

  it('keeps the app’s own tables in IndexedDB', async () => {
    const library = memoryLibrary()
    const storage = libraryStorage(library.disk)
    await storage.put('chatProfiles', { id: 'p1', name: 'Mine' })
    await storage.write('aiPrompts', [put('aiPrompts', { id: 'a1', name: 'A' })])

    expect(await dexieStorage.get('chatProfiles', 'p1')).toMatchObject({ name: 'Mine' })
    expect(await dexieStorage.all('aiPrompts')).toHaveLength(1)
    expect(library.outside.list()).toEqual([])
  })

  it('makes a folder in a new project as the tree does', async () => {
    const library = await withProject()
    await library.storage.documents(STORY)

    await library.storage.write('documents', [
      put('documents', folder('drafts', ROOT, { title: 'Drafts', order: 3 })),
      put('documents', doc('idea', 'drafts', { title: 'An idea', content: 'What if.' })),
    ])

    expect(library.outside.read('My Novel/Drafts/An idea.md')).toContain('What if.')
  })
})

describe('the library through any run of changes', () => {
  for (const seed of [11, 12, 13, 14, 15]) {
    it(`reads back as the rows, and takes nothing it wrote for a change made elsewhere (seed ${seed})`, async () => {
      const next = random(seed)
      /** @type {string[]} */
      const told = []
      const library = memoryLibrary()
      const storage = libraryStorage(library.disk, {
        onConflict: changed => told.push(...changed.map(({ path }) => path)),
      })
      let documents = sample()
      await storage.putFileBytes('pdf', STORY, new Blob(['bytes of pdf']))
      await storage.write('stories', [put('stories', story())])
      await storage.write(
        'documents',
        documents.map(row => put('documents', row))
      )
      await storage.documents(STORY)

      for (let round = 0; round < 40; round++) {
        let after = documents
        const batch = 1 + Math.floor(next() * 3)
        for (let n = 0; n < batch; n++) after = anyChange(after, next, round * 10 + n)
        if (next() < 0.15) {
          const title = TITLES[Math.floor(next() * TITLES.length)]
          after = after.map(row => (row.id === ROOT ? { ...row, title } : row))
        }
        const was = new Map(documents.map(row => [row.id, JSON.stringify(row)]))
        const kept = new Set(after.map(row => row.id))
        // A file's bytes come straight after its row, before the row is saved.
        for (const row of after) {
          if (row.type === 'file' && !was.has(row.id)) {
            await storage.putFileBytes(row.id, STORY, new Blob([`bytes of ${row.id}`]))
          }
        }
        await storage.write('documents', [
          ...after
            .filter(row => was.get(row.id) !== JSON.stringify(row))
            .map(row => put('documents', row)),
          ...documents.filter(row => !kept.has(row.id)).map(row => gone('documents', row.id)),
        ])
        documents = after

        const read = await reopened(library).documents(STORY)
        expect(byIdSorted(read)).toEqual(asRead(documents))
      }
      expect(told).toEqual([])
      const again = reopened(library)
      await again.documents(STORY)
      for (const row of documents.filter(row => row.type === 'file' && row.mime === 'image/png')) {
        expect(await (await again.fileBytes(row.id))?.text()).toBe(`bytes of ${row.id}`)
      }
    })
  }
})
