// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BYTES_MOST, HELD_MOST, LIFE, appExports } from '../../electron/src/appExports.js'

const FILE = { name: 'Plan.md', bytes: new Uint8Array([35, 32, 80]) }

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('appExports', () => {
  it('holds a file under an id nobody could guess, a new one each time', () => {
    const exports = appExports()

    const { id } = exports.offer('app_1', FILE)
    const other = exports.offer('app_1', FILE)

    // 32 random bytes, in letters a link takes as they are.
    expect(id).toMatch(/^[\w-]{43}$/)
    expect(other.id).not.toBe(id)
  })

  it('hands it over once', () => {
    const exports = appExports()
    const { id } = exports.offer('app_1', FILE)

    const taken = exports.take(id)
    expect(taken.name).toBe('Plan.md')
    expect([...taken.bytes]).toEqual([35, 32, 80])

    expect(exports.take(id)).toBeNull()
    expect(exports.size).toBe(0)
  })

  it('keeps its own copy of the bytes', () => {
    const exports = appExports()
    const bytes = new Uint8Array([1, 2, 3])
    const { id } = exports.offer('app_1', { name: 'a.bin', bytes })
    bytes.fill(9)

    expect([...exports.take(id).bytes]).toEqual([1, 2, 3])
  })

  it('lets it go when its few minutes are up', () => {
    const exports = appExports()
    const { id } = exports.offer('app_1', FILE)

    vi.advanceTimersByTime(LIFE - 1)
    expect(exports.size).toBe(1)
    vi.advanceTimersByTime(1)

    expect(exports.take(id)).toBeNull()
  })

  it('has nothing under an id it never made', () => {
    const exports = appExports()
    exports.offer('app_1', FILE)

    for (const id of ['', 'nothing', '../Plan.md', 'a'.repeat(43)]) {
      expect(exports.take(id), id).toBeNull()
    }
    expect(exports.size).toBe(1)
  })

  it('holds only so many for a connection, the latest, and counts each connection apart', () => {
    const exports = appExports()
    const ids = Array.from({ length: HELD_MOST + 2 }, () => exports.offer('app_1', FILE).id)
    const others = exports.offer('app_2', FILE).id

    expect(exports.size).toBe(HELD_MOST + 1)
    expect(exports.take(ids[0])).toBeNull()
    expect(exports.take(ids[1])).toBeNull()
    expect(exports.take(ids[2])).not.toBeNull()
    expect(exports.take(ids.at(-1))).not.toBeNull()
    expect(exports.take(others)).not.toBeNull()
  })

  it('lets go of what was held for a connection that is removed, and no other’s', () => {
    const exports = appExports()
    const gone = exports.offer('app_1', FILE).id
    const kept = exports.offer('app_2', FILE).id

    exports.forget('app_1')

    expect(exports.take(gone)).toBeNull()
    expect(exports.take(kept)).not.toBeNull()
  })

  it('refuses what is not a named file of a size it can hold', () => {
    const exports = appExports()

    expect(() => exports.offer('', FILE)).toThrow('No such connection')
    expect(() => exports.offer(undefined, FILE)).toThrow('No such connection')
    for (const name of ['', 7, undefined, 'a/b.md', '..\\b.md', 'a\0.md', 'x'.repeat(256)]) {
      expect(() => exports.offer('app_1', { ...FILE, name }), String(name)).toThrow(
        'a file with a name'
      )
    }
    for (const bytes of [undefined, 'text', [1, 2], new ArrayBuffer(2)]) {
      expect(() => exports.offer('app_1', { name: 'a.md', bytes })).toThrow('a file with a name')
    }
    expect(() =>
      exports.offer('app_1', { name: 'a.tar', bytes: { length: BYTES_MOST + 1 } })
    ).toThrow('a file with a name')
    expect(exports.size).toBe(0)
  })

  it('refuses a file larger than it holds', () => {
    const exports = appExports()
    // A view that says it is too long, without the memory of one that is.
    const bytes = new Uint8Array(1)
    Object.defineProperty(bytes, 'length', { value: BYTES_MOST + 1 })

    expect(() => exports.offer('app_1', { name: 'a.tar', bytes })).toThrow(
      'more than can be handed over'
    )
  })
})
