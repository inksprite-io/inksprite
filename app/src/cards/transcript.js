/**
 * @module cards/transcript
 * @description A SillyTavern chat file, read into a chat's worth of messages.
 *
 * The file is JSON Lines: a header, then one message a line. It is a
 * transcript and nothing else — who said what, when, and what else they might
 * have said. Everything that made the conversation go the way it did lived
 * somewhere else in SillyTavern and is not in here: the card, the persona, the
 * preset, the lorebook. So a transcript says who it was with by name only, and
 * finding that character in the project is the caller's to do; see
 * `useCardChat().attach`.
 *
 * Reading is pure. What comes back is rows in the shape `useChats().importChat`
 * already takes from a chat file of the app's own, so an ST chat joins a
 * project by the same road.
 *
 * Design: `.llm/character_cards_design.md`.
 */

import { substitute } from './macros.js'

/** @typedef {import('../types/models.js').Message} Message */
/** @typedef {import('../types/models.js').MessageAlternate} MessageAlternate */

/**
 * @typedef {Object} Transcript
 * @property {string} title - The file's name, without the timestamp ST puts in it
 * @property {string} character - Who the chat was with, by the name on their
 *   messages. Empty when nobody but the writer spoke.
 * @property {string} user - The writer's name in it, which is their persona's.
 *   Empty when the file never says it.
 * @property {string} note - The Author's Note, the one piece of the prompt a
 *   chat file carries. Empty for most, and when the chat had it switched off.
 * @property {Message[]} messages - In order, under placeholder ids: an import
 *   gives everything fresh ones
 */

/** What ST writes where a name used to go, since it stopped using the header's. */
const UNUSED = 'unused'

/**
 * Whether this text is an ST chat, without trusting the file's extension.
 *
 * The first line decides. A chat file of the app's own is one JSON document,
 * and its first line is either a lone brace or the whole envelope, neither of
 * which is an object with ST's header on it or a message's fields.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isTranscript(text) {
  const first = parseLine(firstLine(text))
  if (!first) return false
  return (
    'chat_metadata' in first ||
    ('user_name' in first && 'character_name' in first) ||
    isMessage(first)
  )
}

/**
 * Read an ST chat.
 *
 * @param {string} text - The file
 * @param {string} [filename] - For the title, which the file does not hold
 * @returns {Transcript}
 * @throws {Error} If there is no message in it
 */
export function readTranscript(text, filename = '') {
  const rows = text.split('\n').map(parseLine).filter(Boolean)

  // Older builds wrote no header, so it is whichever line is not a message
  // rather than whichever line is first.
  const header = rows.find(row => !isMessage(row)) || {}
  const said = rows.filter(isMessage).filter(row => textOf(row.mes).trim())
  if (said.length === 0) throw new Error('There are no messages in this chat.')

  const names = {
    char: named(header.character_name) || commonest(said.filter(row => !row.is_user)),
    user: named(header.user_name) || commonest(said.filter(row => row.is_user)),
  }

  // Messages are ordered by when they were written, so every one needs a time
  // of its own, later than the one before. Two builds of ST ago a stamp was
  // good to the minute, and a fast exchange shares one.
  const stamps = said.map(row => when(row.send_date))
  let last = (stamps.find(stamp => stamp !== null) ?? Date.now()) - 1

  const messages = said.map((row, at) => {
    const stamp = stamps[at]
    last = stamp !== null && stamp > last ? stamp : last + 1
    return messageFrom(row, at, last, names)
  })

  return {
    title: titleFrom(filename) || names.char || 'Imported chat',
    character: names.char,
    user: names.user,
    note: noteOf(header.chat_metadata),
    messages,
  }
}

/**
 * One line of the file as a message.
 *
 * `is_system` is not a role. It is ST's flag for a message the writer hid from
 * the prompt, and there is nothing here to hide one with; it comes in as what
 * it was before it was hidden, because a conversation with holes in it is worse
 * than one the writer has to trim.
 *
 * @param {any} row
 * @param {number} at - Where it is in the chat
 * @param {number} created
 * @param {{char: string, user: string}} names
 * @returns {Message}
 */
function messageFrom(row, at, created, names) {
  const role = row.is_user ? 'user' : 'assistant'
  const swipes = role === 'assistant' && Array.isArray(row.swipes) ? row.swipes : []
  const showing = Math.min(Math.max(Number(row.swipe_id) || 0, 0), Math.max(swipes.length - 1, 0))

  const answer = answerFrom(textOf(row.mes), row, names)

  // A swipe is an answer the message was asked for again, which is what an
  // alternate is. Only once there is more than one: a message answered once
  // has none. The one showing is the message itself, `mes` and all — a
  // greeting's other swipes still have their macros in, but the one the chat
  // opened on was filled in when it opened.
  /** @type {MessageAlternate[]|null} */
  const alternates =
    swipes.length > 1
      ? swipes.map((swipe, index) =>
          index === showing ? answer : answerFrom(textOf(swipe), row.swipe_info?.[index], names)
        )
      : null

  return {
    id: `message_transcript_${at}`,
    chatId: '',
    role,
    ...answer,
    ...(alternates ? { alternates, alternate: showing } : {}),
    version: 1,
    created,
    updated: created,
  }
}

