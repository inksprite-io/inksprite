/* global File */
import { describe, it, expect, vi } from 'vitest'
import {
  MAX_FILE_BYTES,
  MAX_TEXT_BYTES,
  PARQUET_MIME,
  extensionFor,
  inspectFile,
  isImage,
  isText,
  isUnreadText,
  mimeOf,
  titleOf,
  UNKNOWN_MIME,
} from '@/files/inspect.js'
import { barePng, minimalPdf } from './helpers.js'

const file = (name, data, type = '') => new File([data], name, { type })

describe('refuseTooLarge', () => {
  const sized = (/** @type {number} */ size) => {
    const made = new File(['a,b'], 'flights.csv', { type: 'text/csv' })
    Object.defineProperty(made, 'size', { value: size })
    return made
  }

  it('says what was too large, and what a project can keep', async () => {
    await expect(inspectFile(sized(MAX_FILE_BYTES + 1))).rejects.toThrow(
      '"flights.csv" is too large. A project can keep files of up to 1 GB.'
    )
  })

  it('takes a file of exactly the limit', async () => {
    expect((await inspectFile(sized(MAX_FILE_BYTES))).text).toBe('')
  })
})

describe('isUnreadText', () => {
  const over = MAX_TEXT_BYTES + 1

  it('is a file of text over the limit with no text', () => {
    expect(isUnreadText({ mime: 'text/csv', size: over, content: '' })).toBe(true)
    expect(isUnreadText({ mime: 'text/csv', size: over })).toBe(true)
  })

  it('is not one that came in with its text, from before there was a limit', () => {
    expect(isUnreadText({ mime: 'text/csv', size: over, content: 'a,b' })).toBe(false)
  })

  it('is not an empty file, or a small one', () => {
    expect(isUnreadText({ mime: 'text/csv', size: 0, content: '' })).toBe(false)
    expect(isUnreadText({ mime: 'text/csv', size: MAX_TEXT_BYTES, content: '' })).toBe(false)
  })

  it('is not a large file of any other kind', () => {
    expect(isUnreadText({ mime: 'application/pdf', size: over, content: '' })).toBe(false)
    expect(isUnreadText({ mime: 'image/png', size: over, content: '' })).toBe(false)
  })

  it('is nothing for no document', () => {
    expect(isUnreadText(null)).toBe(false)
    expect(isUnreadText(undefined)).toBe(false)
  })
})

describe('mimeOf', () => {
  it('takes what the browser said first', () => {
    expect(mimeOf('paper.pdf', 'application/pdf')).toBe('application/pdf')
    expect(mimeOf('odd.bin', 'image/png')).toBe('image/png')
  })

  it('reads the extension when the browser said nothing', () => {
    expect(mimeOf('paper.PDF')).toBe('application/pdf')
    expect(mimeOf('photo.jpeg')).toBe('image/jpeg')
    expect(mimeOf('notes.csv')).toBe('text/csv')
  })

  it('calls the rest bytes', () => {
    expect(mimeOf('archive.tar.zst')).toBe(UNKNOWN_MIME)
    expect(mimeOf('README')).toBe(UNKNOWN_MIME)
  })
})

describe('extensionFor', () => {
  it('gives a type its usual extension', () => {
    expect(extensionFor('application/pdf')).toBe('pdf')
    expect(extensionFor('image/jpeg')).toBe('jpg')
  })

  it('has none for a type it has never heard of', () => {
    expect(extensionFor(UNKNOWN_MIME)).toBe('')
  })
})

