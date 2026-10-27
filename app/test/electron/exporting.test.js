// @vitest-environment node
/* global TextEncoder */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { dialog, shell } from 'electron'
import { exportFolders } from '../../electron/src/exporting.js'

/** A folder of its own for each test, where the writer chooses to put an export. */
let dir

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inksprite-export-'))
  // The system's trash, as far as the test sees: the folder is gone from where it was.
  shell.trashItem.mockReset()
  shell.trashItem.mockImplementation(at => fs.rm(at, { recursive: true }))
  dialog.showSaveDialog.mockReset()
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** Every file under a folder, by path below it, as its text. */
async function filesUnder(top) {
  const out = {}
  for (const name of await fs.readdir(top, { recursive: true })) {
    const at = path.join(top, name)
    out[name.split(path.sep).join('/')] = (await fs.stat(at)).isDirectory()
      ? 'folder'
      : await fs.readFile(at, 'utf8')
  }
  return out
}

/** Choose `name` in `dir` in the save dialog, as the writer would. */
async function chosen(exports, name) {
  dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath: path.join(dir, name) })
  return exports.choose(null, 'Guide')
}

describe('exportFolders', () => {
  it('asks where, starting from the folder’s name, and is nothing when cancelled', async () => {
    const exports = exportFolders()
    dialog.showSaveDialog.mockResolvedValue({ canceled: true, filePath: '' })
    expect(await exports.choose(null, 'Guide')).toBeNull()
    expect(dialog.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'Guide', buttonLabel: 'Export' })
    )
  })

  it('writes the export as the folder chosen, under the name given there', async () => {
    const exports = exportFolders()
    const library = path.join(dir, 'library.pdf')
    await fs.writeFile(library, '%PDF')
    const target = await chosen(exports, 'guide')

    await exports.write(
      target,
      [
        { path: 'Guide', folder: true },
        { path: 'Guide/Getting started.md', text: 'Hello.' },
        { path: 'Guide/images/map.png', bytes: new TextEncoder().encode('map') },
        { path: 'Guide/Rules/Tide tables.pdf', file: 'My Project/Tide tables.pdf' },
        { path: 'Guide/Empty', folder: true },
      ],
      async file => (file === 'My Project/Tide tables.pdf' ? { path: library } : null)
    )

    expect(await filesUnder(path.join(dir, 'guide'))).toEqual({
      'Getting started.md': 'Hello.',
      images: 'folder',
      'images/map.png': 'map',
      Rules: 'folder',
      'Rules/Tide tables.pdf': '%PDF',
      Empty: 'folder',
    })
    expect(shell.trashItem).not.toHaveBeenCalled()
  })

  it('puts a folder already there in the trash first, so nothing deleted since stays', async () => {
    const exports = exportFolders()
    await fs.mkdir(path.join(dir, 'Guide'))
    await fs.writeFile(path.join(dir, 'Guide', 'Old page.md'), 'Gone.')
    const target = await chosen(exports, 'Guide')

    await exports.write(target, [{ path: 'Guide/New page.md', text: 'New.' }], async () => null)

    expect(shell.trashItem).toHaveBeenCalledWith(path.join(dir, 'Guide'))
    expect(await filesUnder(path.join(dir, 'Guide'))).toEqual({ 'New page.md': 'New.' })
  })

  it('writes only where the writer chose, and once', async () => {
    const exports = exportFolders()
    await expect(
      exports.write(
        path.join(dir, 'Elsewhere'),
        [{ path: 'Guide', folder: true }],
        async () => null
      )
    ).rejects.toThrow('wasn’t chosen')
    const target = await chosen(exports, 'Guide')
    await exports.write(target, [{ path: 'Guide', folder: true }], async () => null)
    await expect(
      exports.write(target, [{ path: 'Guide', folder: true }], async () => null)
    ).rejects.toThrow('wasn’t chosen')
  })

  it('refuses a path that would lead out of the folder, and a file the library lacks', async () => {
    const exports = exportFolders()
    let target = await chosen(exports, 'Guide')
    await expect(
      exports.write(target, [{ path: 'Guide/../../outside.md', text: 'No.' }], async () => null)
    ).rejects.toThrow('Not a path in the export')
    await expect(fs.stat(path.join(dir, '..', 'outside.md'))).rejects.toThrow()

    target = await chosen(exports, 'Guide')
    await expect(
      exports.write(target, [{ path: 'Guide/Rules.pdf', file: 'gone.pdf' }], async () => null)
    ).rejects.toThrow('Rules.pdf isn’t in the library.')
  })
})