/**
 * What one generation wrote: a message's own fields, or one of its swipes'.
 *
 * @param {string} content
 * @param {any} info - The message, or the swipe's entry in `swipe_info`
 * @param {{char: string, user: string}} names
 * @returns {Required<MessageAlternate>}
 */
function answerFrom(content, info, names) {
  const reasoning = textOf(info?.extra?.reasoning).trim()
  const started = when(info?.gen_started)
  const thought = Number(info?.extra?.reasoning_duration)
  const model = textOf(info?.extra?.model).trim()
  const provider = textOf(info?.extra?.api).trim()

  return {
    content: substitute(content, names),
    reasoningContent: reasoning || null,
    streamingStartTime: started,
    streamingFinishTime: when(info?.gen_finished),
    thinkingFinishTime: reasoning && started !== null && thought > 0 ? started + thought : null,
    thinkingTime: reasoning && thought > 0 ? thought : null,
    edited: false,
    editedAt: null,
    // ST says which model wrote every answer, swipe by swipe. A greeting was
    // written by the card's author and says nothing.
    metadata: model ? { model, ...(provider ? { provider } : {}) } : null,
  }
}

/**
 * The Author's Note, when the chat was sending one.
 *
 * Despite the name it is not a note to self: ST inserts it into the prompt, a
 * few messages up from the end, on every turn or every few. How often is
 * `note_interval`, and zero is the off switch — the text is kept and never
 * sent, so it is not carried either.
 *
 * @param {any} metadata - The header's `chat_metadata`
 * @returns {string}
 */
function noteOf(metadata) {
  if (Number(metadata?.note_interval) === 0) return ''
  return textOf(metadata?.note_prompt).trim()
}

/** @param {any} row */
function isMessage(row) {
  return !!row && typeof row === 'object' && 'mes' in row && 'is_user' in row
}

/** @param {string} text */
function firstLine(text) {
  const trimmed = text.trimStart()
  const end = trimmed.indexOf('\n')
  return end === -1 ? trimmed : trimmed.slice(0, end)
}

/**
 * @param {string} line
 * @returns {any} The object on it, or null if it does not hold one
 */
function parseLine(line) {
  if (!line.trim()) return null
  try {
    const value = JSON.parse(line)
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

/** @param {any} value */
function textOf(value) {
  return typeof value === 'string' ? value : ''
}

/** @param {any} value - A name from the header, which newer builds leave as a placeholder */
function named(value) {
  const name = textOf(value).trim()
  return name && name !== UNUSED ? name : ''
}

/**
 * The name most of these messages were said under. Most, rather than the
 * first, because a narrator's aside or a guest in a group does not change who
 * the chat was with.
 *
 * @param {any[]} rows
 * @returns {string}
 */
function commonest(rows) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const row of rows) {
    const name = textOf(row.name).trim()
    if (name) counts.set(name, (counts.get(name) || 0) + 1)
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || ''
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]

/**
 * When something happened, from any of the ways ST has written that down.
 *
 * Milliseconds first, then `July 19, 2023 2:05pm`, then the stamp it also
 * puts in file names (a date, an at-sign, and `14h 05m 33s 123ms`), then ISO.
 * The two in the middle are parsed by hand: what a browser makes of a date
 * that is not ISO is the browser's business, and this runs in more than one.
 *
 * @param {any} value
 * @returns {number|null} Null when it says nothing this can read
 */
function when(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()

  const spoken = text.match(/^([a-z]+) (\d{1,2}), (\d{4}) (\d{1,2}):(\d{2})\s*([ap]m)$/i)
  if (spoken) {
    const month = MONTHS.indexOf(spoken[1].toLowerCase())
    if (month === -1) return null
    const hour = (Number(spoken[4]) % 12) + (spoken[6].toLowerCase() === 'pm' ? 12 : 0)
    return new Date(Number(spoken[3]), month, Number(spoken[2]), hour, Number(spoken[5])).getTime()
  }

  const stamped = text.match(
    /^(\d{4})-(\d{1,2})-(\d{1,2})\s*@\s*(\d{1,2})h\s*(\d{1,2})m\s*(\d{1,2})s(?:\s*(\d{1,3})ms)?$/
  )
  if (stamped) {
    const [year, month, day, hour, minute, second, ms] = stamped
      .slice(1)
      .map(part => Number(part) || 0)
    return new Date(year, month - 1, day, hour, minute, second, ms).getTime()
  }

  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const parsed = Date.parse(text)
    return Number.isNaN(parsed) ? null : parsed
  }

  return null
}

/**
 * A title from the file's name, which is `Elara - 2026-01-05@21h14m03s512ms`
 * until the writer renames it and `… - Branch #4` once they have branched.
 * The stamp says when the chat was started, which the messages say already.
 *
 * @param {string} filename
 * @returns {string}
 */
function titleFrom(filename) {
  return filename
    .replace(/\.jsonl?$/i, '')
    .replace(
      /\s*-?\s*\d{4}-\d{1,2}-\d{1,2}\s*@\s*\d{1,2}h\s*\d{1,2}m\s*\d{1,2}s(?:\s*\d{1,3}ms)?/i,
      ''
    )
    .trim()
}
