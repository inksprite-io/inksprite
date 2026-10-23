/* global Response, AbortController, DOMException, btoa */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { convertPicked, describePicked, fetchPicked, linkFor, requestFor } from '@/drive/fetch.js'
import { docOf, inline, para, run, styled } from './docsHelpers.js'
import { DriveError, SignInLapsedError } from '@/drive/errors.js'

/** Whether the tests run as the desktop app, which can fetch a Doc's pictures from their addresses. */
const desktop = vi.hoisted(() => ({ on: true }))
vi.mock('@/platform/fetch.js', () => ({ fetch: (...args) => fetch(...args) }))
vi.mock('@/platform/desktop.js', () => ({ isDesktop: () => desktop.on }))

const FILES = 'https://www.googleapis.com/drive/v3/files'

const picked = (mimeType, name = 'Ch. 3', id = 'abc123') => ({ id, name, mimeType })

describe('requestFor', () => {
  it('exports Google’s own types, and names them for the importer', () => {
    expect(requestFor(picked('application/vnd.google-apps.document'))).toEqual({
      url: `${FILES}/abc123/export?mimeType=text%2Fmarkdown`,
      name: 'Ch. 3.md',
      mime: 'text/markdown',
    })
    expect(requestFor(picked('application/vnd.google-apps.spreadsheet', 'Budget'))).toMatchObject({
      url: `${FILES}/abc123/export?mimeType=text%2Fcsv`,
      name: 'Budget.csv',
      mime: 'text/csv',
    })
    expect(requestFor(picked('application/vnd.google-apps.presentation', 'Pitch'))).toMatchObject({
      name: 'Pitch.pdf',
      mime: 'application/pdf',
    })
    expect(requestFor(picked('application/vnd.google-apps.drawing', 'Map'))).toMatchObject({
      name: 'Map.png',
      mime: 'image/png',
    })
  })

  it('downloads anything else as it is, from a shared drive too', () => {
    expect(requestFor(picked('application/pdf', 'paper.pdf'))).toEqual({
      url: `${FILES}/abc123?alt=media&supportsAllDrives=true`,
      name: 'paper.pdf',
      mime: 'application/pdf',
    })
  })

  it('says why Google’s other types cannot come in', () => {
    expect(requestFor(picked('application/vnd.google-apps.form'))).toEqual({
      skip: 'Google Forms can’t be exported',
    })
    expect(requestFor(picked('application/vnd.google-apps.something-new'))).toEqual({
      skip: 'Files of this kind can’t be exported',
    })
  })

  it('encodes the id', () => {
    expect(requestFor(picked('text/plain', 'a.txt', 'a/b')).url).toContain('/a%2Fb?')
  })
})

describe('linkFor', () => {
  it('links a Doc by its id', () => {
    expect(linkFor(picked('application/vnd.google-apps.document'))).toEqual({ id: 'abc123' })
  })

  it('links nothing else, Word files and markdown included', () => {
    for (const mime of [
      'application/vnd.google-apps.spreadsheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/markdown',
      'application/pdf',
    ]) {
      expect(linkFor(picked(mime))).toBeUndefined()
    }
  })
})

