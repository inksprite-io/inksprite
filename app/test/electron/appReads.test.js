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

  it('lists only the fields asked for, for a caller that wants no document’s text', async () => {
    const reads = appReads(folder)
    await reads.put('app_1', 'doc_1', { ...record('a'), path: 'Plan' })
    await reads.put('app_1', 'doc_2', { storyId: 'story_b', document: 'doc_2', revision: 'b' })

    const about = await reads.all('app_1', ['storyId', 'document', 'path', 'revision'])
    expect(about.sort((a, b) => a.document.localeCompare(b.document))).toEqual([
      { storyId: 'story_a', document: 'doc_1', path: 'Plan', revision: 'a' },
      // A field a record doesn't have is left out, not made up.
      { storyId: 'story_b', document: 'doc_2', revision: 'b' },
    ])
    // Nothing a record inherits is a field of it.
    expect(await reads.all('app_1', ['constructor', 'toString'])).toEqual([{}, {}])
    await expect(reads.all('app_1', 'text')).rejects.toThrow('list')
    await expect(reads.all('app_1', [1])).rejects.toThrow('list')
  })

  it('forgets what was kept of documents, for one connection or for every one', async () => {
    const reads = appReads(folder)
    for (const connection of ['app_1', 'app_2']) {
      for (const document of ['doc_1', 'doc_2', 'doc_3']) {
        await reads.put(connection, document, { ...record(), document })
      }
    }

    // Told that one is gone: that connection's record of it, and no other.
    await reads.forgetDocuments(['doc_1'], 'app_1')
    expect(await reads.get('app_1', 'doc_1')).toBeNull()
    expect(await reads.get('app_2', 'doc_1')).not.toBeNull()
    expect(await reads.get('app_1', 'doc_2')).not.toBeNull()

    // Deleted for good: everyone's, the files with their text gone from the disk.
    await reads.forgetDocuments(['doc_1', 'doc_2', 'doc_never_read'])
    for (const connection of ['app_1', 'app_2']) {
      expect(await fs.readdir(path.join(folder, connection))).toEqual(['doc_3.json'])
    }
  })

  it('forgets nothing for what is not a list of ids, and is at ease with nothing kept', async () => {
    const reads = appReads(folder)
    await reads.forgetDocuments(['doc_1'])
    await reads.forgetWhere(() => true)

    await reads.put('app_1', 'doc_1', record())
    await expect(reads.forgetDocuments('doc_1')).rejects.toThrow('list')
    // An id no record could be kept under is passed over, and the rest go.
    await reads.forgetDocuments(['../../apps', 'a/b', 7, 'doc_1'])
    expect(await reads.get('app_1', 'doc_1')).toBeNull()
    await reads.put('app_1', 'doc_1', record())
    await expect(reads.forgetDocuments(['doc_1'], '../app_1')).rejects.toThrow('id')
    expect(await reads.get('app_1', 'doc_1')).toEqual(record())
  })

  it('forgets the records a test picks out, for one connection or for every one', async () => {
    const reads = appReads(folder)
    for (const connection of ['app_1', 'app_2']) {
      await reads.put(connection, 'doc_1', { ...record(), storyId: 'story_a' })
      await reads.put(connection, 'doc_2', { ...record(), document: 'doc_2', storyId: 'story_b' })
    }
    const inA = one => one.storyId === 'story_a'

    await reads.forgetWhere(inA, 'app_1')
    expect((await reads.all('app_1')).map(one => one.document)).toEqual(['doc_2'])
    expect(await reads.all('app_2')).toHaveLength(2)

    await reads.forgetWhere(inA)
    expect((await reads.all('app_2')).map(one => one.document)).toEqual(['doc_2'])
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
