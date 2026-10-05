/* global Blob */
import { describe, it, expect } from 'vitest'
import { deserializeFiles, serializeFiles, upgradeTables } from '@/utils/backup.js'

describe('files in a backup', () => {
  it('writes a file out as base64 with its type, and reads it back as it was', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 255, 128])
    const rows = [{ id: 'doc_1', storyId: 's1', blob: new Blob([bytes], { type: 'image/png' }) }]

    const serialized = await serializeFiles(rows)
    expect(serialized).toEqual([
      { id: 'doc_1', storyId: 's1', mime: 'image/png', data: 'iVBORwD/gA==' },
    ])
    expect(JSON.parse(JSON.stringify(serialized))).toEqual(serialized)

    const [back] = deserializeFiles(serialized)
    expect(back).toMatchObject({ id: 'doc_1', storyId: 's1' })
    expect(back.blob.type).toBe('image/png')
    expect(new Uint8Array(await back.blob.arrayBuffer())).toEqual(bytes)
  })

  it('survives a file larger than one slice of base64', async () => {
    const bytes = new Uint8Array(20000).map((_, i) => i % 251)
    const [row] = await serializeFiles([{ id: 'd', storyId: 's', blob: new Blob([bytes]) }])
    const [back] = deserializeFiles([row])

    expect(new Uint8Array(await back.blob.arrayBuffer())).toEqual(bytes)
  })

  it('makes something of a row with no blob rather than failing the backup', async () => {
    const [row] = await serializeFiles([{ id: 'd', storyId: 's', blob: undefined }])
    expect(row).toEqual({ id: 'd', storyId: 's', mime: '', data: '' })

    const [back] = deserializeFiles([{ id: 'd', storyId: 's' }])
    expect(back.blob.size).toBe(0)
  })

  it('starts the files table empty for a backup taken before v16', () => {
    const out = upgradeTables({ stories: [{ id: 's1' }] }, 15, 16)

    expect(out.files).toEqual([])
    expect(out.stories).toEqual([{ id: 's1' }])
  })

  it('keeps the files a backup already had', () => {
    const files = [{ id: 'd', storyId: 's', mime: 'image/png', data: 'AA==' }]
    const out = upgradeTables({ files }, 15, 16)

    expect(out.files).toBe(files)
  })
})
