// @vitest-environment node
/* global Buffer */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  projectOf,
  projectResponse,
  sandboxAllows,
  sandboxFile,
} from '../../electron/src/sandbox.js'

/** The sandbox's folders, and a file beside them it mustn't serve. */
let folders
let base

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'sandbox-'))
  folders = {
    page: path.join(base, 'sandbox'),
    pyodide: path.join(base, 'pyodide'),
    packages: path.join(base, 'python'),
  }
  for (const folder of Object.values(folders)) await mkdir(folder)
  await writeFile(path.join(folders.page, 'index.html'), '<!doctype html>')
  await writeFile(path.join(folders.page, 'worker.js'), '')
  await writeFile(path.join(folders.pyodide, 'pyodide.mjs'), '')
  await writeFile(path.join(folders.packages, 'numpy-2.4.6-cp314-cp314.whl'), '')
  await writeFile(path.join(base, 'main.js'), '')
})

afterAll(() => rm(base, { recursive: true }))

describe('sandboxFile', () => {
  it("answers with the page's own files, and index.html at the root", async () => {
    expect(await sandboxFile('/', folders)).toBe(path.join(folders.page, 'index.html'))
    expect(await sandboxFile('/worker.js', folders)).toBe(path.join(folders.page, 'worker.js'))
  })

  it("answers pyodide/ with Pyodide's files, then the packages' wheels", async () => {
    expect(await sandboxFile('/pyodide/pyodide.mjs', folders)).toBe(
      path.join(folders.pyodide, 'pyodide.mjs')
    )
    expect(await sandboxFile('/pyodide/numpy-2.4.6-cp314-cp314.whl', folders)).toBe(
      path.join(folders.packages, 'numpy-2.4.6-cp314-cp314.whl')
    )
  })

  it('answers nothing that is not there', async () => {
    expect(await sandboxFile('/pyodide/pandas-3.0.whl', folders)).toBeNull()
    expect(await sandboxFile('/pyodide.mjs', folders)).toBeNull()
  })

  it('answers nothing outside its folders', async () => {
    expect(await sandboxFile('/../main.js', folders)).toBeNull()
    expect(await sandboxFile('/%2e%2e/main.js', folders)).toBeNull()
    expect(await sandboxFile('/pyodide/..%2f..%2fmain.js', folders)).toBeNull()
    expect(await sandboxFile('/pyodide/', folders)).toBeNull()
    expect(await sandboxFile('/%E0%A4%A', folders)).toBeNull()
  })
})

describe('sandboxAllows', () => {
  it('lets through only the sandbox’s own files', () => {
    expect(sandboxAllows('sandbox://python/pyodide/pyodide.asm.wasm')).toBe(true)
    expect(sandboxAllows('sandbox://other/')).toBe(false)
    expect(sandboxAllows('http://127.0.0.1:8002/')).toBe(false)
    expect(sandboxAllows('https://sandbox://python/')).toBe(false)
    expect(sandboxAllows('app://inksprite/')).toBe(false)
    expect(sandboxAllows('ws://localhost/')).toBe(false)
  })
})

describe('projectOf', () => {
  it('tells Python each document’s path and size, and keeps what it is read from', () => {
    const { listing, sources } = projectOf([
      { path: 'Rules', folder: true },
      { path: 'Rules/Combat', id: 'doc_1', text: 'über' },
      { path: 'Data/odds.csv', id: 'doc_2', file: '/library/odds.csv', size: 120 },
    ])
    expect(listing).toEqual([
      { path: 'Rules' },
      { path: 'Rules/Combat', id: 'doc_1', size: 5 },
      { path: 'Data/odds.csv', id: 'doc_2', size: 120 },
    ])
    expect(sources.get('doc_1')).toEqual({ bytes: Buffer.from('über') })
    expect(sources.get('doc_2')).toEqual({ file: '/library/odds.csv', size: 120 })
  })

  it('tells Python the size of a file still to fetch, and fetches it once when asked', async () => {
    const fetch = vi.fn().mockResolvedValue({ path: '/library/big.pdf', size: 2048 })
    const { listing, sources } = projectOf([{ path: 'big.pdf', id: 'doc_3', size: 2048, fetch }])
    expect(listing).toEqual([{ path: 'big.pdf', id: 'doc_3', size: 2048 }])
    expect(fetch).not.toHaveBeenCalled()

    const source = /** @type {any} */ (sources.get('doc_3'))
    const [first, second] = await Promise.all([source.fetch(), source.fetch()])
    expect(first).toEqual({ file: '/library/big.pdf', size: 2048 })
    expect(second).toBe(first)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('reads a file that couldn’t be fetched as none, without asking again', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('The server couldn’t be reached.'))
    const { sources } = projectOf([{ path: 'big.pdf', id: 'doc_3', size: 2048, fetch }])
    const source = /** @type {any} */ (sources.get('doc_3'))
    expect(await source.fetch()).toBeNull()
    expect(await source.fetch()).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('projectResponse', () => {
  const text = { bytes: Buffer.from('0123456789') }

  it('answers a range with that piece of a text', async () => {
    const response = await projectResponse(text, 'bytes=2-5')
    expect(response.status).toBe(206)
    expect(response.headers.get('Content-Range')).toBe('bytes 2-5/10')
    expect(await response.text()).toBe('2345')
  })

  it('answers the rest from a start, and stops at the end', async () => {
    expect(await (await projectResponse(text, 'bytes=7-')).text()).toBe('789')
    expect(await (await projectResponse(text, 'bytes=7-100')).text()).toBe('789')
  })

  it('answers no range with all of it, and one past the end with none', async () => {
    const whole = await projectResponse(text, null)
    expect(whole.status).toBe(200)
    expect(await whole.text()).toBe('0123456789')
    expect((await projectResponse(text, 'bytes=10-12')).status).toBe(416)
  })

  it('reads a file’s piece from the disk, and less of one that shrank', async () => {
    const file = path.join(base, 'odds.csv')
    await writeFile(file, 'skill,chance\n1,0.1\n')
    const response = await projectResponse({ file, size: 19 }, 'bytes=6-11')
    expect(await response.text()).toBe('chance')

    const shrunk = await projectResponse({ file, size: 100 }, 'bytes=13-99')
    expect(await shrunk.text()).toBe('1,0.1\n')
    expect(shrunk.headers.get('Content-Range')).toBe('bytes 13-18/100')
  })
})
