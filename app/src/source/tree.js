/**
 * @module source/tree
 * @description Where a repository sits in a project's tree, and what is in it.
 *
 * A repository is a folder with `kind: 'repository'` and its `source`; what
 * is under it was read from that source and is settled against it on every
 * refresh, by path. So everything here goes by the nearest repository above.
 */

import { isText } from '@/files/inspect.js'

/** @typedef {import('@/types/models.js').Document} Document */
/** @typedef {(id: string) => Document|undefined|null} Lookup */

/**
 * @param {Document|null|undefined} document
 * @returns {boolean}
 */
export const isRepository = document =>
  document?.type === 'folder' && document.kind === 'repository'

/**
 * The repository a document is in, or is: the nearest repository folder at
 * or above it.
 *
 * @param {Lookup} get
 * @param {Document|null|undefined} document
 * @returns {Document|null}
 */
export function repositoryOf(get, document) {
  // The walk stops at the top, where the parent is the story, and at
  // anything it has been through before, whatever the lookup answers.
  const seen = new Set()
  for (let at = document; at && !seen.has(at.id); at = at.parentId ? get(at.parentId) : null) {
    if (isRepository(at)) return at
    seen.add(at.id)
  }
  return null
}

/**
 * Whether a document is under a repository, not the repository itself:
 * something a refresh would put back as it was.
 *
 * @param {Lookup} get
 * @param {Document|null|undefined} document
 * @returns {boolean}
 */
export const inRepository = (get, document) =>
  !!document && !isRepository(document) && !!repositoryOf(get, document)

/**
 * Whether a file, one in a repository, came in whole: a PDF, a book, a Word
 * file or a picture, kept as the file it is, its text what was read out of
 * it. Any other file of a repository is its text.
 *
 * @param {Document|null|undefined} document
 * @returns {boolean}
 */
export const keptWhole = document =>
  document?.type === 'file' && !!document.mime && !isText(document.mime)

/**
 * Whether a document is a source file: a file of text in a repository, which
 * is code to be read by line.
 *
 * @param {Lookup} get
 * @param {Document|null|undefined} document
 * @returns {boolean}
 */
export const isSourceFile = (get, document) =>
  document?.type === 'file' && !keptWhole(document) && !!repositoryOf(get, document)

/**
 * A repository's line in a listing: what it is, where from, and how much.
 *
 * @param {Document} repository
 * @param {number} files - How many files are in it
 * @returns {string}
 */
export function describeRepository(repository, files) {
  const source = repository.source
  const from = source
    ? `${source.name}${source.subpath ? `/${source.subpath}` : ''}${source.commit ? ` at ${source.commit.slice(0, 7)}` : source.ref ? ` at ${source.ref}` : ''}`
    : ''
  return [
    `repository${from ? ` ${from}` : ''}`,
    `${files.toLocaleString('en-US')} ${files === 1 ? 'file' : 'files'}`,
  ].join(', ')
}
