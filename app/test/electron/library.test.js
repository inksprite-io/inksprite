// @vitest-environment node
/* global Buffer */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** A library in a folder of its own, and a trash beside it. */
let place, root, trashed, library

/** Electron's stand-ins, as library.js has them. */
let electron

/**
 * library.js afresh, since it keeps its settings once read, and the
 * stand-ins it is given: a trash beside the library, and folders in `place`.
 */
const load = async () => {
  vi.resetModules()
  electron = await import('electron')
  electron.shell.trashItem.mockImplementation(async file => {
    trashed.push(path.relative(root, file))
    const kept = path.join(place, 'trash', String(trashed.length))
    await fs.mkdir(kept, { recursive: true })
    await fs.rename(file, path.join(kept, path.basename(file)))
  })
  electron.app.getPath.mockImplementation(name => path.join(place, name))
  return import('../../electron/src/library.js')
}

/** @param {string} relative @param {string} text */
const put = async (relative, text) => {
  const file = path.join(root, ...relative.split('/'))
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, text)
}

/** @param {string} relative */
const read = relative => fs.readFile(path.join(root, ...relative.split('/')), 'utf8')

/** @param {string} relative */
const there = relative =>
  fs.stat(path.join(root, ...relative.split('/'))).then(
    () => true,
    () => false
  )

beforeEach(async () => {
  place = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'inksprite-library-')))
  root = path.join(place, 'library')
  await fs.mkdir(root)
  trashed = []
  const { libraryFolder } = await load()
  library = libraryFolder(root)
})

afterEach(async () => {
  await fs.rm(place, { recursive: true, force: true })
})

describe('what the page may name in the library', () => {
  it('is a path below it, and nothing else', async () => {
    for (const bad of ['', '../out.md', 'a/../../out.md', '/etc/passwd', 'a//b', './a']) {
      await expect(library.apply([{ op: 'write', path: bad, text: 'x' }])).rejects.toThrow()
    }
    expect(await fs.readdir(place)).toEqual(['library'])
  })

  it('leads nowhere out of it through a link', async () => {
    await fs.mkdir(path.join(place, 'outside'))
    await fs.symlink(path.join(place, 'outside'), path.join(root, 'link'))

    await expect(library.apply([{ op: 'write', path: 'link/x.md', text: 'x' }])).rejects.toThrow(
      'leads out of the library'
    )
    await expect(library.readTexts(['link/x.md'])).rejects.toThrow('leads out of the library')
    expect(await fs.readdir(path.join(place, 'outside'))).toEqual([])
  })

  it('is never a link itself', async () => {
    await fs.writeFile(path.join(place, 'secret'), 'no')
    await fs.symlink(path.join(place, 'secret'), path.join(root, 'note.md'))

    await expect(library.apply([{ op: 'write', path: 'note.md', text: 'x' }])).rejects.toThrow(
      'is a link'
    )
    expect(await fs.readFile(path.join(place, 'secret'), 'utf8')).toBe('no')
  })
})

