/* global File */
/**
 * @module drive/fetch
 * @description A picked file fetched from Drive as a `File`, for the
 * importer to take as it takes one from disk.
 *
 * Google's own types have no bytes of their own and are exported: a Doc as
 * markdown, a Sheet as CSV (its first sheet), Slides as a PDF, a Drawing as
 * a PNG. Anything else is downloaded as it is.
 */

import { fetch } from '@/platform/fetch.js'
import { DriveError, SignInLapsedError } from './errors.js'

/**
 * A picked file, as Drive describes it.
 *
 * @typedef {Object} PickedFile
 * @property {string} id
 * @property {string} name - As Drive shows it; a Google Doc's has no extension
 * @property {string} mimeType - A Google type (`application/vnd.google-apps.document`) or the file's own
 */

const FILES = 'https://www.googleapis.com/drive/v3/files'

/** What Google's own types are prefixed with. */
const GOOGLE_TYPE = 'application/vnd.google-apps.'

/**
 * Google's types that export, and as what.
 *
 * @type {Record<string, {mime: string, extension: string}>}
 */
export const EXPORTS = {
  document: { mime: 'text/markdown', extension: 'md' },
  spreadsheet: { mime: 'text/csv', extension: 'csv' },
  presentation: { mime: 'application/pdf', extension: 'pdf' },
  drawing: { mime: 'image/png', extension: 'png' },
}

/**
 * Google's types that do not, by what the writer would call them.
 *
 * @type {Record<string, string>}
 */
const UNEXPORTABLE = {
  form: 'Google Forms',
  site: 'Google Sites',
  map: 'Google My Maps',
  jam: 'Jamboards',
  script: 'Apps Script projects',
  shortcut: 'Shortcuts',
  folder: 'Folders',
}

/**
 * How a picked file is fetched, or why it cannot be.
 *
 * @typedef {{url: string, name: string, mime: string}|{skip: string}} DriveRequest
 */

/**
 * The request for a picked file: an export for Google's types, the file's
 * bytes for anything else, or the reason there is nothing to fetch.
 *
 * A Doc comes back as `<name>.md`, which the importer reads as markdown
 * and titles without the `.md`, so a Doc named `Ch. 3` keeps its name.
 *
 * @param {PickedFile} picked
 * @returns {DriveRequest}
 */
export function requestFor(picked) {
  const id = encodeURIComponent(picked.id)
  if (!picked.mimeType.startsWith(GOOGLE_TYPE)) {
    return {
      url: `${FILES}/${id}?alt=media&supportsAllDrives=true`,
      name: picked.name,
      mime: picked.mimeType,
    }
  }
  const kind = picked.mimeType.slice(GOOGLE_TYPE.length)
  const exported = EXPORTS[kind]
  if (!exported) {
    return { skip: `${UNEXPORTABLE[kind] || 'Files of this kind'} can’t be exported` }
  }
  return {
    url: `${FILES}/${id}/export?mimeType=${encodeURIComponent(exported.mime)}`,
    name: `${picked.name}.${exported.extension}`,
    mime: exported.mime,
  }
}

/**
 * Drive's refusal, said for the writer.
 *
 * @param {Response} response
 * @returns {Promise<DriveError>}
 */
async function refusal(response) {
  /** @type {any} */
  let body = null
  try {
    body = await response.json()
  } catch {
    // Not JSON; the status says enough.
  }
  const reason = body?.error?.errors?.[0]?.reason
  const message = body?.error?.message
  if (response.status === 401) return new SignInLapsedError()
  if (reason === 'exportSizeLimitExceeded') return new DriveError('Over Drive’s 10 MB export limit')
  if (response.status === 404) return new DriveError('Drive didn’t give inksprite this file')
  return new DriveError(message ? `Drive refused: ${message}` : `Drive answered ${response.status}`)
}

/**
 * Fetch a picked file from Drive.
 *
 * @param {PickedFile} picked
 * @param {string} token
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<File>}
 * @throws {DriveError} When it cannot be exported or Drive refuses it
 * @throws {SignInLapsedError} When Drive no longer takes the token
 */
export async function fetchPicked(picked, token, { signal } = {}) {
  const request = requestFor(picked)
  if ('skip' in request) throw new DriveError(request.skip)
  const response = await ask(request.url, token, signal)
  const blob = await response.blob()
  return new File([blob], request.name, { type: request.mime })
}

/**
 * A picked file's name and type, which the picker does not hand back: only
 * the ids come back from Google's sign-in.
 *
 * @param {string} id
 * @param {string} token
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<PickedFile>}
 * @throws {DriveError} When Drive refuses it
 * @throws {SignInLapsedError} When Drive no longer takes the token
 */
export async function describePicked(id, token, { signal } = {}) {
  const url = `${FILES}/${encodeURIComponent(id)}?fields=id,name,mimeType&supportsAllDrives=true`
  /** @type {any} */
  const body = await (await ask(url, token, signal)).json()
  return { id: body.id || id, name: body.name || id, mimeType: body.mimeType || '' }
}

/**
 * A request to Drive with the token, answered or refused.
 *
 * @param {string} url
 * @param {string} token
 * @param {AbortSignal} [signal]
 * @returns {Promise<Response>}
 */
async function ask(url, token, signal) {
  let response
  try {
    response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new DriveError('Couldn’t reach Drive')
  }
  if (!response.ok) throw await refusal(response)
  return response
}
