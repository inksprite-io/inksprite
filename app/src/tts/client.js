/**
 * @module tts/client
 * @description Speech, asked of a connection in the OpenAI shape: `POST
 * audio/speech` with a model, a voice and a speed, a WAV clip back. Kokoro-FastAPI
 * and OpenAI answer in WAV; OpenRouter has none, and is asked for MP3, which is
 * decoded (`tts/decode.js`). Kokoro also lists its voices at `audio/voices`; a
 * server with no such thing lists none, which is not an error.
 */

import { fetch } from '@/platform/fetch.js'
import { attributionHeaders, baseUrl } from '@/ai/wire.js'
import { buildProviderRouting } from '@/ai/routing.js'
import { cutText } from './cut.js'
import { decodeToWav } from './decode.js'
import { concatParts, joinClips } from './wav.js'

/**
 * Where a request goes, and how: a connection and a model, as
 * `speechConnectionOf` makes them.
 *
 * @typedef {Object} SpeechConnection
 * @property {string} endpoint - The API's base, e.g. `http://localhost:8880/v1`
 * @property {string} [apiKey] - Sent as a bearer token when present
 * @property {string} model - `kokoro`, `tts-1`, `hexgrad/kokoro-82m`
 * @property {string} [type] - The connection's type: OpenRouter's is asked
 *   for MP3, and for its routing
 * @property {Record<string, any>} [routing] - OpenRouter's `provider` field, as
 *   a chat on the connection sends it
 * @property {number} [inputLimit] - The most one request may say, in
 *   characters; a longer text is asked for in pieces
 */

/**
 * What to say, and how.
 *
 * @typedef {Object} SpeechRequest
 * @property {string} input
 * @property {string} voice - Passed through as written: a name, or a Kokoro mix
 * @property {number} [speed] - 1 when absent
 */

/**
 * A connection and a model, as a request needs them.
 *
 * @param {import('@/types/models.js').AIProvider} provider
 * @param {string} model
 * @param {import('@/ai/models.js').AIModel} [listed] - The model as its connection lists it
 * @returns {SpeechConnection}
 */
export function speechConnectionOf(provider, model, listed) {
  /** @type {SpeechConnection} */
  const connection = { endpoint: baseUrl(provider) ?? '', model, type: provider.type }
  if (provider.apiKey) connection.apiKey = provider.apiKey
  // The precisions a connection allows are for language models; a speech
  // model's endpoints needn't say theirs, and the filter could leave none.
  const { quantizations: _precisions, ...routing } = buildProviderRouting(provider, model) ?? {}
  if (Object.keys(routing).length > 0) connection.routing = routing
  if (listed?.inputLimit) connection.inputLimit = listed.inputLimit
  return connection
}

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
  const out = { ...attributionHeaders(connection) }
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
 * Say something, in one request. OpenRouter's MP3 comes back decoded.
 *
 * @param {SpeechConnection} connection
 * @param {SpeechRequest} request
 * @param {AbortSignal} [signal]
 * @returns {Promise<ArrayBuffer>} A WAV file
 */
async function ask(connection, { input, voice, speed = 1 }, signal) {
  const mp3 = connection.type === 'openrouter'
  /** @type {Record<string, any>} */
  const body = { model: connection.model, input, voice, response_format: mp3 ? 'mp3' : 'wav' }
  // Left out at 1, as a chat leaves out a neutral sampler: some of
  // OpenRouter's models refuse any other speed, and refuse being told it.
  if (speed !== 1) body.speed = speed
  if (connection.routing) body.provider = connection.routing
  const response = await fetch(speechUrl(connection), {
    method: 'POST',
    headers: headers(connection, true),
    body: JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw new Error(await refusal(response))
  const audio = await response.arrayBuffer()
  return mp3 ? decodeToWav(audio) : audio
}

/**
 * Say something. Resolves to a WAV file. A text longer than the model reads
 * at once is asked for a piece at a time, cut at sentence ends, and the
 * pieces joined with no pause.
 *
 * @param {SpeechConnection} connection
 * @param {SpeechRequest} request
 * @param {AbortSignal} [signal]
 * @returns {Promise<ArrayBuffer>}
 * @throws {Error} When the server refuses, in its words
 */
export async function synthesize(connection, request, signal) {
  const limit = connection.inputLimit
  if (!limit || request.input.length <= limit) return ask(connection, request, signal)
  /** @type {ArrayBuffer[]} */
  const clips = []
  for (const input of cutText(request.input, limit)) {
    clips.push(await ask(connection, { ...request, input }, signal))
  }
  return concatParts(joinClips(clips, { gap: 0 }).parts)
}

/**
 * The voices the server offers, by name, sorted. Kokoro's are what a mix is
 * made of. Kokoro-FastAPI lists each as `{id, name}`, the shape Open WebUI
 * reads, and listed plain names before that; either is taken. A server that
 * does not list voices — OpenAI does not — offers none this way.
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
  return voices
    .map(voice => (typeof voice === 'string' ? voice : voice?.id))
    .filter(voice => typeof voice === 'string' && voice)
    .sort()
}

/**
 * Why a request failed, for the writer. A server that could not be reached
 * at all fails with a `TypeError` and no words worth showing; it is named
 * instead.
 *
 * @param {unknown} error
 * @param {SpeechConnection|null} [connection]
 * @returns {string}
 */
export function describeFailure(error, connection) {
  if (error instanceof TypeError) {
    return connection?.endpoint
      ? `Could not reach the speech server at ${connection.endpoint}.`
      : 'Could not reach the speech server.'
  }
  return error instanceof Error ? error.message : String(error)
}
