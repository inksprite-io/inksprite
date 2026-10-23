/* global Blob, File */
import { describe, it, expect } from 'vitest'
import { unzipSync, zipSync, strToU8 } from 'fflate'
import { MANIFEST, isArchive, readArchive, writeArchive } from '@/utils/backupArchive.js'

/** @param {Blob} blob */
const bytesOf = async blob => new Uint8Array(await blob.arrayBuffer())

// Bytes holding the signatures a zip's entries are found by, as any PDF may.
const AWKWARD = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x50, 0x4b, 0x07, 0x08, 1, 2, 3, 0x50, 0x4b, 0x03, 0x04, 0x50, 0x4b, 0x01,
  0x02, 9, 0x50, 0x4b, 0x05, 0x06, 255,
])

function sampleBackup() {
  return {
    app: 'inksprite',
    format: 1,
    dbVersion: 33,
    exported: 1000,
    includesApiKeys: false,
    scope: 'selection',
    settings: { theme: 'dark' },
    tables: {
      stories: [{ id: 'story_1', created: 1 }],
      documents: [
        { id: 'doc_1', storyId: 'story_1', title: 'Chapter 1', content: 'The gate was locked.\n' },
      ],
      files: [
        {
          id: 'doc_file',
          storyId: 'story_1',
          blob: new Blob([AWKWARD], { type: 'application/pdf' }),
        },
        { id: 'doc_empty', storyId: 'story_1', blob: new Blob([], { type: 'text/plain' }) },
      ],
      cards: [{ id: 'card_1', name: 'Wren' }],
      cardFiles: [
        { id: 'card_1', card: { name: 'Wren' }, image: new Blob([AWKWARD], { type: 'image/png' }) },
        { id: 'card_2', card: { name: 'Pip' }, image: null, thumbnail: null },
      ],
      chats: [],
    },
  }
}

describe('a backup as a zip', () => {
  it('comes back as the backup it was, files as Blobs with their bytes and types', async () => {
    const zip = await writeArchive(/** @type {any} */ (sampleBackup()))
    expect(zip.type).toBe('application/zip')
    expect(await isArchive(zip)).toBe(true)

    const back = await readArchive(new File([zip], 'inksprite-export.zip'))
    const { tables, ...envelope } = back
    expect(envelope).toEqual({
      app: 'inksprite',
      format: 1,
      dbVersion: 33,
      exported: 1000,
      includesApiKeys: false,
      scope: 'selection',
      settings: { theme: 'dark' },
    })
    expect(tables.stories).toEqual([{ id: 'story_1', created: 1 }])
    expect(tables.documents[0].content).toBe('The gate was locked.\n')
    expect(tables.chats).toEqual([])
    const [pdf, empty] = tables.files
    expect(pdf.id).toBe('doc_file')
    expect(pdf.blob.type).toBe('application/pdf')
    expect(await bytesOf(pdf.blob)).toEqual(AWKWARD)
    expect(empty.blob.size).toBe(0)
    expect(empty.blob.type).toBe('text/plain')
    expect(await bytesOf(tables.cardFiles[0].image)).toEqual(AWKWARD)
    expect(tables.cardFiles[1]).toEqual({
      id: 'card_2',
      card: { name: 'Pip' },
      image: null,
      thumbnail: null,
    })
  })

  it('is a zip any tool opens: rows as JSON, each file stored as it is', async () => {
    const zip = await writeArchive(/** @type {any} */ (sampleBackup()))
    const entries = unzipSync(await bytesOf(zip))
    expect(Object.keys(entries)).toContain(MANIFEST)
    expect(entries['files/1']).toEqual(AWKWARD)
    const manifest = JSON.parse(new TextDecoder().decode(entries[MANIFEST]))
    expect(manifest.tables.files).toEqual(['tables/files/1.json'])
    const rows = JSON.parse(new TextDecoder().decode(entries['tables/files/1.json']))
    expect(rows[0]).toEqual({
      id: 'doc_file',
      storyId: 'story_1',
      mime: 'application/pdf',
      entry: 'files/1',
    })
  })

  it('splits a large table across entries, keeping its rows in order', async () => {
    const backup = sampleBackup()
    backup.tables.documents = Array.from({ length: 50 }, (_, at) => ({
      id: `doc_${at}`,
      storyId: 'story_1',
      content: `Paragraph ${at}. `.repeat(20),
    }))
    const zip = await writeArchive(/** @type {any} */ (backup), { entryChars: 2000 })
    const manifest = JSON.parse(new TextDecoder().decode(unzipSync(await bytesOf(zip))[MANIFEST]))
    expect(manifest.tables.documents.length).toBeGreaterThan(5)
    const back = await readArchive(zip)
    expect(back.tables.documents.map((/** @type {any} */ row) => row.id)).toEqual(
      backup.tables.documents.map(row => row.id)
    )
  })

  it('tells a backup from a JSON file and from another zip', async () => {
    expect(await isArchive(new File(['{"app":"inksprite"}'], 'backup.json'))).toBe(false)
    const scrivener = new Blob([zipSync({ 'Thief.scrivx': strToU8('<ScrivenerProject/>') })])
    expect(await isArchive(scrivener)).toBe(false)
    await expect(readArchive(scrivener)).rejects.toThrow('This zip holds no inksprite backup.')
  })

  it('refuses a backup missing part of itself', async () => {
    const zip = await writeArchive(/** @type {any} */ (sampleBackup()))
    const entries = unzipSync(await bytesOf(zip))
    delete entries['files/1']
    await expect(readArchive(new Blob([zipSync(entries)]))).rejects.toThrow('missing a file')
  })
})
