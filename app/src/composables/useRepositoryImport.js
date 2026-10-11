/**
 * @module composables/useRepositoryImport
 * @description A codebase brought into a project as a repository, from a
 * folder or from GitHub, and brought up to date again.
 *
 * The steps are `source/`'s: the files listed and sorted by the rules, the
 * text read, the tree written. This puts them in order for each way in and
 * says how it went. See `.llm/source_code_design.md`.
 */

import { useDocuments } from './useDocuments.js'
import { entriesOfFolder, gatherSource } from '@/source/gather.js'
import { downloadArchive, parseGitHubUrl, readArchive, GitHubError } from '@/source/github.js'
import { refreshRepository, writeRepository } from '@/source/write.js'

/** @typedef {import('@/types/models.js').RepositorySource} RepositorySource */
/** @typedef {import('@/source/gather.js').LeftOut} LeftOut */
/** @typedef {import('@/source/write.js').Refreshed} Refreshed */

/**
 * Where an import is, for the dialog to say.
 *
 * @typedef {(step: 'downloading'|'reading'|'writing', done?: number, total?: number) => void} OnStep
 */

/**
 * What an import or a refresh did.
 *
 * @typedef {Object} RepositoryImported
 * @property {string} folderId - The repository folder
 * @property {string} name - Its source's name
 * @property {number} files - How many files came in
 * @property {LeftOut} left - What was left out, and why
 * @property {Refreshed} [refreshed] - For a refresh, what changed
 */

/**
 * @typedef {Object} ImportOptions
 * @property {string} [parentId] - Where a new repository goes; the project's top otherwise
 * @property {AbortSignal} [signal]
 * @property {OnStep} [onStep]
 */

/**
 * @param {string} storyId
 */
export function useRepositoryImport(storyId) {
  const api = useDocuments(storyId)

  /**
   * Write what was gathered: a new repository, or the one being refreshed.
   *
   * @param {import('@/source/gather.js').GatheredSource} gathered
   * @param {RepositorySource} source
   * @param {string} title
   * @param {ImportOptions & {refresh?: string}} options
   * @returns {Promise<RepositoryImported>}
   */
  async function write(gathered, source, title, { parentId, signal, onStep, refresh }) {
    const onProgress = (/** @type {number} */ done, /** @type {number} */ total) =>
      onStep?.('writing', done, total)
    const base = { name: source.name, files: gathered.files.length, left: gathered.left }
    if (refresh) {
      const refreshed = await refreshRepository(storyId, refresh, {
        source,
        files: gathered.files,
        signal,
        onProgress,
      })
      return { ...base, folderId: refresh, refreshed }
    }
    const { folderId } = await writeRepository(storyId, {
      parentId,
      title,
      source,
      files: gathered.files,
      signal,
      onProgress,
    })
    return { ...base, folderId }
  }

  /**
   * A folder chosen with the folder chooser, or dropped on the tree.
   *
   * @param {import('@/files/batch.js').Gathered[]} listed - Its files, as
   *   `files/batch.js` lists them
   * @param {ImportOptions & {refresh?: string}} [options] - `refresh`: the
   *   repository folder to bring up to date, rather than making a new one
   * @returns {Promise<RepositoryImported>}
   */
  async function importFolder(listed, options = {}) {
    await api.init()
    const { name, entries } = entriesOfFolder(listed)
    const gathered = await gatherSource(entries, {
      signal: options.signal,
      onProgress: (done, total) => options.onStep?.('reading', done, total),
    })
    /** @type {RepositorySource} */
    const source = { from: 'folder', name, imported: Date.now() }
    return write(gathered, source, name, options)
  }

  /**
   * A repository on GitHub, by its URL.
   *
   * @param {string} url
   * @param {ImportOptions & {token?: string}} [options]
   * @returns {Promise<RepositoryImported>}
   */
  async function importGitHub(url, options = {}) {
    const address = parseGitHubUrl(url)
    if (!address) throw new GitHubError(`"${url}" is not a GitHub repository's address.`)
    return fromGitHub(address, undefined, options)
  }

  /**
   * Bring a repository up to date from where it came from. A folder has to
   * be chosen again: a page cannot keep hold of one.
   *
   * @param {string} folderId - The repository folder
   * @param {ImportOptions & {token?: string, listed?: import('@/files/batch.js').Gathered[]}} [options]
   * @returns {Promise<RepositoryImported>}
   */
  async function refresh(folderId, options = {}) {
    await api.init()
    const source = api.get(folderId)?.source
    if (!source) throw new Error('This folder is not a repository.')
    if (source.from === 'folder') {
      if (!options.listed) throw new Error('Choose the folder to read it again.')
      return importFolder(options.listed, { ...options, refresh: folderId })
    }
    const [owner, repo] = source.name.split('/')
    return fromGitHub(
      { owner, repo, rest: [] },
      { ref: source.ref || '', subpath: source.subpath || '' },
      { ...options, refresh: folderId }
    )
  }

  /**
   * @param {import('@/source/github.js').GitHubAddress} address
   * @param {{ref: string, subpath: string}|undefined} at
   * @param {ImportOptions & {token?: string, refresh?: string}} options
   * @returns {Promise<RepositoryImported>}
   */
  async function fromGitHub(address, at, options) {
    await api.init()
    const { token, signal, onStep } = options
    onStep?.('downloading')
    const { bytes, ref, subpath } = await downloadArchive(address, { token, signal, at })
    const { commit, gathered } = await readArchive(bytes, {
      subpath,
      signal,
      onProgress: (done, total) => onStep?.('reading', done, total),
    })
    /** @type {RepositorySource} */
    const source = {
      from: 'github',
      name: `${address.owner}/${address.repo}`,
      ...(ref ? { ref } : {}),
      ...(commit ? { commit } : {}),
      ...(subpath ? { subpath } : {}),
      imported: Date.now(),
    }
    const title = subpath ? subpath.split('/').pop() || address.repo : address.repo
    return write(gathered, source, title, options)
  }

  return { importFolder, importGitHub, refresh }
}

/**
 * What to tell the writer when an import or a refresh is done, in a line.
 *
 * @param {RepositoryImported} result
 * @returns {{detail: string, severity: 'success'|'warn'}}
 */
export function describeRepositoryImport(result) {
  const count = (/** @type {number} */ n, /** @type {string} */ word) =>
    `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`
  const { left, refreshed } = result

  const out = [
    left.ignored + left.never > 0 ? `${count(left.ignored + left.never, 'file')} ignored` : '',
    left.binary.length > 0 ? `${count(left.binary.length, 'file')} not text` : '',
    left.large.length > 0 ? `${count(left.large.length, 'file')} too large` : '',
  ].filter(Boolean)
  const leftOut = out.length > 0 ? `Left out: ${out.join(', ')}.` : ''

  if (refreshed) {
    const changes = [
      refreshed.added ? `${refreshed.added} added` : '',
      refreshed.updated ? `${refreshed.updated} changed` : '',
      refreshed.removed ? `${refreshed.removed} removed` : '',
    ].filter(Boolean)
    return {
      detail: [
        `${result.name} refreshed:`,
        changes.length > 0 ? `${changes.join(', ')}.` : 'nothing changed.',
        leftOut,
      ]
        .filter(Boolean)
        .join(' '),
      severity: 'success',
    }
  }
  return {
    detail: [`${result.name} imported: ${count(result.files, 'file')}.`, leftOut]
      .filter(Boolean)
      .join(' '),
    severity: result.files > 0 ? 'success' : 'warn',
  }
}
