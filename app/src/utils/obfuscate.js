/**
 * @module utils/obfuscate
 * @description A chat export with its words taken out.
 *
 * For handing a chat to someone who needs its shape and not its story — how
 * many turns, how long, what the model was sent — without the story. Every
 * letter becomes a random letter of the same case, and nothing else changes:
 * digits, punctuation, whitespace, markdown and tags stay, so the text is the
 * same size and the same shape and says nothing. A letter is drawn afresh
 * every time, so the same word comes out differently each time it appears
 * and nothing can be read back off frequencies.
 *
 * Every string is scrambled unless it is known to hold the export together:
 * keys, ids, roles, timestamps, tool names, the names and parameters of
 * commands. That way round, so that a field nobody thought of cannot carry
 * the story out in plain text; what is kept is kept by name. The JSON inside a
 * tool call's arguments and a tool's result is scrambled inside its keys, so
 * it is still JSON of the same shape. A command that answers by rule — a
 * roll, an oracle, a drawn name — keeps its answer, since there is nothing in
 * it to hide; one that answers in prose loses it like the rest, and so does
 * one whose answer is the writer's own words given back, as a direction's
 * is: an answer the app drew is never the same words as the question. A turn made
 * of segments is put back together from the scrambled segments, the way the
 * app puts it together, so what the model would read and what is recorded
 * agree.
 */

/** @typedef {import('../types/models.js').Message} Message */
/** @typedef {import('../types/models.js').ChatCommand} ChatCommand */
/** @typedef {import('../types/models.js').MessageSegment} MessageSegment */

/**
 * @typedef {Object} ObfuscateOptions
 * @property {(command: ChatCommand) => boolean} [consults] - Whether a command's
 *   result is prose a model wrote, which is scrambled, rather than an answer
 *   by rule, which is kept. Absent, every result is scrambled.
 * @property {(segments: MessageSegment[]) => string} [assemble] - How a turn's
 *   content is made from its segments, for a message that has them. Absent,
 *   the content is scrambled on its own.
 * @property {() => number} [random] - Where the letters come from, for a test
 *   that wants the same ones twice.
 */

const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
const LOWER = 'abcdefghijklmnopqrstuvwxyz'

/**
 * Keys whose values hold the export together rather than say anything, and
 * so are kept wherever they occur: identifiers, kinds, roles and the like.
 * A key ending in Id or Ids is an identifier by convention.
 */
const KEPT_KEYS = new Set([
  'id',
  'type',
  'role',
  'kind',
  'status',
  'scope',
  'tool',
  'tool_call_id',
  '_document',
  'finish_reason',
  'object',
  'model',
  'provider',
  'dbVersion',
  'version',
])

/**
 * @param {string} key
 * @returns {boolean}
 */
const isKept = key => KEPT_KEYS.has(key) || /Ids?$/.test(key)

/**
 * The text with every letter replaced by a random letter of the same case.
 * A letter with no case of its own becomes a lowercase one. Everything that
 * is not a letter is left where it is.
 *
 * @param {string} text
 * @param {() => number} [random]
 * @returns {string}
 */
export function scrambleText(text, random = Math.random) {
  const pick = alphabet => alphabet[Math.floor(random() * alphabet.length)]
  return text.replace(/\p{L}/gu, letter => {
    if (/\p{Lu}/u.test(letter)) return pick(UPPER)
    return pick(LOWER)
  })
}

/**
 * A value with every string in it scrambled, keys and kept keys aside. The
 * same shape as it was given, which is why it answers as `any`: it is the
 * one rule everything else here starts from.
 *
 * @param {any} value
 * @param {() => number} random
 * @param {string} [key] - The key this value sits under, if any
 * @returns {any}
 */
function scrambleValue(value, random, key = '') {
  if (typeof value === 'string') return key && isKept(key) ? value : scrambleText(value, random)
  if (Array.isArray(value)) return value.map(item => scrambleValue(item, random, key))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([name, inner]) => [name, scrambleValue(inner, random, name)])
    )
  }
  return value
}

/**
 * Text that is JSON — a tool's arguments, a tool's result — scrambled inside
 * its structure, so it is still JSON with the same keys. Text that is not
 * JSON is scrambled as text.
 *
 * @param {string} text
 * @param {() => number} random
 * @returns {string}
 */
function scrambleJsonText(text, random) {
  try {
    return JSON.stringify(scrambleValue(JSON.parse(text), random))
  } catch {
    return scrambleText(text, random)
  }
}

/**
 * A command with everything scrambled but what makes it the command it is:
 * its name (a character's is the writer's, and goes), its parameter, and an
 * answer given by rule rather than in prose — which is never the writer's
 * own words given back, so an answer that is the input, or the question as
 * the model read it, is the writer's and goes too.
 *
 * @param {ChatCommand} command
 * @param {Required<Pick<ObfuscateOptions, 'consults' | 'random'>>} options
 * @returns {ChatCommand}
 */
function scrambleCommand(command, { consults, random }) {
  const out = /** @type {ChatCommand} */ (scrambleValue(command, random))
  const echoed = command.result === command.input || command.result === command.label
  const spoken = command.character === true || consults(command) || echoed
  return {
    ...out,
    ...(command.character ? {} : { name: command.name }),
    ...(command.param !== undefined ? { param: command.param } : {}),
    ...(command.result !== undefined && !spoken ? { result: command.result } : {}),
  }
}

/**
 * What a skill did on its way to its answer, scrambled the way a turn's own
 * calls are: each tool kept by name, with what it was asked and what it
 * answered scrambled inside their JSON.
 *
 * @param {any} consultation
 * @param {() => number} random
 * @returns {any}
 */
