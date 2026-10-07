/* global Response, AbortController, DOMException */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { describePicked, fetchPicked, requestFor } from '@/drive/fetch.js'
import { DriveError, SignInLapsedError } from '@/drive/errors.js'

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