describe('titleOf', () => {
  it('is the name without its extension', () => {
    expect(titleOf('Notes on tide tables.pdf')).toBe('Notes on tide tables')
    expect(titleOf('paper.v2.pdf')).toBe('paper.v2')
  })

  it('keeps a name that is nothing but an extension', () => {
    expect(titleOf('.hidden')).toBe('.hidden')
  })

  it('has a name for an empty one', () => {
    expect(titleOf('')).toBe('Untitled')
  })

  it('keeps the extension of a data file, which tells code how to read it', () => {
    expect(titleOf('trips.parquet', PARQUET_MIME)).toBe('trips.parquet')
  })

  it('keeps the extension of anything shown as plain text but prose', () => {
    expect(titleOf('foo.cpp', 'text/x-c++')).toBe('foo.cpp')
    expect(titleOf('data.csv', 'text/csv')).toBe('data.csv')
    expect(titleOf('settings.json', 'application/json')).toBe('settings.json')
    expect(titleOf('Chapter one.md', 'text/markdown')).toBe('Chapter one')
    expect(titleOf('notes.txt', 'text/plain')).toBe('notes')
    expect(titleOf('page.html', 'text/html')).toBe('page')
    expect(titleOf('logo.svg', 'image/svg+xml')).toBe('logo')
  })
})

describe('isImage and isText', () => {
  it('know a picture and a text from their types', () => {
    expect(isImage('image/png')).toBe(true)
    expect(isImage('application/pdf')).toBe(false)
    expect(isText('text/plain')).toBe(true)
    expect(isText('application/json')).toBe(true)
    expect(isText('image/svg+xml')).toBe(true)
    expect(isText('application/pdf')).toBe(false)
  })
})