function scrambleConsultation(consultation, random) {
  const out = scrambleValue(consultation, random)
  if (Array.isArray(consultation.calls)) {
    out.calls = consultation.calls.map(call => ({
      ...scrambleValue(call, random),
      name: call.name,
      ...(typeof call.arguments === 'string'
        ? { arguments: scrambleJsonText(call.arguments, random) }
        : {}),
      ...(typeof call.result === 'string' ? { result: scrambleJsonText(call.result, random) } : {}),
      ...(call.consultation
        ? { consultation: scrambleConsultation(call.consultation, random) }
        : {}),
    }))
  }
  return out
}

/**
 * One message of the model's trajectory, or of a saved request: everything
 * scrambled, with what a tool answered scrambled inside its JSON and what the
 * model called kept by name with its arguments scrambled inside theirs.
 *
 * @param {any} item
 * @param {() => number} random
 * @returns {any}
 */
function scrambleApiMessage(item, random) {
  if (!item || typeof item !== 'object') return item
  const out = scrambleValue(item, random)
  if (item.role === 'tool' && typeof item.content === 'string') {
    out.content = scrambleJsonText(item.content, random)
  }
  if (item._consultation) out._consultation = scrambleConsultation(item._consultation, random)
  if (Array.isArray(item.tool_calls)) {
    out.tool_calls = item.tool_calls.map(call => {
      const scrambled = scrambleValue(call, random)
      if (!call.function) return scrambled
      return {
        ...scrambled,
        function: {
          ...scrambleValue(call.function, random),
          name: call.function.name,
          ...(typeof call.function.arguments === 'string'
            ? { arguments: scrambleJsonText(call.function.arguments, random) }
            : {}),
        },
      }
    })
  }
  return out
}

/**
 * @param {any} metadata
 * @param {Required<Pick<ObfuscateOptions, 'consults' | 'random'>>} options
 * @returns {any}
 */
function scrambleMetadata(metadata, options) {
  if (!metadata || typeof metadata !== 'object') return metadata
  const { random } = options
  const out = scrambleValue(metadata, random)
  if (metadata.command) out.command = scrambleCommand(metadata.command, options)
  if (Array.isArray(metadata.apiTrajectory)) {
    out.apiTrajectory = metadata.apiTrajectory.map(item => scrambleApiMessage(item, random))
  }
  if (Array.isArray(metadata.context)) {
    out.context = metadata.context.map(item => scrambleApiMessage(item, random))
  }
  return out
}

/**
 * A message, or one of its alternates, with its words taken out: everything
 * by the one rule first, and then the parts that need more care.
 *
 * @param {any} message
 * @param {Required<ObfuscateOptions>} options
 * @returns {any}
 */
function scrambleMessage(message, options) {
  const { random, assemble } = options
  const out = scrambleValue(message, random)
  if (message.metadata) out.metadata = scrambleMetadata(message.metadata, options)

  if (Array.isArray(message.segments)) {
    out.segments = message.segments.map(segment =>
      segment.type === 'command'
        ? { ...scrambleValue(segment, random), command: scrambleCommand(segment.command, options) }
        : scrambleValue(segment, random)
    )
    out.content = assemble(out.segments)
  } else if (message.metadata?.command && message.content === message.metadata.command.result) {
    // A message that is nothing but a command holds its answer as its
    // content, the same words twice, and is kept that way.
    out.content = out.metadata.command.result
  }

  if (Array.isArray(message.alternates)) {
    out.alternates = message.alternates.map(alternate => scrambleMessage(alternate, options))
  }
  if (Array.isArray(message.pendingToolCalls)) {
    out.pendingToolCalls = message.pendingToolCalls.map(call => ({
      ...scrambleValue(call, random),
      name: call.name,
      ...(typeof call.arguments === 'string'
        ? { arguments: scrambleJsonText(call.arguments, random) }
        : {}),
    }))
  }
  return out
}

/**
 * A backup envelope — a whole one, or the one chat a chat is exported in —
 * with its words taken out and everything else as it was.
 *
 * @template {{ tables?: Record<string, any[]> }} T
 * @param {T} backup
 * @param {ObfuscateOptions} [options]
 * @returns {T}
 */
export function obfuscateBackup(backup, options = {}) {
  /** @type {Required<ObfuscateOptions>} */
  const settings = {
    consults: options.consults ?? (() => true),
    // Without the app's own way of assembling a turn, its pieces in order.
    assemble:
      options.assemble ??
      (segments =>
        segments
          .map(segment => (segment.type === 'command' ? segment.command.result : segment.content))
          .join('\n\n')),
    random: options.random ?? Math.random,
  }
  const tables = backup.tables ?? {}
  const scrambled = Object.fromEntries(
    Object.entries(tables).map(([table, rows]) => {
      if (!Array.isArray(rows)) return [table, rows]
      if (table === 'messages') return [table, rows.map(row => scrambleMessage(row, settings))]
      if (table === 'chats') {
        return [
          table,
          rows.map(row =>
            Object.fromEntries(
              Object.entries(row).map(([key, value]) => [
                key,
                typeof value === 'string' && ['title', 'description', 'rules'].includes(key)
                  ? scrambleText(value, settings.random)
                  : value,
              ])
            )
          ),
        ]
      }
      // Anything else — a prompt that travels with the chat, a whole backup's
      // documents — is scrambled by the one rule: strings, keys and kept keys
      // aside.
      return [table, rows.map(row => scrambleValue(row, settings.random))]
    })
  )
  return { ...backup, tables: scrambled }
}