describe('fetchPicked', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const failing = (status, error) =>
    new Response(JSON.stringify({ error }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })

  it('fetches with the token and hands back a File named for the importer', async () => {
    fetchMock.mockResolvedValue(new Response('# Ch. 3\n\nText.\n'))

    const file = await fetchPicked(picked('application/vnd.google-apps.document'), 'tok')

    expect(fetchMock).toHaveBeenCalledWith(
      `${FILES}/abc123/export?mimeType=text%2Fmarkdown`,
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } })
    )
    expect(file.name).toBe('Ch. 3.md')
    expect(file.type).toBe('text/markdown')
    expect(await file.text()).toBe('# Ch. 3\n\nText.\n')
  })

  it('mends a Doc’s export, and leaves a markdown file as it was written', async () => {
    fetchMock.mockImplementation(async () => new Response('Above.  \n---\n\nBelow.\n'))

    const doc = await fetchPicked(picked('application/vnd.google-apps.document'), 'tok')
    const markdown = await fetchPicked(picked('text/markdown', 'notes.md'), 'tok')

    expect(await doc.text()).toBe('Above.\n\n---\n\nBelow.\n')
    expect(await markdown.text()).toBe('Above.  \n---\n\nBelow.\n')
  })

  it('refuses a type that cannot be exported without asking Drive', async () => {
    await expect(
      fetchPicked(picked('application/vnd.google-apps.form'), 'tok')
    ).rejects.toBeInstanceOf(DriveError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('says a Doc is over Drive’s export limit', async () => {
    fetchMock.mockResolvedValue(
      failing(403, {
        errors: [{ reason: 'exportSizeLimitExceeded' }],
        message: 'This file is too large to be exported.',
      })
    )
    await expect(
      fetchPicked(picked('application/vnd.google-apps.document'), 'tok')
    ).rejects.toThrow('Over Drive’s 10 MB export limit')
  })

  it('passes on what Drive said when it refuses for another reason', async () => {
    fetchMock.mockResolvedValue(
      failing(403, { errors: [{ reason: 'rateLimitExceeded' }], message: 'Rate limit exceeded.' })
    )
    await expect(fetchPicked(picked('application/pdf', 'a.pdf'), 'tok')).rejects.toThrow(
      'Drive refused: Rate limit exceeded.'
    )
    fetchMock.mockResolvedValue(new Response('oops', { status: 500 }))
    await expect(fetchPicked(picked('application/pdf', 'a.pdf'), 'tok')).rejects.toThrow(
      'Drive answered 500'
    )
  })

  it('says a file Drive did not give the app was not given', async () => {
    fetchMock.mockResolvedValue(failing(404, { message: 'File not found: abc123.' }))
    await expect(fetchPicked(picked('application/pdf', 'a.pdf'), 'tok')).rejects.toThrow(
      'Drive didn’t give inksprite this file'
    )
  })

  it('stops the batch when the sign-in has run out', async () => {
    fetchMock.mockResolvedValue(failing(401, { message: 'Invalid Credentials' }))
    await expect(fetchPicked(picked('application/pdf', 'a.pdf'), 'tok')).rejects.toBeInstanceOf(
      SignInLapsedError
    )
  })

  it('says Drive could not be reached, but lets a stop through as a stop', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(fetchPicked(picked('application/pdf', 'a.pdf'), 'tok')).rejects.toThrow(
      'Couldn’t reach Drive'
    )

    const controller = new AbortController()
    controller.abort()
    const stopped = new DOMException('Aborted', 'AbortError')
    fetchMock.mockRejectedValue(stopped)
    await expect(
      fetchPicked(picked('application/pdf', 'a.pdf'), 'tok', { signal: controller.signal })
    ).rejects.toBe(stopped)
  })
})

describe('describePicked', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('asks Drive for a picked file’s name and type, from a shared drive too', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'abc',
          name: 'Ch. 3',
          mimeType: 'application/vnd.google-apps.document',
        })
      )
    )

    await expect(describePicked('abc', 'tok')).resolves.toEqual({
      id: 'abc',
      name: 'Ch. 3',
      mimeType: 'application/vnd.google-apps.document',
    })
    expect(fetchMock).toHaveBeenCalledWith(
      `${FILES}/abc?fields=id,name,mimeType&supportsAllDrives=true`,
      expect.objectContaining({ headers: { Authorization: 'Bearer tok' } })
    )
  })

  it('stops the batch when the sign-in has run out', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
    await expect(describePicked('abc', 'tok')).rejects.toBeInstanceOf(SignInLapsedError)
  })
})