describe('inspectFile', () => {
  it('reads a PDF out page by page, and says how many pages it has', async () => {
    const found = await inspectFile(
      file('paper.pdf', minimalPdf([['Abstract'], ['Method']]), 'application/pdf')
    )

    expect(found).toMatchObject({
      title: 'paper',
      mime: 'application/pdf',
      pages: 2,
      text: '[p.1]\nAbstract\n\n[p.2]\nMethod',
    })
    expect(found.size).toBeGreaterThan(0)
    expect(found.blob).toBeInstanceOf(File)
  })

  it('says a scanned PDF has no text', async () => {
    const found = await inspectFile(file('scan.pdf', minimalPdf([[]]), 'application/pdf'))

    expect(found.text).toBe('')
    expect(found.pages).toBe(1)
  })

  it('takes a text file as its own text', async () => {
    const found = await inspectFile(file('data.csv', 'a,b\n1,2', 'text/csv'))

    expect(found).toMatchObject({ title: 'data.csv', mime: 'text/csv', text: 'a,b\n1,2' })
    expect(found.pages).toBeUndefined()
  })

  it('has no text for an image, even one that is text underneath', async () => {
    const png = await inspectFile(file('holiday.png', barePng(), 'image/png'))
    const svg = await inspectFile(file('logo.svg', '<svg/>', 'image/svg+xml'))

    expect(png.text).toBe('')
    expect(svg.text).toBe('')
    expect(svg.mime).toBe('image/svg+xml')
  })

  it('keeps anything else as bytes with no text', async () => {
    const found = await inspectFile(file('model.gguf', new Uint8Array([1, 2, 3])))

    expect(found).toMatchObject({ title: 'model', mime: UNKNOWN_MIME, text: '', size: 3 })
  })

  it('takes a file no table knows as the text it turns out to be, typed by its name', async () => {
    const source = await inspectFile(file('foo.cpp', '#include "foo.h"\r\nint main() {}\r\n'))
    const header = await inspectFile(file('foo.h', '#pragma once\n'))
    const make = await inspectFile(file('Makefile', 'all:\n\tcc foo.cpp\n'))
    const log = await inspectFile(file('server.log', 'started\n'))

    expect(source).toMatchObject({
      title: 'foo.cpp',
      mime: 'text/x-c++',
      text: '#include "foo.h"\nint main() {}\n',
    })
    expect(source.blob.type).toBe('text/x-c++')
    expect(header).toMatchObject({ title: 'foo.h', mime: 'text/x-c', text: '#pragma once\n' })
    expect(make).toMatchObject({ title: 'Makefile', mime: 'text/x-makefile' })
    expect(log).toMatchObject({ title: 'server.log', mime: 'text/plain', text: 'started\n' })
  })

  it('reads text the browser gave another type', async () => {
    const script = await inspectFile(file('build.sh', 'echo hi\n', 'application/x-sh'))
    const typescript = await inspectFile(file('main.ts', 'export {}\n', 'video/mp2t'))
    const video = await inspectFile(
      file('clip.ts', new Uint8Array([0x47, 0x40, 0, 0x10]), 'video/mp2t')
    )

    expect(script).toMatchObject({ mime: 'text/x-sh', text: 'echo hi\n' })
    expect(typescript).toMatchObject({ title: 'main.ts', mime: 'text/x-typescript' })
    expect(video).toMatchObject({ title: 'clip', mime: 'video/mp2t', text: '' })
  })

  it('keeps a type it keeps as bytes on purpose, even when its bytes are text', async () => {
    const found = await inspectFile(file('letter.rtf', '{\\rtf1 Dear sir}', 'application/rtf'))

    expect(found).toMatchObject({ title: 'letter', mime: 'application/rtf', text: '' })
  })

  describe('a file of text too large to read', () => {
    /** A file saying it is over the limit, whose text would throw if it were read. */
    const large = (name, type = '', top = 'a,b\n1,2\n') => {
      const made = new File([top], name, { type })
      Object.defineProperty(made, 'size', { value: MAX_TEXT_BYTES + 1 })
      made.text = vi.fn(() => Promise.reject(new Error('read')))
      made.arrayBuffer = vi.fn(() => Promise.reject(new Error('read')))
      return made
    }

    it('comes in with its bytes and no text, keeping its name and type', async () => {
      const csv = large('flights.csv', 'text/csv')
      const found = await inspectFile(csv)

      expect(found).toMatchObject({ title: 'flights.csv', mime: 'text/csv', text: '' })
      expect(found.blob).toBe(csv)
      expect(csv.text).not.toHaveBeenCalled()
      expect(csv.arrayBuffer).not.toHaveBeenCalled()
    })

    it('is typed by its top when no table knows it', async () => {
      expect(await inspectFile(large('events.jsonl'))).toMatchObject({
        title: 'events.jsonl',
        mime: 'text/plain',
        text: '',
      })
    })

    it('is kept as what it is when its top is not text', async () => {
      expect(await inspectFile(large('dump.bin', '', 'a\0b'))).toMatchObject({
        mime: UNKNOWN_MIME,
        text: '',
      })
    })

    it('leaves a web page unread as well', async () => {
      expect(await inspectFile(large('page.html', 'text/html', '<p>hi</p>'))).toMatchObject({
        mime: 'text/html',
        text: '',
      })
    })

    it('reads a file of exactly the limit', async () => {
      const edge = new File(['a,b\n'], 'edge.csv', { type: 'text/csv' })
      Object.defineProperty(edge, 'size', { value: MAX_TEXT_BYTES })

      expect((await inspectFile(edge)).text).toBe('a,b\n')
    })
  })

  it('keeps a Parquet file as bytes, by its name, whatever its top looks like', async () => {
    const found = await inspectFile(file('trips.parquet', 'PAR1 looks like text'))

    expect(found).toMatchObject({ title: 'trips.parquet', mime: PARQUET_MIME, text: '' })
    expect(found.blob.type).toBe(PARQUET_MIME)
  })

  it('reads a UTF-16 text file by its byte-order mark', async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, ...[...'Hi\r\n'].flatMap(c => [c.charCodeAt(0), 0])])
    const found = await inspectFile(file('notes.txt', utf16, 'text/plain'))

    expect(found).toMatchObject({ title: 'notes', text: 'Hi\n' })
  })

  it('keeps the bytes with the type the name says when the browser said nothing', async () => {
    const found = await inspectFile(file('paper.pdf', minimalPdf([['Hello']])))

    expect(found.mime).toBe('application/pdf')
    expect(found.blob.type).toBe('application/pdf')
    expect(found.blob.size).toBe(found.size)

    const typed = file('data.csv', 'a,b', 'text/csv')
    expect((await inspectFile(typed)).blob).toBe(typed)
  })

  it('refuses a PDF that is not one', async () => {
    await expect(inspectFile(file('fake.pdf', 'hello', 'application/pdf'))).rejects.toThrow()
  })
})