describe('writing in the library', () => {
  it('writes a file whole, folders and all, and says how it left it', async () => {
    const { seen, conflicts } = await library.apply([
      { op: 'write', path: 'Novel/Notes/Elara.md', text: 'Tall.' },
    ])

    expect(await read('Novel/Notes/Elara.md')).toBe('Tall.')
    expect(seen['Novel/Notes/Elara.md']).toMatchObject({ size: 5 })
    expect(conflicts).toEqual([])
    expect(await fs.readdir(path.join(root, 'Novel/Notes'))).toEqual(['Elara.md'])
  })

  it('writes over a file as it was seen', async () => {
    const first = await library.apply([{ op: 'write', path: 'a.md', text: 'one' }])
    const { conflicts } = await library.apply([
      { op: 'write', path: 'a.md', text: 'two', expect: first.seen['a.md'] },
    ])
    expect(conflicts).toEqual([])
    expect(trashed).toEqual([])
    expect(await read('a.md')).toBe('two')
  })

  it('trashes a file changed since it was seen before writing over it', async () => {
    const first = await library.apply([{ op: 'write', path: 'a.md', text: 'one' }])
    await put('a.md', 'changed elsewhere')

    const { conflicts } = await library.apply([
      { op: 'write', path: 'a.md', text: 'two', expect: first.seen['a.md'] },
    ])

    expect(conflicts).toEqual(['a.md'])
    expect(trashed).toEqual(['a.md'])
    expect(await fs.readFile(path.join(place, 'trash/1/a.md'), 'utf8')).toBe('changed elsewhere')
    expect(await read('a.md')).toBe('two')
  })

  it('trashes a file found where none was seen', async () => {
    await put('new.md', 'made elsewhere')
    const { conflicts } = await library.apply([
      { op: 'write', path: 'new.md', text: 'ours', expect: null },
    ])
    expect(conflicts).toEqual(['new.md'])
    expect(await read('new.md')).toBe('ours')
  })

  it('writes the end of a file from a byte on', async () => {
    await put('chat.jsonl', 'line one\nline two, first draft\n')

    await library.apply([
      { op: 'append', path: 'chat.jsonl', at: 9, size: 31, text: 'two\nthree\n' },
    ])

    expect(await read('chat.jsonl')).toBe('line one\ntwo\nthree\n')
  })

  it('refuses to write the end of a file that is not the length it was', async () => {
    await put('chat.jsonl', 'line one\n')
    await expect(
      library.apply([{ op: 'append', path: 'chat.jsonl', at: 9, size: 20, text: 'x\n' }])
    ).rejects.toThrow('Changed since it was read')
    expect(await read('chat.jsonl')).toBe('line one\n')
  })

  it('moves a folder with all that is in it', async () => {
    await put('Novel/Notes/Elara.md', 'Tall.')
    await library.apply([{ op: 'move', from: 'Novel/Notes', to: 'Novel/Lore/Notes' }])
    expect(await read('Novel/Lore/Notes/Elara.md')).toBe('Tall.')
    expect(await there('Novel/Notes')).toBe(false)
  })

  it('trashes what is where a move goes before moving onto it', async () => {
    await put('a.md', 'a')
    await put('b.md', 'b')
    const { conflicts } = await library.apply([{ op: 'move', from: 'a.md', to: 'b.md' }])
    expect(conflicts).toEqual(['b.md'])
    expect(await read('b.md')).toBe('a')
  })

  it('trashes a file or folder, and nothing when it is gone already', async () => {
    await put('Novel/Old/x.md', 'x')
    await library.apply([
      { op: 'trash', path: 'Novel/Old' },
      { op: 'trash', path: 'Novel/never.md' },
    ])
    expect(trashed).toEqual(['Novel/Old'])
    expect(await there('Novel/Old')).toBe(false)
  })

  it('deletes narration audio for good, and refuses to delete anything else', async () => {
    await put('Novel/.inksprite/audio/doc_1/a.wav', 'a')
    await put('Novel/.inksprite/audio/doc_2/b.wav', 'b')
    await put('Novel/Notes/c.md', 'c')

    await library.apply([
      { op: 'delete', path: 'Novel/.inksprite/audio/doc_1/a.wav' },
      { op: 'delete', path: 'Novel/.inksprite/audio/doc_2' },
      { op: 'delete', path: 'Novel/.inksprite/audio/doc_3' },
    ])
    expect(await there('Novel/.inksprite/audio/doc_1/a.wav')).toBe(false)
    expect(await there('Novel/.inksprite/audio/doc_2')).toBe(false)
    expect(trashed).toEqual([])

    for (const path of ['Novel/Notes/c.md', 'Novel/.inksprite', 'Novel/.inksprite/audio-x/d']) {
      await expect(library.apply([{ op: 'delete', path }])).rejects.toThrow(
        'Only narration audio is deleted'
      )
    }
    expect(await there('Novel/Notes/c.md')).toBe(true)
  })

  it('keeps what goes in a trash of its own where the system has none', async () => {
    electron.shell.trashItem.mockRejectedValueOnce(new Error('no trash here'))
    await put('x.md', 'x')

    await library.apply([{ op: 'trash', path: 'x.md' }])

    const kept = await fs.readdir(path.join(root, '.inksprite-trash'))
    expect(kept).toHaveLength(1)
    expect(await read(`.inksprite-trash/${kept[0]}/x.md`)).toBe('x')
  })
})

