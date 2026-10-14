/* global File, Blob */
import { describe, it, expect } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { isZip, mayHoldProject, packageOfFolder, packageOfZip } from '@/scrivener/package.js'

const file = (/** @type {string} */ name, text = 'x') => new File([text], name)

/** @param {Record<string, string>} entries */
const zipOf = entries =>
  new Blob([
    zipSync(
      Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, strToU8(text)]))
    ),
  ])

describe('isZip', () => {
  it('knows a zip by its name or its type', () => {
    expect(isZip(file('Harbour.zip'))).toBe(true)
    expect(isZip(new File(['x'], 'Harbour', { type: 'application/zip' }))).toBe(true)
    expect(isZip(file('Harbour.scrivx'))).toBe(false)
  })
})

describe('mayHoldProject', () => {
  it('takes a zip, or a project as a browser that does not zip it hands one over', () => {
    expect(mayHoldProject(file('Harbour.scriv.zip'))).toBe(true)
    expect(mayHoldProject(file('Harbour.scriv'))).toBe(true)
    expect(mayHoldProject(file('Harbour.json'))).toBe(false)
  })
})

describe('packageOfFolder', () => {
  it('takes a folder with a binder at its top as a project, named after the folder', () => {
    const pack = packageOfFolder([
      { file: file('Harbour.scrivx'), folders: ['Harbour.scriv'] },
      { file: file('content.rtf'), folders: ['Harbour.scriv', 'Files', 'Data', 'A1'] },
    ])

    expect(pack?.name).toBe('Harbour')
    expect([...(pack?.files.keys() ?? [])]).toEqual(['Harbour.scrivx', 'Files/Data/A1/content.rtf'])
  })

  it('takes nothing else for one', () => {
    // A folder with no binder at its top
    expect(
      packageOfFolder([
        { file: file('notes.md'), folders: ['papers'] },
        { file: file('Old.scrivx'), folders: ['papers', 'Old.scriv'] },
      ])
    ).toBeNull()
    // Files chosen on their own
    expect(packageOfFolder([{ file: file('Harbour.scrivx'), folders: [] }])).toBeNull()
    expect(packageOfFolder([])).toBeNull()
  })
})

describe('packageOfZip', () => {
  it('unpacks only the project, without the copies Finder adds', async () => {
    const pack = await packageOfZip(
      zipOf({
        'Harbour.scriv/Harbour.scrivx': '<ScrivenerProject/>',
        'Harbour.scriv/Files/Data/A1/content.rtf': '{\\rtf1 Tide}',
        '__MACOSX/Harbour.scriv/._Harbour.scrivx': 'resource fork',
        'Read me.txt': 'beside it',
      })
    )

    expect(pack?.name).toBe('Harbour')
    expect([...(pack?.files.keys() ?? [])].sort()).toEqual([
      'Files/Data/A1/content.rtf',
      'Harbour.scrivx',
    ])
    expect(await pack?.files.get('Files/Data/A1/content.rtf')?.text()).toBe('{\\rtf1 Tide}')
  })

  it('takes the binder nearest the top, and names a project zipped without its folder after it', async () => {
    const pack = await packageOfZip(
      zipOf({
        'Harbour.scrivx': '<ScrivenerProject/>',
        'Files/Data/A1/content.rtf': '{\\rtf1 Tide}',
        'Backups/Old.scriv/Old.scrivx': '<ScrivenerProject/>',
      })
    )

    expect(pack?.name).toBe('Harbour')
    expect(pack?.files.has('Harbour.scrivx')).toBe(true)
  })

  it('reads a project chosen as a file, which Chrome and Electron zip with its folder', async () => {
    const zip = zipOf({
      'Harbour.scriv/Harbour.scrivx': '<ScrivenerProject/>',
      'Harbour.scriv/Files/Data/A1/content.rtf': '{\\rtf1 Tide}',
    })
    const pack = await packageOfZip(new File([zip], 'Harbour.scriv.zip'))

    expect(pack?.name).toBe('Harbour')
    expect(pack?.files.has('Files/Data/A1/content.rtf')).toBe(true)
  })

  it('finds no project in what cannot be read, such as a package handed over as a folder', async () => {
    const unreadable = /** @type {Blob} */ (
      /** @type {unknown} */ ({
        arrayBuffer: async () => Promise.reject(new Error('NotReadableError')),
      })
    )

    expect(await packageOfZip(unreadable)).toBeNull()
  })

  it('finds no project in a zip without one, or in what is not a zip', async () => {
    expect(await packageOfZip(zipOf({ 'notes.txt': 'tides' }))).toBeNull()
    expect(await packageOfZip(new Blob(['not a zip']))).toBeNull()
  })
})
