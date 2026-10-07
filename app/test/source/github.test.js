/* global Response */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { zipSync, strToU8 } from 'fflate'
import {
  parseGitHubUrl,
  refCandidates,
  downloadArchive,
  readArchive,
  GitHubError,
} from '@/source/github.js'

const fetch = vi.fn()
let desktop = true
vi.mock('@/platform/fetch.js', () => ({ fetch: (...args) => fetch(...args) }))
vi.mock('@/platform/desktop.js', () => ({ isDesktop: () => desktop }))

/** An archive the way GitHub makes one: everything under `<owner>-<repo>-<sha>/`. */
const archive = (files, top = 'acme-widgets-3f2a9c1') =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, body]) => [
        `${top}/${path}`,
        typeof body === 'string' ? strToU8(body) : body,
      ])
    )
  )

describe('parseGitHubUrl', () => {
  it('reads every shape a repository is pasted in', () => {
    const plain = { owner: 'acme', repo: 'widgets', rest: [] }
    expect(parseGitHubUrl('https://github.com/acme/widgets')).toEqual(plain)
    expect(parseGitHubUrl('github.com/acme/widgets/')).toEqual(plain)
    expect(parseGitHubUrl('https://www.github.com/acme/widgets.git')).toEqual(plain)
    expect(parseGitHubUrl('git@github.com:acme/widgets.git')).toEqual(plain)
    expect(parseGitHubUrl('acme/widgets')).toEqual(plain)
    expect(parseGitHubUrl('https://github.com/acme/widgets?tab=readme#top')).toEqual(plain)
  })

  it('keeps what follows tree/, to be read as a ref and a folder', () => {
    expect(parseGitHubUrl('https://github.com/acme/widgets/tree/feature/login/src')).toEqual({
      owner: 'acme',
      repo: 'widgets',
      rest: ['feature', 'login', 'src'],
    })
  })

  it('is null for anything that is not a repository', () => {
    expect(parseGitHubUrl('')).toBeNull()
    expect(parseGitHubUrl('https://gitlab.com/acme/widgets')).toBeNull()
    expect(parseGitHubUrl('https://github.com/acme')).toBeNull()
    expect(parseGitHubUrl('https://github.com/acme/widgets/blob/main/a.ts')).toBeNull()
  })
})

describe('refCandidates', () => {
  it('tries the shortest ref first', () => {
    expect(refCandidates([])).toEqual([{ ref: '', subpath: '' }])
    expect(refCandidates(['feature', 'login', 'src'])).toEqual([
      { ref: 'feature', subpath: 'login/src' },
      { ref: 'feature/login', subpath: 'src' },
      { ref: 'feature/login/src', subpath: '' },
    ])
  })
})

describe('downloadArchive', () => {
  beforeEach(() => {
    fetch.mockReset()
    desktop = true
  })

  const address = rest => ({ owner: 'acme', repo: 'widgets', rest })

  it("asks for the default branch's archive, with a token when there is one", async () => {
    fetch.mockResolvedValue(new Response(archive({ 'a.ts': 'a' })))

    const { ref, subpath, bytes } = await downloadArchive(address([]), { token: 'tok' })

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/acme/widgets/zipball')
    expect(init.headers.Authorization).toBe('Bearer tok')
    expect({ ref, subpath }).toEqual({ ref: '', subpath: '' })
    expect(bytes.length).toBeGreaterThan(0)
  })

  it('settles a ref with a slash in it by asking until GitHub knows one', async () => {
    fetch
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(archive({ 'src/a.ts': 'a' })))

    const result = await downloadArchive(address(['feature', 'login', 'src']))

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://api.github.com/repos/acme/widgets/zipball/feature',
      'https://api.github.com/repos/acme/widgets/zipball/feature/login',
    ])
    expect(result).toMatchObject({ ref: 'feature/login', subpath: 'src' })
  })

  it('says a repository it cannot find may be private', async () => {
    fetch.mockResolvedValue(new Response('', { status: 404 }))

    await expect(downloadArchive(address([]))).rejects.toThrow(
      'GitHub has no acme/widgets. A private repository needs a token.'
    )
  })

  it('says when the token is refused, or the rate limit is used up', async () => {
    fetch.mockResolvedValueOnce(new Response('', { status: 401 }))
    await expect(downloadArchive(address([]), { token: 'bad' })).rejects.toThrow(
      'GitHub did not accept the token.'
    )

    fetch.mockResolvedValueOnce(
      new Response('', {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1800000000' },
      })
    )
    await expect(downloadArchive(address([]))).rejects.toThrow(
      /limit .* used up.*A token raises it/
    )
  })

  it('says why a web page cannot download one', async () => {
    desktop = false
    fetch.mockRejectedValue(new TypeError('Failed to fetch'))

    const failure = downloadArchive(address([]))
    await expect(failure).rejects.toBeInstanceOf(GitHubError)
    await expect(failure).rejects.toThrow(/desktop app/)
  })

  it('takes a ref and folder already settled, as a refresh has them', async () => {
    fetch.mockResolvedValue(new Response(archive({ 'a.ts': 'a' })))

    await downloadArchive(address([]), { at: { ref: 'v2.0', subpath: 'lib' } })

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0]).toBe('https://api.github.com/repos/acme/widgets/zipball/v2.0')
  })
})

describe('readArchive', () => {
  it('strips the top folder, reads the commit from it, and applies the lists', async () => {
    const bytes = archive({
      'src/index.ts': 'export const one = 1\n',
      'README.md': '# Widgets\n',
      'dist/bundle.js': 'compiled',
      'assets/logo.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]),
      '.env': 'TOKEN=1',
    })

    const { commit, gathered } = await readArchive(bytes)

    expect(commit).toBe('3f2a9c1')
    expect(gathered.files.map(file => file.path)).toEqual(['README.md', 'src/index.ts'])
    expect(gathered.left).toMatchObject({ never: 1, ignored: 1, binary: ['assets/logo.png'] })
  })

  it('takes only the folder asked for, with paths below it', async () => {
    const bytes = archive({
      'packages/core/src/a.ts': 'a',
      'packages/web/src/b.ts': 'b',
    })

    const { gathered } = await readArchive(bytes, { subpath: 'packages/core' })

    expect(gathered.files.map(file => file.path)).toEqual(['src/a.ts'])
  })

  it('says when the folder asked for is not there', async () => {
    await expect(readArchive(archive({ 'a.ts': 'a' }), { subpath: 'nope' })).rejects.toThrow(
      'The repository has no folder nope.'
    )
  })
})
