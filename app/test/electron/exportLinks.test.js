// @vitest-environment node
/* global TextEncoder */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { dialog, shell } from 'electron'
import { exportLinks } from '../../electron/src/exportLinks.js'

const STORY = 'story_a'

/** A place of its own for each test: the links' file, a repository, and the system's trash. */
let dir
let file
let repo
let trash

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inksprite-links-'))
  file = path.join(dir, 'export-folders.json')
  repo = path.join(dir, 'repo', 'docs')
  trash = path.join(dir, 'trash')
  await fs.mkdir(repo, { recursive: true })
  await fs.mkdir(trash)
  // The system's trash, as far as the test sees: gone from where it was, and kept.
  shell.trashItem.mockReset()
  shell.trashItem.mockImplementation(at => fs.rename(at, path.join(trash, path.basename(at))))
  dialog.showOpenDialog.mockReset()
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** Every file under a folder, by path below it, as its text. */
async function filesUnder(top) {
  const out = {}
  for (const name of await fs.readdir(top, { recursive: true })) {
    const at = path.join(top, name)
    if ((await fs.stat(at)).isFile())
      out[name.split(path.sep).join('/')] = await fs.readFile(at, 'utf8')
  }
  return out
}

/** Link the project to the repository's docs, as the writer would in the dialog. */
async function linked(links = exportLinks(file), storyId = STORY, folder = repo) {
  dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [folder] })
  await links.link(null, storyId)
  return links
}

/** An export of a project called Thief: two documents, one in a folder. */
const entries = (plan = '# Plan\n', crew = 'Mara.\n') => [
  { path: 'Thief', folder: true },
  { path: 'Thief/Plan.md', text: plan },
  { path: 'Thief/notes', folder: true },
  { path: 'Thief/notes/Crew.md', text: crew },
]

const locate = async () => null

