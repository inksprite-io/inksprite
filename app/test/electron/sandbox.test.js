// @vitest-environment node
/* global Buffer */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { MessageChannelMain, WebContentsView, app, session } from 'electron'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  NOT_SANDBOXED,
  PythonSandbox,
  linuxSandboxed,
  osSandboxed,
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

/**
 * A process's `/proc/<pid>/status`, in the parts that matter.
 *
 * @param {string} nspid
 * @param {number} [filters]
 */
const status = (nspid, filters) =>
  [
    'Name:\telectron',
    'NoNewPrivs:\t1',
    'Seccomp:\t2',
    ...(filters === undefined ? [] : [`Seccomp_filters:\t${filters}`]),
    `NSpid:\t${nspid}`,
    '',
  ].join('\n')

describe('linuxSandboxed', () => {
  // As Electron's processes read in a container whose own seccomp profile adds
  // one filter to everything in it.
  const main = status('45344', 1)

  it('takes a process in its own PID namespace, with a filter of its own', () => {
    expect(linuxSandboxed(status('45471\t4\t1', 2), main)).toBe(true)
  })

  it('refuses a renderer started with --no-sandbox, whose NoNewPrivs is set all the same', () => {
    expect(linuxSandboxed(status('45649', 1), main)).toBe(false)
  })

  it('refuses a renderer with the namespaces and no seccomp filter of its own', () => {
    expect(linuxSandboxed(status('46085\t4\t1', 1), main)).toBe(false)
  })

  it('refuses a renderer with a filter of its own and no namespace', () => {
    expect(linuxSandboxed(status('45649', 2), main)).toBe(false)
  })

  it('counts namespaces from where the main process is', () => {
    expect(linuxSandboxed(status('200\t8\t1', 2), status('100\t7', 1))).toBe(true)
    expect(linuxSandboxed(status('200\t8', 2), status('100\t7', 1))).toBe(false)
  })

  it('asks only that there are filters, on a kernel that doesn’t count them', () => {
    expect(linuxSandboxed(status('5\t1'), status('4'))).toBe(true)
    expect(linuxSandboxed(status('5\t1').replace('Seccomp:\t2', 'Seccomp:\t0'), status('4'))).toBe(
      false
    )
  })

  it('refuses what it can’t read', () => {
    expect(linuxSandboxed('', '')).toBe(false)
  })
})

describe('osSandboxed', () => {
  const platform = process.platform

  /** @param {string} value */
  const onPlatform = value => Object.defineProperty(process, 'platform', { value })

  afterEach(() => {
    onPlatform(platform)
    app.getAppMetrics.mockReset()
    app.getAppMetrics.mockReturnValue([])
  })

  for (const system of ['darwin', 'win32']) {
    it(`takes Electron's word on ${system}, and only a yes`, () => {
      onPlatform(system)
      app.getAppMetrics.mockReturnValue([
        { pid: 5, sandboxed: true },
        { pid: 6, sandboxed: false },
        { pid: 7 },
      ])
      expect(osSandboxed(5)).toBe(true)
      expect(osSandboxed(6)).toBe(false)
      expect(osSandboxed(7)).toBe(false)
      expect(osSandboxed(8)).toBe(false)
    })
  }

  it('asks the kernel on Linux, and a process it can’t read isn’t sandboxed', () => {
    onPlatform('linux')
    expect(osSandboxed(2 ** 30)).toBe(false)
    expect(app.getAppMetrics).not.toHaveBeenCalled()
  })
})

describe('PythonSandbox, starting', () => {
  const platform = process.platform

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: platform })
    app.getAppMetrics.mockReset()
    app.getAppMetrics.mockReturnValue([])
  })

  /**
   * Stand-ins for what a session's Python is started with, on a system that
   * says whether its process is sandboxed.
   *
   * @param {boolean} sandboxed
   */
  function starting(sandboxed) {
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    app.getAppMetrics.mockReturnValue([{ pid: 5, sandboxed }])
    session.fromPartition.mockReturnValue({
      protocol: { handle: vi.fn() },
      webRequest: { onBeforeRequest: vi.fn() },
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setDevicePermissionHandler: vi.fn(),
      on: vi.fn(),
    })
    /** @type {Record<string, () => void>} */
    const events = {}
    const webContents = {
      on: vi.fn(),
      once: vi.fn((name, listener) => (events[name] = listener)),
      off: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      loadURL: vi.fn(async () => {}),
      getOSProcessId: () => 5,
      postMessage: vi.fn(),
      isDestroyed: () => false,
      forcefullyCrashRenderer: vi.fn(),
      close: vi.fn(),
    }
    WebContentsView.mockImplementation(function () {
      this.webContents = webContents
    })
    const port1 = { once: vi.fn(), start: vi.fn(), on: vi.fn(), off: vi.fn(), postMessage: vi.fn() }
    const port2 = {}
    MessageChannelMain.mockImplementation(function () {
      this.port1 = port1
      this.port2 = port2
    })
    return { events, webContents, port1, port2 }
  }

  it('hands Python no port in a process the system isn’t sandboxing, and says why', async () => {
    const { events, webContents } = starting(false)
    const sandbox = new PythonSandbox()
    const run = sandbox.run('print("ran")')
    await vi.waitFor(() => expect(webContents.loadURL).toHaveBeenCalled())

    events['did-finish-load']()

    expect(await run).toEqual({
      stdout: '',
      stderr: '',
      value: null,
      error: NOT_SANDBOXED,
      restarted: false,
    })
    expect(webContents.postMessage).not.toHaveBeenCalled()
    expect(webContents.forcefullyCrashRenderer).toHaveBeenCalled()
    expect(sandbox.pid).toBeNull()
  })

  it('hands Python its port in a process the system is sandboxing', async () => {
    const { events, webContents, port1, port2 } = starting(true)
    const sandbox = new PythonSandbox()
    const run = sandbox.run('1 + 1')
    await vi.waitFor(() => expect(webContents.loadURL).toHaveBeenCalled())

    events['did-finish-load']()

    expect(webContents.postMessage).toHaveBeenCalledWith('port', null, [port2])
    port1.once.mock.calls[0][1]({ data: { ready: true } })
    await vi.waitFor(() => expect(port1.postMessage).toHaveBeenCalled())
    const onMessage = port1.on.mock.calls[0][1]
    onMessage({ data: { id: 1, stdout: '', stderr: '', value: '2', error: null } })
    expect(await run).toMatchObject({ value: '2', error: null, restarted: false })
  })
})
