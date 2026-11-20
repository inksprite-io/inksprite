// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { RECORD_MOST, appReads } from '../../electron/src/appReads.js'

/** @type {string} */
let folder

beforeEach(async () => {
  folder = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'app-reads-test-')), 'app-reads')
})

afterEach(async () => {
  await fs.rm(path.dirname(folder), { recursive: true, force: true })
})

const record = (revision = 'r1') => ({
  storyId: 'story_a',
  document: 'doc_1',
  revision,
  text: 'Text.',
})

describe('appReads', () => {
  it('has nothing for a document a connection has not read', async () => {
    const reads = appReads(folder)
    expect(await reads.get('app_1', 'doc_1')).toBeNull()
    expect(await reads.all('app_1')).toEqual([])
  })

  it('keeps what a connection has of a document, in place of what it had', async () => {
    const reads = appReads(folder)
    await reads.put('app_1', 'doc_1', record('r1'))
    await reads.put('app_1', 'doc_1', record('r2'))

    expect(await reads.get('app_1', 'doc_1')).toEqual(record('r2'))
    expect(await appReads(folder).get('app_1', 'doc_1')).toEqual(record('r2'))
  })

  it('keeps each connection’s apart, in files only the writer reads', async () => {
    const reads = appReads(folder)
    await reads.put('app_1', 'doc_1', record('mine'))
    await reads.put('app_2', 'doc_1', record('theirs'))

    expect((await reads.get('app_1', 'doc_1')).revision).toBe('mine')
    expect((await reads.get('app_2', 'doc_1')).revision).toBe('theirs')
    const file = path.join(folder, 'app_1', 'doc_1.json')
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600)
    expect((await fs.stat(path.dirname(file))).mode & 0o777).toBe(0o700)
  })

  it('lists everything kept for a connection', async () => {
    const reads = appReads(folder)
    await reads.put('app_1', 'doc_1', record('a'))
    await reads.put('app_1', 'doc_2', { ...record('b'), document: 'doc_2' })
    await reads.put('app_2', 'doc_3', record('c'))

    const all = await reads.all('app_1')
    expect(all.map(one => one.revision).sort()).toEqual(['a', 'b'])
  })

  it('forgets a connection’s when it is removed, and no other’s', async () => {
    const reads = appReads(folder)
    await reads.put('app_1', 'doc_1', record())
    await reads.put('app_2', 'doc_1', record())

    await reads.forget('app_1')
    await reads.forget('app_none')

    expect(await reads.get('app_1', 'doc_1')).toBeNull()
    expect(await reads.get('app_2', 'doc_1')).toEqual(record())
  })

  it('takes only ids for names, so nothing is written outside its folder', async () => {
    const reads = appReads(folder)
    for (const [connection, document] of [
      ['../elsewhere', 'doc_1'],
      ['app_1', '../../apps'],
      ['app_1', 'a/b'],
      ['', 'doc_1'],
      ['app_1', 'x'.repeat(101)],
      [undefined, 'doc_1'],
      ['app_1', 7],
    ]) {
      await expect(reads.put(connection, document, record())).rejects.toThrow('Not an id')
      await expect(reads.get(connection, document)).rejects.toThrow('Not an id')
    }
    await expect(reads.all('..')).rejects.toThrow('Not an id')
    await expect(reads.forget('../..')).rejects.toThrow('Not an id')
    expect(await fs.readdir(path.dirname(folder))).toEqual([])
  })

  it('refuses what isn’t a record, or is larger than one could be', async () => {
    const reads = appReads(folder)
    await expect(reads.put('app_1', 'doc_1', 'text')).rejects.toThrow('object')
    await expect(reads.put('app_1', 'doc_1', [1])).rejects.toThrow('object')
    await expect(reads.put('app_1', 'doc_1', null)).rejects.toThrow('object')
    await expect(reads.put('app_1', 'doc_1', { text: 'x'.repeat(RECORD_MOST) })).rejects.toThrow(
      'too large'
    )
    expect(await reads.get('app_1', 'doc_1')).toBeNull()
  })

  it('reads a file that is not a record as none', async () => {
    const reads = appReads(folder)
    await fs.mkdir(path.join(folder, 'app_1'), { recursive: true })
    await fs.writeFile(path.join(folder, 'app_1', 'doc_1.json'), 'not json')
    await fs.writeFile(path.join(folder, 'app_1', 'doc_2.json'), '"text"')
    await fs.writeFile(path.join(folder, 'app_1', 'notes.txt'), '{}')

    expect(await reads.get('app_1', 'doc_1')).toBeNull()
    expect(await reads.all('app_1')).toEqual([])
  })
})