describe('convertPicked', () => {
  const fetchMock = vi.fn()
  const doc = picked('application/vnd.google-apps.document')
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reads a Doc through the Docs API into the markdown file its export would be', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify(
          docOf([
            styled('HEADING_1', 'Ch. 3'),
            para([
              run('Kept'),
              run(' new', {}, { suggestedInsertionIds: ['s.1'] }),
              inline('inlineObjectElement', { inlineObjectId: 'kix.i' }),
              run('.'),
            ]),
          ])
        )
      )
    )

    const converted = await convertPicked(doc, 'tok')

    expect(converted).toMatchObject({ images: 1, suggestions: 1 })
    expect(converted?.file).toMatchObject({ name: 'Ch. 3.md', type: 'text/markdown' })
    expect(await converted?.file.text()).toBe('# Ch. 3\n\nKept.')
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'https://docs.googleapis.com/v1/documents/abc123?includeTabsContent=true' +
        '&suggestionsViewMode=SUGGESTIONS_INLINE&commentsViewMode=COMMENTS_VIEW_MODE_INCLUDED'
    )
    expect(init.headers).toEqual({ Authorization: 'Bearer tok' })
  })

  it('fetches a Doc’s pictures from their addresses, and leaves out one that will not come', async () => {
    const document = docOf(
      [
        para([run('A '), inline('inlineObjectElement', { inlineObjectId: 'kix.a' })]),
        para([run('B '), inline('inlineObjectElement', { inlineObjectId: 'kix.b' })]),
      ],
      {
        pictures: {
          'kix.a': { uri: 'https://pictures.example.com/a' },
          'kix.b': { uri: 'https://pictures.example.com/b' },
        },
      }
    )
    fetchMock.mockImplementation(async url => {
      if (String(url).startsWith('https://docs.googleapis.com/')) {
        return new Response(JSON.stringify(document))
      }
      if (String(url).endsWith('/a')) {
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'Content-Type': 'image/jpeg' },
        })
      }
      return new Response('', { status: 403 })
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const converted = await convertPicked(doc, 'tok')

    expect(converted).toMatchObject({ images: 1 })
    expect(converted?.pictures).toEqual([
      {
        marker: 'inksprite-picture-1',
        name: 'image1',
        mime: 'image/jpeg',
        bytes: new Uint8Array([1, 2, 3]),
        docsId: 'kix.a',
      },
    ])
    expect(await converted?.file.text()).toBe('A ![](inksprite-picture-1)\n\nB')
    warn.mockRestore()
  })

  describe('a picture that will not come plainly', () => {
    const twoPictures = () =>
      docOf(
        [
          para([run('A '), inline('inlineObjectElement', { inlineObjectId: 'kix.a' })]),
          para([run('B '), inline('inlineObjectElement', { inlineObjectId: 'kix.b' })]),
        ],
        {
          pictures: {
            'kix.a': { uri: 'https://pictures.example.com/a' },
            'kix.b': { uri: 'https://pictures.example.com/b' },
          },
        }
      )
    const png = bytes =>
      new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'image/png' } })
    /** An export with a picture written in for each of `bytes`, as Google writes them. */
    const exported = (...pictures) =>
      new Response(
        pictures.map((_, i) => `Text ![][image${i + 1}]`).join('\n\n') +
          '\n\n' +
          pictures
            .map(
              (bytes, i) =>
                `[image${i + 1}]: <data:image/png;base64,${btoa(String.fromCharCode(...bytes))}>`
            )
            .join('\n')
      )
    let warn
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })
    afterEach(() => warn.mockRestore())

    it('is asked for again after the wait a 429 asks for', async () => {
      const asked = { a: 0 }
      fetchMock.mockImplementation(async url => {
        if (String(url).startsWith('https://docs.googleapis.com/'))
          return new Response(JSON.stringify(twoPictures()))
        if (String(url).endsWith('/a') && asked.a++ === 0) {
          return new Response('', { status: 429, headers: { 'Retry-After': '0.01' } })
        }
        return png([String(url).endsWith('/a') ? 1 : 2])
      })

      const converted = await convertPicked(doc, 'tok')

      expect(converted?.pictures.map(each => [...each.bytes])).toEqual([[1], [2]])
      const first = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/a'))
      expect(first?.[1]).toMatchObject({ referrerPolicy: 'no-referrer', credentials: 'omit' })
      expect(first?.[1].headers).toBeUndefined()
    })

    it('is asked for with the token when it is refused plainly', async () => {
      fetchMock.mockImplementation(async (url, init) => {
        if (String(url).startsWith('https://docs.googleapis.com/'))
          return new Response(JSON.stringify(twoPictures()))
        return init?.headers?.Authorization === 'Bearer tok'
          ? png([7])
          : new Response('', { status: 403 })
      })

      const converted = await convertPicked(doc, 'tok')

      expect(converted?.pictures.map(each => [...each.bytes])).toEqual([[7], [7]])
    })

    it('comes from the export, matched by place, when it will not come at all', async () => {
      fetchMock.mockImplementation(async url => {
        const at = String(url)
        if (at.startsWith('https://docs.googleapis.com/'))
          return new Response(JSON.stringify(twoPictures()))
        if (at.includes('/export?')) return exported([5], [6])
        if (at.endsWith('/a')) return png([1])
        return new Response('', { status: 429, headers: { 'Retry-After': '0.01' } })
      })

      const converted = await convertPicked(doc, 'tok')

      expect(converted?.pictures.map(each => [each.docsId, [...each.bytes]])).toEqual([
        ['kix.a', [1]],
        ['kix.b', [6]],
      ])
      expect(converted?.images).toBe(0)
    })

    it('comes from the export in a browser, the addresses never asked', async () => {
      desktop.on = false
      fetchMock.mockImplementation(async url => {
        const at = String(url)
        if (at.startsWith('https://docs.googleapis.com/'))
          return new Response(JSON.stringify(twoPictures()))
        if (at.includes('/export?')) return exported([5], [6])
        throw new Error(`asked for ${at}`)
      })

      try {
        const converted = await convertPicked(doc, 'tok')
        expect(converted?.pictures.map(each => [each.docsId, [...each.bytes]])).toEqual([
          ['kix.a', [5]],
          ['kix.b', [6]],
        ])
        expect(
          fetchMock.mock.calls.some(([url]) => String(url).includes('pictures.example.com'))
        ).toBe(false)
      } finally {
        desktop.on = true
      }
    })

    it('is left out when the export’s pictures cannot be matched to the Doc’s', async () => {
      fetchMock.mockImplementation(async url => {
        const at = String(url)
        if (at.startsWith('https://docs.googleapis.com/'))
          return new Response(JSON.stringify(twoPictures()))
        if (at.includes('/export?')) return exported([5])
        if (at.endsWith('/a')) return png([1])
        return new Response('', { status: 403 })
      })

      const converted = await convertPicked(doc, 'tok')

      expect(converted?.pictures.map(each => each.docsId)).toEqual(['kix.a'])
      expect(converted?.images).toBe(1)
      expect(await converted?.file.text()).toBe('A ![](inksprite-picture-1)\n\nB')
    })
  })

  it('leaves to the export a Doc the Docs API refuses, one of several tabs, or one it cannot read', async () => {
    // A Cloud project without the Docs API, or a Doc only viewed.
    fetchMock.mockResolvedValue(new Response('{}', { status: 403 }))
    await expect(convertPicked(doc, 'tok')).resolves.toBeNull()

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(convertPicked(doc, 'tok')).resolves.toBeNull()

    const tabbed = docOf([para('One.')])
    tabbed.tabs?.push({ tabProperties: { tabId: 't.1' }, documentTab: { body: { content: [] } } })
    fetchMock.mockResolvedValue(new Response(JSON.stringify(tabbed)))
    await expect(convertPicked(doc, 'tok')).resolves.toBeNull()

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ tabs: [{}] })))
    await expect(convertPicked(doc, 'tok')).resolves.toBeNull()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('stops the batch when the sign-in has run out, and lets a stop through as a stop', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 401 }))
    await expect(convertPicked(doc, 'tok')).rejects.toBeInstanceOf(SignInLapsedError)

    const controller = new AbortController()
    controller.abort()
    const stopped = new DOMException('Aborted', 'AbortError')
    fetchMock.mockRejectedValue(stopped)
    await expect(convertPicked(doc, 'tok', { signal: controller.signal })).rejects.toBe(stopped)
  })
})
