/* global File, AbortController, TextEncoder */
import { describe, it, expect, vi } from 'vitest'
import {
  entriesOfFolder,
  gatherSource,
  sortEntries,
  MAX_FILE_BYTES,
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
      ['logo.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
      ['data.bin2', new Uint8Array([0x01, 0x00, 0x02])],
    ])

    const { files, left, bytes } = await gatherSource(entries)

    expect(files.map(file => file.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(files[0]).toMatchObject({ text: 'export const a = 1\n', size: 19 })
    expect(bytes).toBe(38)
    expect(left).toEqual({
      never: 2,
      ignored: 1,
      binary: ['logo.png', 'data.bin2'],
      large: [],
    })
  })

  it('reads nothing it leaves out by name, size or rule', async () => {
    const { entries, reads } = entriesOf([
      ['src/a.ts', 'a'],
      ['node_modules/x.js', 'x'],
      ['logo.png', 'not really a picture'],
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
  it("takes the chosen folder's name and gives paths below it", async () => {
    const file = (path, text) => {
      const made = new File([text], path.split('/').pop())
      Object.defineProperty(made, 'webkitRelativePath', { value: path })
      return made
    }

    const { name, entries } = entriesOfFolder([
      file('server/src/index.ts', 'export {}'),
      file('server/README.md', '# Server'),
    ])

    expect(name).toBe('server')
    expect(entries.map(entry => entry.path)).toEqual(['src/index.ts', 'README.md'])
    expect(new TextDecoder().decode(await entries[1].read())).toBe('# Server')
  })
})
