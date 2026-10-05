/**
 * @module ai/skills/consultations
 * @description What a skill the model consulted did, as the turn shows it.
 *
 * A skill's call is a turn of its own inside the turn that made it: it was
 * asked something, it thought, it called tools, it answered. The tool-call
 * panel shows a lookup as a name and a result, and a consultation shown that
 * way leaves out the part worth reading when its answer came out strange. So
 * each one is a block of its own, made here from the record the turn keeps:
 * the call, its result, and the `_consultation` beside the result (see
 * runToolCall in composables/useAIChat.js).
 *
 * The Director's block from before, when a chat could run it ahead of the
 * assistant, is the same block; `fromDirectorNote` reads the note those turns
 * kept.
 */

import { getSkill, skillLabel } from './index.js'
import { formatToolArguments, formatToolResult } from '@/utils/formatters.js'

/** @typedef {import('../../types/models.js').ApiMessage} ApiMessage */
/** @typedef {import('../../types/models.js').Consultation} Consultation */
/** @typedef {import('../../types/models.js').DirectorNote} DirectorNote */

/**
 * One consultation, ready to show.
 *
 * @typedef {Object} ConsultationView
 * @property {string} id - The call's id, for a key
 * @property {string} label - The skill, as the writer calls it
 * @property {string} asked - What it was asked, or nothing for one that reads
 *   the turn it is in
 * @property {string} answer - What it answered, as prose
 * @property {string} error - Why there is no answer, when there is none
 * @property {string} thinking - What it thought on the way
 * @property {boolean} pending - It has not answered yet
 * @property {boolean} reply - Its answer is the turn's reply, shown below as the reply
 * @property {CallView[]} calls - The tools it called, in order
 */

/**
 * One tool a skill called.
 *
 * @typedef {Object} CallView
 * @property {string} name
 * @property {string} args - What it was asked, compactly
 * @property {string} result - What it answered, prettified and cut short
 * @property {ConsultationView|null} skill - When the tool was itself a skill:
 *   that one's block, to show inside this one
 */

/** The fields a skill's answer is found under, by skill. */
const ANSWER_FIELDS = ['direction', 'interpretation', 'answer', 'draft']

/**
 * Whether a call is to a skill.
 *
 * Answered, its result says: every skill's keeps what it did. A turn from
 * before results kept anything could only have consulted a built-in, so one
 * of those by name counts too. Still running, there is only the name, and a
 * skill the app has by that name is as close as it gets.
 *
 * @param {string} name
 * @param {ApiMessage|undefined} [result]
 * @returns {boolean}
 */
export function isConsultation(name, result) {
  if (!result) return Boolean(getSkill(name))
  return Boolean(result._consultation) || Boolean(getSkill(name)?.builtIn)
}

/**
 * @param {string} text
 * @returns {any}
 */
function parsed(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/**
 * What a skill was asked, from its call's arguments: the argument itself, for
 * one that takes one, since its name says nothing the block does not.
 *
 * @param {string} args - As the model wrote them
 * @returns {string}
 */
function askedIn(args) {
  const read = parsed(args || '')
  if (typeof read === 'string') return read.trim()
  if (!read || typeof read !== 'object') return ''
  return Object.values(read)
    .filter(value => typeof value === 'string' && value.trim())
    .join('\n')
}

/**
 * A skill's call as a block, from the call and what came back.
 *
 * @param {{id?: string, name: string, arguments: string, result: string|null, consultation?: Consultation}} call
 *   The result is null while it runs
 * @returns {ConsultationView}
 */
export function consultationView({ id = '', name, arguments: args, result, consultation }) {
  const read = result === null ? null : parsed(result)
  const answered = read && typeof read === 'object' ? read : {}
  const field = ANSWER_FIELDS.find(key => typeof answered[key] === 'string')

  return {
    id,
    label: skillLabel(getSkill(name) || { name }),
    asked: askedIn(args),
    answer: field ? answered[field] : typeof read === 'string' ? read : '',
    error: typeof answered.error === 'string' ? answered.error : '',
    thinking: consultation?.thinking || '',
    pending: result === null,
    reply: Boolean(consultation?.reply),
    calls: (consultation?.calls || []).map(inner => ({
      name: inner.name,
      args: formatToolArguments(parsed(inner.arguments)),
      result: formatToolResult(inner.result),
      skill: inner.consultation ? consultationView(inner) : null,
    })),
  }
}

/**
 * Every skill a turn consulted, in the order it called them: the ones its
 * trajectory has, answered, and then the ones still running.
 *
 * @param {ApiMessage[]|undefined} trajectory - The turn's record of its calls
 * @param {Array<{id?: string, name: string, arguments?: string}>|undefined} [pending] -
 *   The calls the turn is making now, as far as they have been written
 * @returns {ConsultationView[]}
 */
export function consultationsIn(trajectory, pending) {
  /** @type {Map<string, ApiMessage>} */
  const results = new Map()
  for (const item of trajectory || []) {
    if (item?.role === 'tool' && item.tool_call_id) results.set(item.tool_call_id, item)
  }

  /** @type {ConsultationView[]} */
  const out = []
  const seen = new Set()
  for (const item of trajectory || []) {
    if (item?.role !== 'assistant' || !Array.isArray(item.tool_calls)) continue
    for (const call of item.tool_calls) {
      const name = call.function?.name || ''
      const result = results.get(call.id)
      if (!isConsultation(name, result)) continue
      seen.add(call.id)
      out.push(
        consultationView({
          id: call.id,
          name,
          arguments: call.function?.arguments || '',
          result: result ? String(result.content ?? '') : null,
          consultation: result?._consultation,
        })
      )
    }
  }

  for (const [index, call] of (pending || []).entries()) {
    if (!call?.name || seen.has(call.id) || !isConsultation(call.name)) continue
    out.push(
      consultationView({
        id: call.id || `pending_${index}`,
        name: call.name,
        arguments: call.arguments || '',
        result: null,
      })
    )
  }

  return out
}

/**
 * The block a turn from before kept for the Director, when a chat ran it
 * ahead of the assistant rather than leaving the call to the model.
 *
 * @param {DirectorNote} note
 * @returns {ConsultationView}
 */
export function fromDirectorNote(note) {
  return {
    id: 'director',
    label: 'Director',
    asked: '',
    answer: note.direction || '',
    error: note.error || '',
    thinking: note.reasoning || '',
    pending: Boolean(note.pending),
    reply: false,
    calls: [],
  }
}