describe('exportLinks', () => {
  it('has no folder for a project until the writer chooses one, and none when they cancel', async () => {
    const links = exportLinks(file)
    expect(await links.linked(STORY)).toBeNull()

    dialog.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await links.link(null, STORY)).toBeNull()
    expect(await links.linked(STORY)).toBeNull()
    expect(dialog.showOpenDialog).toHaveBeenCalledWith(
      expect.objectContaining({ properties: ['openDirectory', 'createDirectory'] })
    )
  })

  it('keeps the folder chosen, for the app opened again, in a file only the writer reads', async () => {
    await linked()

    expect(await exportLinks(file).linked(STORY)).toBe(repo)
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    expect(await exportLinks(file).linked('story_b')).toBeNull()
  })

  it('stops exporting there once unlinked, leaving what is there', async () => {
    const links = await linked()
    await links.apply(STORY, entries(), locate)

    await links.unlink(STORY)

    expect(await links.linked(STORY)).toBeNull()
    await expect(links.apply(STORY, entries(), locate)).rejects.toThrow('No folder is linked')
    expect(Object.keys(await filesUnder(repo))).toEqual(['Plan.md', 'notes/Crew.md'])
  })

  it('writes the export into the folder, the export’s own folder being that folder', async () => {
    const links = await linked()

    const report = await links.apply(STORY, entries(), locate)

    expect(await filesUnder(repo)).toEqual({ 'Plan.md': '# Plan\n', 'notes/Crew.md': 'Mara.\n' })
    expect(report).toEqual({
      folder: repo,
      written: ['Plan.md', 'notes/Crew.md'],
      edited: [],
      removed: [],
      unchanged: 0,
    })
  })

  it('writes only what has changed, and touches nothing that isn’t the export’s', async () => {
    await fs.writeFile(path.join(repo, 'README.md'), 'Not ours.\n')
    const links = await linked()
    await links.apply(STORY, entries(), locate)
    const before = (await fs.stat(path.join(repo, 'notes', 'Crew.md'))).mtimeMs

    const report = await links.apply(STORY, entries('# Plan\n\nMore.\n'), locate)

    expect(report).toMatchObject({ written: ['Plan.md'], edited: [], removed: [], unchanged: 1 })
    expect((await fs.stat(path.join(repo, 'notes', 'Crew.md'))).mtimeMs).toBe(before)
    expect(await filesUnder(repo)).toEqual({
      'README.md': 'Not ours.\n',
      'Plan.md': '# Plan\n\nMore.\n',
      'notes/Crew.md': 'Mara.\n',
    })
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('puts a copy edited outside in the trash before writing over it, and names it', async () => {
    const links = await linked()
    await links.apply(STORY, entries(), locate)
    await fs.writeFile(path.join(repo, 'Plan.md'), '# Plan\n\nEdited in the repository.\n')

    // Exported again without a change in the project: still written again.
    const report = await links.apply(STORY, entries(), locate)

    expect(report).toMatchObject({ written: ['Plan.md'], edited: ['Plan.md'], unchanged: 1 })
    expect(await fs.readFile(path.join(repo, 'Plan.md'), 'utf8')).toBe('# Plan\n')
    expect(await fs.readFile(path.join(trash, 'Plan.md'), 'utf8')).toBe(
      '# Plan\n\nEdited in the repository.\n'
    )
  })

  it('writes over an older export of its own without the trash, when the page says it is one', async () => {
    const links = await linked()
    await links.apply(STORY, entries(), locate)
    // Another branch checked out: the file is an export from before, not the last.
    await fs.writeFile(path.join(repo, 'Plan.md'), '# An older plan\n')

    const [top, plan, ...rest] = entries('# Plan, newer\n')
    const report = await links.apply(STORY, [top, { ...plan, own: true }, ...rest], locate)

    expect(report).toMatchObject({ written: ['Plan.md'], edited: [] })
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('puts a file that was never the export’s in the trash before taking its place', async () => {
    await fs.writeFile(path.join(repo, 'Plan.md'), 'Someone else’s plan.\n')
    const links = await linked()

    const report = await links.apply(STORY, entries(), locate)

    expect(report.edited).toEqual(['Plan.md'])
    expect(await fs.readFile(path.join(trash, 'Plan.md'), 'utf8')).toBe('Someone else’s plan.\n')
  })

  it('removes what it wrote before and no longer would, and the directory that leaves empty', async () => {
    const links = await linked()
    await links.apply(STORY, entries(), locate)
    await fs.writeFile(path.join(repo, 'README.md'), 'Not ours.\n')

    // The folder and its document are gone from the project.
    const report = await links.apply(STORY, entries().slice(0, 2), locate)

    expect(report).toMatchObject({ removed: ['notes/Crew.md'], written: [], unchanged: 1 })
    expect(await filesUnder(repo)).toEqual({ 'README.md': 'Not ours.\n', 'Plan.md': '# Plan\n' })
    await expect(fs.stat(path.join(repo, 'notes'))).rejects.toThrow()
    expect(await fs.readFile(path.join(trash, 'Crew.md'), 'utf8')).toBe('Mara.\n')
  })

  it('leaves a directory it made where something else has been put in it', async () => {
    const links = await linked()
    await links.apply(STORY, entries(), locate)
    await fs.writeFile(path.join(repo, 'notes', 'mine.txt'), 'Kept.\n')

    await links.apply(STORY, entries().slice(0, 2), locate)

    expect(await filesUnder(repo)).toEqual({ 'Plan.md': '# Plan\n', 'notes/mine.txt': 'Kept.\n' })
  })

  it('copies a file from the library, and bytes handed over, only when they differ', async () => {
    const library = path.join(dir, 'in-library.pdf')
    await fs.writeFile(library, '%PDF-1')
    const links = await linked()
    const withFiles = [
      { path: 'Thief', folder: true },
      { path: 'Thief/Rules.pdf', file: 'Thief/Rules.pdf' },
      { path: 'Thief/images', folder: true },
      { path: 'Thief/images/map.png', bytes: new TextEncoder().encode('png') },
    ]
    const found = async name => (name === 'Thief/Rules.pdf' ? { path: library } : null)

    expect((await links.apply(STORY, withFiles, found)).written).toEqual([
      'Rules.pdf',
      'images/map.png',
    ])
    expect(await links.apply(STORY, withFiles, found)).toMatchObject({ written: [], unchanged: 2 })
    expect(await fs.readFile(path.join(repo, 'Rules.pdf'), 'utf8')).toBe('%PDF-1')

    await expect(
      links.apply(STORY, [{ path: 'Thief/Gone.pdf', file: 'Thief/Gone.pdf' }], found)
    ).rejects.toThrow('Gone.pdf isn’t in the library')
  })

  it('refuses a path that would lead out of the folder, or through a link', async () => {
    const outside = path.join(dir, 'outside')
    await fs.mkdir(outside)
    const links = await linked()

    for (const bad of ['Thief/../../outside/x.md', 'Thief//x.md', 'Thief/./x.md', '']) {
      await expect(links.apply(STORY, [{ path: bad, text: 'x' }], locate)).rejects.toThrow(
        'Not a path in the export'
      )
    }
    await fs.symlink(outside, path.join(repo, 'linked'))
    await expect(
      links.apply(STORY, [{ path: 'Thief/linked/x.md', text: 'x' }], locate)
    ).rejects.toThrow('goes through a link')
    expect(await fs.readdir(outside)).toEqual([])
  })

  it('reads the texts that are there for the page, and nothing outside the folder', async () => {
    const links = await linked()
    await links.apply(STORY, entries(), locate)
    await fs.writeFile(path.join(dir, 'secret.txt'), 'Not for the page.')

    expect(
      await links.look(STORY, [
        'Thief/Plan.md',
        'Thief/Nothing.md',
        'Thief/notes',
        'Thief/../../secret.txt',
        7,
      ])
    ).toEqual({
      'Thief/Plan.md': '# Plan\n',
      'Thief/Nothing.md': null,
      'Thief/notes': null,
      'Thief/../../secret.txt': null,
    })
    await expect(links.look('story_b', ['Thief/Plan.md'])).rejects.toThrow('No folder is linked')
  })

  it('starts afresh in another folder, leaving the first as it was', async () => {
    const links = await linked()
    await links.apply(STORY, entries(), locate)
    const other = path.join(dir, 'other')
    await fs.mkdir(other)

    await linked(links, STORY, other)
    const report = await links.apply(STORY, entries().slice(0, 2), locate)

    expect(report).toMatchObject({ folder: other, written: ['Plan.md'], removed: [] })
    expect(Object.keys(await filesUnder(repo))).toEqual(['Plan.md', 'notes/Crew.md'])
  })

  it('takes only a project’s id for a project', async () => {
    const links = exportLinks(file)
    for (const id of ['../x', '', undefined, 'a/b', 7]) {
      await expect(links.linked(id)).rejects.toThrow('Not a project’s id')
      await expect(links.apply(id, [], locate)).rejects.toThrow('Not a project’s id')
    }
  })
})