describe('reading the library', () => {
  it('finds the projects by their story files', async () => {
    await put('Novel/.inksprite/story.json', '{}')
    await put('Notes app/readme.md', 'not a project')
    await put('.hidden/.inksprite/story.json', '{}')
    expect(await library.projects()).toEqual({
      projects: ['Novel'],
      taken: ['.hidden', 'Notes app', 'Novel'],
    })
  })

  it('walks a project’s own folders, and names the rest without going in', async () => {
    await put('Novel/.folder.md', 'root')
    await put('Novel/.inksprite/story.json', '{}')
    await put('Novel/.inksprite/chats/chat_1.jsonl', '')
    await put('Novel/.inksprite/audio/doc_1/a.wav', 'a')
    await put('Novel/Notes/.folder.md', 'notes')
    await put('Novel/Notes/Elara.md', 'Tall.')
    await put('Novel/Notes/tool/.repository.json', '{}')
    await put('Novel/Notes/tool/src/main.js', 'x')
    await put('Novel/Photos/cat.jpg', 'pixels')
    await fs.symlink(path.join(place), path.join(root, 'Novel/away'))

    const { files, closed } = await library.walk('Novel')

    expect(files.map(file => file.path).sort()).toEqual([
      '.folder.md',
      '.inksprite/chats/chat_1.jsonl',
      '.inksprite/story.json',
      'Notes/.folder.md',
      'Notes/Elara.md',
      'Notes/tool/.repository.json',
      'Notes/tool/src/main.js',
    ])
    expect(closed.sort()).toEqual(['Photos', 'away'])
    expect(files.find(file => file.path === 'Notes/Elara.md')).toMatchObject({ size: 5 })
  })

  it('lists the files in a folder, and none in one not there', async () => {
    await put('Novel/.inksprite/audio/doc_1/b.wav', 'b')
    await put('Novel/.inksprite/audio/doc_1/a.wav', 'a')
    await put('Novel/.inksprite/audio/doc_1/deeper/c.wav', 'c')
    expect(await library.list('Novel/.inksprite/audio/doc_1')).toEqual(['a.wav', 'b.wav'])
    expect(await library.list('Novel/.inksprite/audio/doc_2')).toEqual([])
    await expect(library.list('../outside')).rejects.toThrow('Not a path in the library')
  })

  it('reads the texts there are, and the bytes of one file', async () => {
    await put('a.md', 'A')
    expect(await library.readTexts(['a.md', 'missing.md'])).toEqual({ 'a.md': 'A' })
    expect(Buffer.from(await library.readBytes('a.md')).toString()).toBe('A')
    expect(await library.readBytes('missing.md')).toBeNull()
  })
})

describe('where the library is', () => {
  it('is Projects in the app’s data folder, made as the app opens', async () => {
    const { librarySettings, ensureLibrary, markMoved } = await load()
    const library = path.join(place, 'userData', 'Projects')
    expect(await librarySettings()).toEqual({ path: library, moved: false })

    expect(await ensureLibrary()).toBe(library)
    await markMoved()

    expect((await fs.stat(library)).isDirectory()).toBe(true)
    const again = await load()
    expect(await again.librarySettings()).toEqual({ path: library, moved: true })
    expect(electron.dialog.showMessageBox).not.toHaveBeenCalled()
  })

  it('is made in a release too', async () => {
    const { ensureLibrary } = await load()
    electron.app.isPackaged = true
    try {
      const library = await ensureLibrary()
      expect((await fs.stat(library)).isDirectory()).toBe(true)
    } finally {
      electron.app.isPackaged = false
    }
  })

  it('has the projects moved in again when they were switched back into the app', async () => {
    const { librarySettings } = await load()
    await fs.mkdir(path.join(place, 'userData'), { recursive: true })
    await fs.writeFile(
      path.join(place, 'userData', 'library.json'),
      JSON.stringify({ enabled: false, moved: false })
    )
    expect(await librarySettings()).toMatchObject({ moved: false })
  })

  it('is made again when it was taken away', async () => {
    const { ensureLibrary } = await load()
    const library = await ensureLibrary()
    await fs.rm(library, { recursive: true })

    expect(await ensureLibrary()).toBe(library)
    expect((await fs.stat(library)).isDirectory()).toBe(true)
  })
})
