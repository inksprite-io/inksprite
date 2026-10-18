/**
 * @module drive/api
 * @description Asking Google, with the token, and its refusals said for
 * the writer. And the requests a sync makes of it: a Doc read whole, edits
 * written against the revision read, and whose Drive the token is for.
 */

import { fetch } from '@/platform/fetch.js'
import { DriveError, NotGrantedError, SignInLapsedError, StaleRevisionError } from './errors.js'

export const FILES = 'https://www.googleapis.com/drive/v3/files'
export const DOCUMENTS = 'https://docs.googleapis.com/v1/documents'
const ABOUT = 'https://www.googleapis.com/drive/v3/about'

/**
 * Google's refusal, said for the writer.
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
  if (response.status === 404) return new NotGrantedError()
  // "Cannot write to revision …. Please retrieve a newer revision of the
  // document to write against."
  if (response.status === 400 && /revision/i.test(message ?? '')) return new StaleRevisionError()
  return new DriveError(message ? `Drive refused: ${message}` : `Drive answered ${response.status}`)
}

/**
 * A request to Google with the token, answered or refused.
 *
 * @param {string} url
 * @param {string} token
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {object} [options.body] - Sent as JSON, by POST
 * @returns {Promise<Response>}
 * @throws {DriveError} When Google refuses it, or cannot be reached
 * @throws {SignInLapsedError} When Google no longer takes the token
 */
export async function ask(url, token, { signal, body } = {}) {
  /** @type {Record<string, string>} */
  const headers = { Authorization: `Bearer ${token}` }
  /** @type {RequestInit} */
  const init = { headers, signal }
  if (body) {
    headers['Content-Type'] = 'application/json'
    init.method = 'POST'
    init.body = JSON.stringify(body)
  }
  let response
  try {
    response = await fetch(url, init)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new DriveError('Couldn’t reach Drive')
  }
  if (!response.ok) throw await refusal(response)
  return response
}

/**
 * A Doc as the converter reads it: every tab, and suggested edits inline,
 * as the only view that shows them.
 *
 * @param {string} id
 * @param {string} token
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<import('./docsTypes.js').Document>}
 */
export async function readDocument(id, token, { signal } = {}) {
  const url =
    `${DOCUMENTS}/${encodeURIComponent(id)}` +
    '?includeTabsContent=true&suggestionsViewMode=SUGGESTIONS_INLINE'
  return (await ask(url, token, { signal })).json()
}

/**
 * Edits sent to a Doc, worked out against the revision named. Google
 * applies them over whatever was done to the Doc since, for a few minutes
 * after that revision was read.
 *
 * @param {string} id
 * @param {object[]} requests - As the writer made them
 * @param {string} revisionId - The revision they were made against
 * @param {string} token
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<void>}
 * @throws {StaleRevisionError} When the revision is too old to write against
 */
export async function writeDocument(id, requests, revisionId, token, { signal } = {}) {
  await ask(`${DOCUMENTS}/${encodeURIComponent(id)}:batchUpdate`, token, {
    signal,
    body: { requests, writeControl: { targetRevisionId: revisionId } },
  })
}

/**
 * The address of the account a token is for, which Drive tells the app
 * under `drive.file`: what a later sign-in is hinted with.
 *
 * @param {string} token
 * @param {Object} [options]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<string|null>} Null when Drive will not say
 */
export async function accountOf(token, { signal } = {}) {
  try {
    /** @type {any} */
    const body = await (await ask(`${ABOUT}?fields=user(emailAddress)`, token, { signal })).json()
    return body?.user?.emailAddress || null
  } catch (error) {
    if (signal?.aborted || error instanceof SignInLapsedError) throw error
    return null
  }
}
