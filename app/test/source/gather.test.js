/* global File, AbortController, TextEncoder */
import { describe, it, expect, vi } from 'vitest'
import {
  entriesOfFolder,
  gatherSource,
  sortEntries,
  MAX_FILE_BYTES,
  MAX_WHOLE_BYTES,
  MAX_WHOLE_FILE_BYTES,
  SourceTooLargeError,
} from '@/source/gather.js'

/**
 * An entry for each `[path, text]`, read from memory and counted.
 * @param {Array<[string, string|Uint8Array]>} files
 */
const entriesOf = files => {
  const reads = []
  const entries = files.map(([path, body]) => {
    const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body
    return {
      path,
      size: bytes.length,
      read: () => {
        reads.push(path)
        return bytes
      },
    }
  })
  return { entries, reads }
}

describe('gatherSource', () => {
  it('keeps the text, in path order, and says what it left out and why', async () => {
    const { entries } = entriesOf([
      ['src/b.ts', 'export const b = 2\n'],
      ['src/a.ts', 'export const a = 1\n'],
      ['node_modules/x/index.js', 'module.exports = 1'],
      ['.env', 'SECRET=1'],
      ['dist/out.js', 'compiled'],
      ['font.woff2', new Uint8Array([0x77, 0x4f, 0x46, 0x32])],
      ['data.bin2', new Uint8Array([0x01, 0x00, 0x02])],
    ])

    const { files, left, bytes } = await gatherSource(entries)

    expect(files.map(file => file.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(files[0]).toMatchObject({ text: 'export const a = 1\n', size: 19 })
    expect(bytes).toBe(38)
    expect(left).toEqual({
      never: 2,
      ignored: 1,
      binary: ['font.woff2', 'data.bin2'],
      large: [],
    })
  })

  it('takes a PDF, a book, a Word file and a picture whole, bytes and all', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])
    const { entries } = entriesOf([
      ['docs/spec.pdf', '%PDF-1.7 not much of one'],
      ['docs/guide.epub', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0])],
      ['docs/notes.DOCX', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0])],
      ['assets/logo.png', png],
      ['src/a.ts', 'a'],
    ])

    const { files, left, bytes, wholeBytes } = await gatherSource(entries)

    expect(files.map(file => file.path)).toEqual([
      'assets/logo.png',
      'docs/guide.epub',
      'docs/notes.DOCX',
      'docs/spec.pdf',
      'src/a.ts',
    ])
    expect(files[0]).toEqual({
      path: 'assets/logo.png',
      text: '',
      size: 6,
      bytes: png,
      mime: 'image/png',
    })
    // Taken whole even where the bytes would pass for text.
    expect(files[3]).toMatchObject({ text: '', mime: 'application/pdf' })
    expect(files[2].mime).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
    expect(files[4]).toMatchObject({ text: 'a' })
    expect(files[4].bytes).toBeUndefined()
    expect(bytes).toBe(1)
    expect(wholeBytes).toBe(24 + 5 + 5 + 6)
    expect(left.binary).toEqual([])
  })

  it('leaves out a whole file only past a size of its own', async () => {
    const entry = (path, size) => ({ path, size, read: vi.fn(() => new Uint8Array(size)) })
    const entries = [
      entry('docs/scan.pdf', MAX_FILE_BYTES * 4),
      entry('docs/huge.pdf', MAX_WHOLE_FILE_BYTES + 1),
    ]

    const { files, left } = await gatherSource(entries)

    expect(files.map(file => file.path)).toEqual(['docs/scan.pdf'])
    expect(left.large).toEqual(['docs/huge.pdf'])
    expect(entries[1].read).not.toHaveBeenCalled()
  })

  it('reads nothing it leaves out by name, size or rule', async () => {
    const { entries, reads } = entriesOf([
      ['src/a.ts', 'a'],
      ['node_modules/x.js', 'x'],
      ['font.woff2', 'not really a font'],
      ['big.json', 'x'.repeat(MAX_FILE_BYTES + 1)],
    ])

    const { left } = await gatherSource(entries)

    expect(reads).toEqual(['src/a.ts'])
    expect(left.large).toEqual(['big.json'])
  })

  it("follows the codebase's .gitignore files, reading them first", async () => {
    const { entries } = entriesOf([
      ['src/keep.ts', 'k'],
      ['src/gen/out.ts', 'g'],
      ['tools/notes.txt', 'n'],
      ['tools/.gitignore', '*.txt\n'],
      ['.gitignore', 'src/gen/\n'],
    ])

    const { files, left } = await gatherSource(entries)

    expect(files.map(file => file.path)).toEqual(['.gitignore', 'src/keep.ts', 'tools/.gitignore'])
    expect(left.ignored).toBe(2)
  })

  it('applies only the two lists when told not to read .gitignore files', async () => {
    const { entries } = entriesOf([
      ['src/gen/out.ts', 'g'],
      ['.gitignore', 'src/gen/\n'],
    ])

    const { kept } = await sortEntries(entries, { gitignores: false })

    expect(kept.map(entry => entry.path)).toEqual(['src/gen/out.ts', '.gitignore'])
  })

  it('stops before reading anything when there is more than it can take', async () => {
    const entries = Array.from({ length: 5001 }, (_, at) => ({
      path: `src/f${at}.ts`,
      size: 1,
      read: vi.fn(() => new Uint8Array([0x61])),
    }))

    await expect(gatherSource(entries)).rejects.toBeInstanceOf(SourceTooLargeError)
    expect(entries[0].read).not.toHaveBeenCalled()
  })

  it('stops when the files that come in whole are more than it can take', async () => {
    const count = Math.ceil(MAX_WHOLE_BYTES / MAX_WHOLE_FILE_BYTES) + 1
    const entries = Array.from({ length: count }, (_, at) => ({
      path: `scans/p${at}.pdf`,
      size: MAX_WHOLE_FILE_BYTES,
      read: vi.fn(() => new Uint8Array()),
    }))

    const failure = gatherSource(entries)
    await expect(failure).rejects.toBeInstanceOf(SourceTooLargeError)
    await expect(failure).rejects.toThrow(
      /MB of PDFs, documents and pictures, over the limit of 200 MB/
    )
    expect(entries[0].read).not.toHaveBeenCalled()
  })

  it('tells what it will read before reading it, and says how far it is', async () => {
    const { entries } = entriesOf([
      ['a.ts', 'a'],
      ['b.ts', 'b'],
    ])
    const prepare = vi.fn()
    const onProgress = vi.fn()

    await gatherSource(entries, { prepare, onProgress })

    expect(prepare).toHaveBeenCalledWith([entries[0], entries[1]])
    expect(onProgress).toHaveBeenLastCalledWith(2, 2)
  })

  it('stops when its signal is aborted', async () => {
    const { entries } = entriesOf([['a.ts', 'a']])
    const controller = new AbortController()
    controller.abort()

    await expect(gatherSource(entries, { signal: controller.signal })).rejects.toThrow()
  })
})

describe('entriesOfFolder', () => {
  it("takes the folder's name and gives paths below it", async () => {
    const file = (name, text) => new File([text], name)

    const { name, entries } = entriesOfFolder([
      { file: file('index.ts', 'export {}'), folders: ['server', 'src'] },
      { file: file('README.md', '# Server'), folders: ['server'] },
    ])

    expect(name).toBe('server')
    expect(entries.map(entry => entry.path)).toEqual(['src/index.ts', 'README.md'])
    expect(new TextDecoder().decode(await entries[1].read())).toBe('# Server')
  })
})
