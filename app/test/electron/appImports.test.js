// @vitest-environment node
/* global Buffer */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { HELD_MOST, LIFE, appImports } from '../../electron/src/appImports.js'

const ABOUT = { storyId: 'story_a', parentId: 'folder_1', name: 'Notes.md' }
const BYTES = Buffer.from('# Notes\n')

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('appImports', () => {
  it('waits under an id nobody could guess, a new one each time', () => {
    const imports = appImports()

    const { id } = imports.open('app_1', ABOUT)
    const other = imports.open('app_1', ABOUT)

    // 32 random bytes, in letters a link takes as they are.
    expect(id).toMatch(/^[\w-]{43}$/)
    expect(other.id).not.toBe(id)
  })

  it('takes one file by a link, and says what it was for', () => {
    const imports = appImports()
    const { id } = imports.open('app_1', ABOUT)

    expect(imports.arrive(id, BYTES)).toEqual({ connection: 'app_1', about: ABOUT })
    // One file to a link.
    expect(imports.arrive(id, Buffer.from('another'))).toBeNull()
  })

  it('hands the file to its connection once it has come, the once', () => {
    const imports = appImports()
    const { id } = imports.open('app_1', ABOUT)

    expect(imports.take('app_1', id)).toBeNull()
    imports.arrive(id, BYTES)
    expect(imports.take('app_2', id)).toBeNull()

    const taken = imports.take('app_1', id)
    expect(taken.about).toEqual(ABOUT)
    expect(taken.bytes.toString()).toBe('# Notes\n')
    expect(imports.take('app_1', id)).toBeNull()
    expect(imports.size).toBe(0)
  })

  it('keeps what a link is for as it was given, not as it is changed after', () => {
    const imports = appImports()
    const about = { ...ABOUT }
    const { id } = imports.open('app_1', about)
    about.parentId = 'somewhere_else'

    expect(imports.arrive(id, BYTES).about.parentId).toBe('folder_1')
  })

  it('lets a link go when its few minutes are up, and a file that waited as long again', () => {
    const imports = appImports()
    const unused = imports.open('app_1', ABOUT).id
    vi.advanceTimersByTime(LIFE)
    expect(imports.arrive(unused, BYTES)).toBeNull()

    const { id } = imports.open('app_1', ABOUT)
    vi.advanceTimersByTime(LIFE - 1)
    imports.arrive(id, BYTES)
    vi.advanceTimersByTime(LIFE - 1)
    expect(imports.size).toBe(1)
    vi.advanceTimersByTime(1)
    expect(imports.take('app_1', id)).toBeNull()
  })

  it('has nothing under an id it never made', () => {
    const imports = appImports()
    imports.open('app_1', ABOUT)

    for (const id of ['', 'nothing', 'a'.repeat(43), undefined, 42]) {
      expect(imports.arrive(/** @type {any} */ (id), BYTES)).toBeNull()
      expect(imports.take('app_1', id)).toBeNull()
    }
  })

  it('lets go of a link once its page is done, taken or not', () => {
    const imports = appImports()
    const { id } = imports.open('app_1', ABOUT)
    imports.arrive(id, BYTES)

    imports.done(id)

    expect(imports.take('app_1', id)).toBeNull()
    expect(imports.size).toBe(0)
  })

  it('holds a few links for each connection, the oldest going first', () => {
    const imports = appImports()
    const ids = Array.from({ length: HELD_MOST + 1 }, () => imports.open('app_1', ABOUT).id)
    const theirs = imports.open('app_2', ABOUT).id

    expect(imports.arrive(ids[0], BYTES)).toBeNull()
    for (const id of ids.slice(1)) expect(imports.arrive(id, BYTES)).not.toBeNull()
    expect(imports.arrive(theirs, BYTES)).not.toBeNull()
  })

  it('forgets a connection’s links when it goes, and everything when asked', () => {
    const imports = appImports()
    const mine = imports.open('app_1', ABOUT).id
    const theirs = imports.open('app_2', ABOUT).id

    imports.forget('app_1')
    expect(imports.arrive(mine, BYTES)).toBeNull()
    expect(imports.arrive(theirs, BYTES)).not.toBeNull()

    imports.clear()
    expect(imports.size).toBe(0)
  })

  it('refuses a link for no connection, or for nothing it can keep', () => {
    const imports = appImports()

    expect(() => imports.open('', ABOUT)).toThrow('No such connection.')
    for (const about of [null, 'Notes.md', ['a'], { name: 'x'.repeat(5000) }]) {
      expect(() => imports.open('app_1', about), JSON.stringify(about)).toThrow(
        'An import says what it is for.'
      )
    }
  })
})
