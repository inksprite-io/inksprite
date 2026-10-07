/**
 * @module tts/client
 * @description The speech server. Spoken to in the OpenAI shape — `POST
 * audio/speech` with a voice and a speed, WAV back — which is what
 * Kokoro-FastAPI answers and what OpenAI's own endpoint does. Kokoro also
 * lists its voices at `audio/voices`; a server with no such thing lists none,
 * which is not an error.
 */

import { fetch } from '@/platform/fetch.js'

/**
 * Where the server is, and how to talk to it.
 *
 * @typedef {Object} SpeechConnection
 * @property {string} endpoint - The API's base, e.g. `http://localhost:8880/v1`
 * @property {string} [apiKey] - Sent as a bearer token when present
 * @property {string} [model] - `kokoro` when absent; OpenAI wants `tts-1`
 */

/**
 * What to say, and how.
 *
 * @typedef {Object} SpeechRequest
 * @property {string} input
 * @property {string} voice - Passed through as written: a name, or a Kokoro mix
 * @property {number} [speed] - 1 when absent
 */

/** The model asked for when the connection names none. */
export const DEFAULT_MODEL = 'kokoro'

/** Where Kokoro-FastAPI listens when run as its docker-compose runs it. */
export const DEFAULT_ENDPOINT = 'http://localhost:8880/v1'

/**
 * @param {string} base
 * @param {string} path
 * @returns {string}
 */
function joinUrl(base, path) {
  return new URL(path, base.endsWith('/') ? base : `${base}/`).toString()
}

/**
 * @param {SpeechConnection} connection
 * @returns {string}
 */
export const speechUrl = connection => joinUrl(connection.endpoint, 'audio/speech')

/**
 * @param {SpeechConnection} connection
 * @returns {string}
 */
export const voicesUrl = connection => joinUrl(connection.endpoint, 'audio/voices')

/**
 * @param {SpeechConnection} connection
 * @param {boolean} json - Whether a JSON body follows
 * @returns {Record<string, string>}
 */
function headers(connection, json) {
  /** @type {Record<string, string>} */
  const out = {}
  if (json) out['Content-Type'] = 'application/json'
  if (connection.apiKey) out.Authorization = `Bearer ${connection.apiKey}`
  return out
}

/**
 * What a refusal said, in the server's words where it used any.
 *
 * @param {Response} response
 * @returns {Promise<string>}
 */
async function refusal(response) {
  const text = await response.text().catch(() => '')
  try {
    const data = JSON.parse(text)
    const message = data?.error?.message ?? data?.detail?.message ?? data?.detail ?? data?.error
    if (typeof message === 'string' && message) return message
  } catch {
    // Not JSON: the text is the message.
  }
  return text || `HTTP ${response.status}`
}

/**
 * Say something. Resolves to a WAV file.
 *
 * @param {SpeechConnection} connection
 * @param {SpeechRequest} request
 * @param {AbortSignal} [signal]
 * @returns {Promise<ArrayBuffer>}
 * @throws {Error} When the server refuses, in its words
 */
export async function synthesize(connection, { input, voice, speed = 1 }, signal) {
  const response = await fetch(speechUrl(connection), {
    method: 'POST',
    headers: headers(connection, true),
    body: JSON.stringify({
      model: connection.model || DEFAULT_MODEL,
      input,
      voice,
      speed,
      response_format: 'wav',
    }),
    signal,
  })
  if (!response.ok) throw new Error(await refusal(response))
  return response.arrayBuffer()
}

/**
 * The voices the server offers, by name, sorted. Kokoro's are what a mix is
 * made of. A server that does not list voices — OpenAI does not — offers
 * none this way.
 *
 * @param {SpeechConnection} connection
 * @param {AbortSignal} [signal]
 * @returns {Promise<string[]>}
 * @throws {Error} When the server is there and refuses
 */
export async function listVoices(connection, signal) {
  const response = await fetch(voicesUrl(connection), {
    headers: headers(connection, false),
    signal,
  })
  if (response.status === 404) return []
  if (!response.ok) throw new Error(await refusal(response))
  const data = await response.json()
  const voices = Array.isArray(data?.voices) ? data.voices : Array.isArray(data) ? data : []
  return voices.filter(voice => typeof voice === 'string').sort()
}

/**
 * Why a request failed, for the writer. A server that could not be reached
 * at all fails with a `TypeError` and no words worth showing; it is named
 * instead.
 *
 * @param {unknown} error
 * @param {SpeechConnection} connection
 * @returns {string}
 */
export function describeFailure(error, connection) {
  if (error instanceof TypeError) {
    return `Could not reach the speech server at ${connection.endpoint}.`
  }
  return error instanceof Error ? error.message : String(error)
}
