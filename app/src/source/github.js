/**
 * @module source/github
 * @description A repository on GitHub, downloaded as one archive.
 *
 * `api.github.com/repos/<owner>/<repo>/zipball/<ref>` answers with a redirect
 * to `codeload.github.com`, which lets no web page read what it sends. The
 * desktop app's requests go out from the native side, where that does not
 * apply, so this works there and in Node, and on the web says why it cannot.
 *
 * One request, which without a token is one of GitHub's sixty an hour. The
 * archive is opened twice: once to list it, which reads only its directory,
 * and once to inflate the files the rules let in, so nothing left out is
 * ever decompressed.
 */

import { unzipSync } from 'fflate'
import { fetch } from '@/platform/fetch.js'
import { isDesktop } from '@/platform/desktop.js'
import { gatherSource } from './gather.js'

/** Something GitHub, or the way to it, said no to. */
export class GitHubError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'GitHubError'
  }
}

/**
 * A repository named by a URL, and whatever followed `tree/` in it: a ref,
 * perhaps with a folder after it, which cannot be told apart until GitHub is
 * asked (`feature/login` is one branch or a branch and a folder).
 *
 * @typedef {Object} GitHubAddress
 * @property {string} owner
 * @property {string} repo
 * @property {string[]} rest - The segments after `tree/`, if any
 */

/**
 * Read a repository's address from what the writer pasted: a URL as GitHub
 * shows it (with `/tree/<ref>/<folder>` or without), a clone URL, or just
 * `owner/repo`.
 *
 * @param {string} input
 * @returns {GitHubAddress|null} Null when it does not name a GitHub repository
 */
export function parseGitHubUrl(input) {
  const trimmed = (input || '')
    .trim()
    .replace(/^git@github\.com:/i, '')
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
  const [owner, name, kind, ...rest] = trimmed.split('/')
  const repo = (name || '').replace(/\.git$/i, '')
  const valid = /^[\w.-]+$/
  if (!owner || !repo || !valid.test(owner) || !valid.test(repo)) return null
  if (kind && kind !== 'tree') return null
  return { owner, repo, rest: kind ? rest.filter(Boolean).map(decodeURIComponent) : [] }
}

/**
 * The ways to read `rest` as a ref and a folder in it, shortest ref first.
 * @param {string[]} rest
 * @returns {Array<{ref: string, subpath: string}>}
 */
export function refCandidates(rest) {
  if (rest.length === 0) return [{ ref: '', subpath: '' }]
  return rest.map((_, at) => ({
    ref: rest.slice(0, at + 1).join('/'),
    subpath: rest.slice(at + 1).join('/'),
  }))
}

/**
 * @param {Response} response
 * @param {boolean} withToken
 * @returns {GitHubError}
 */
function refusal(response, withToken) {
  if (response.status === 401) return new GitHubError('GitHub did not accept the token.')
  if (
    (response.status === 403 || response.status === 429) &&
    response.headers.get('x-ratelimit-remaining') === '0'
  ) {
    const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000
    const at = reset ? ` It resets at ${new Date(reset).toLocaleTimeString()}.` : ''
    return new GitHubError(
      `GitHub's limit on requests is used up.${at}${withToken ? '' : ' A token raises it.'}`
    )
  }
  return new GitHubError(`GitHub answered ${response.status} ${response.statusText}`.trim())
}

/**
 * Download a repository's archive at a ref, trying each way of reading the
 * URL's segments as a ref until GitHub knows one.
 *
 * @param {GitHubAddress} address
 * @param {Object} [options]
 * @param {string} [options.token]
 * @param {AbortSignal} [options.signal]
 * @param {{ref: string, subpath: string}} [options.at] - The ref and folder
 *   already settled, as a refresh has them, rather than read from `rest`
 * @returns {Promise<{bytes: Uint8Array, ref: string, subpath: string}>}
 */
export async function downloadArchive(address, { token, signal, at: settled } = {}) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  for (const { ref, subpath } of settled ? [settled] : refCandidates(address.rest)) {
    const at = ref ? `/${ref.split('/').map(encodeURIComponent).join('/')}` : ''
    const url = `https://api.github.com/repos/${address.owner}/${address.repo}/zipball${at}`
    let response
    try {
      response = await fetch(url, { headers, signal })
    } catch (error) {
      if (signal?.aborted) throw error
      if (!isDesktop()) {
        throw new GitHubError(
          'GitHub does not let a web page download a repository. Import it in the desktop app, or clone it and import the folder.'
        )
      }
      throw error
    }
    if (response.ok) return { bytes: new Uint8Array(await response.arrayBuffer()), ref, subpath }
    if (response.status !== 404) throw refusal(response, !!token)
  }
  const named = `${address.owner}/${address.repo}`
  throw new GitHubError(
    address.rest.length > 0
      ? `GitHub has no ${named} at ${address.rest.join('/')}.${token ? '' : ' A private repository needs a token.'}`
      : `GitHub has no ${named}.${token ? '' : ' A private repository needs a token.'}`
  )
}

/**
 * The files in a GitHub archive, under its top folder (`<owner>-<repo>-<sha>`,
 * which names the commit) and under `subpath` when one was asked for, read
 * through the codebase rules.
 *
 * @param {Uint8Array} bytes
 * @param {Object} [options]
 * @param {string} [options.subpath]
 * @param {AbortSignal} [options.signal]
 * @param {(done: number, total: number) => void} [options.onProgress]
 * @returns {Promise<{commit: string, gathered: import('./gather.js').GatheredSource}>}
 */
export async function readArchive(bytes, { subpath = '', signal, onProgress } = {}) {
  /** @type {Array<{name: string, size: number}>} */
  const listed = []
  unzipSync(bytes, {
    filter: file => {
      listed.push({ name: file.name, size: file.originalSize })
      return false
    },
  })
  const top = listed[0]?.name.split('/')[0] || ''
  const commit = top.includes('-') ? top.slice(top.lastIndexOf('-') + 1) : ''
  const under = `${top}/${subpath ? `${subpath.replace(/^\/+|\/+$/g, '')}/` : ''}`

  /** @type {Map<string, Uint8Array>} */
  let inflated = new Map()
  const entries = listed
    .filter(({ name }) => name.startsWith(under) && !name.endsWith('/'))
    .map(({ name, size }) => ({
      path: name.slice(under.length),
      size,
      read: () => inflated.get(name) || new Uint8Array(),
      name,
    }))
  if (entries.length === 0 && subpath) {
    throw new GitHubError(`The repository has no folder ${subpath}.`)
  }

  const gathered = await gatherSource(entries, {
    signal,
    onProgress,
    // What GitHub archives was committed; the two lists are enough.
    gitignores: false,
    prepare: kept => {
      const wanted = new Set(kept.map(entry => /** @type {any} */ (entry).name))
      inflated = new Map(
        Object.entries(unzipSync(bytes, { filter: file => wanted.has(file.name) }))
      )
    },
  })
  return { commit, gathered }
}
