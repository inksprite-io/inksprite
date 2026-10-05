/**
 * @module composables/useChatCommands
 * @description Running a slash command against a chat.
 *
 * The command itself is ai/commands.js and knows nothing about chats. This is
 * the half that writes the answer into one: a message the writer authored,
 * carrying the record of what they ran so it can be shown, rerun, and read back
 * by the context builder.
 *
 * One speaker per message. The writer rolling an oracle, saying what their
 * character does, and telling the Director the scene has gone on long enough is
 * one turn taken in pieces, so it is one message holding those pieces as
 * segments — they chose to ask, and the answer is established fact by the time
 * the model reads it. Nothing is inferred and no turn is generated: a command
 * settles something *before* there is anything to narrate, which is the whole
 * point of being able to run three of them and then say one sentence.
 *
 * The message's own content is the segments assembled — what the model reads,
 * written once by `assembleTurn` and never by hand. Segments are the writer's
 * side of it: what they can look at, ask again, and take back out.
 *
 * A command that consults is the exception, and only because it is not really
 * one: an interpretation is prose a model wrote, in the same voice everything
 * else in the assistant slot is written in — a different speaker, so a message
 * of its own rather than a segment of somebody else's. It holds the answer
 * alone, and the tag naming what answered goes on in ai/context/build.js on the
 * way to the wire. What that buys is the thing every other assistant turn
 * already had: the answer arriving as it is written, rather than a wait with
 * nothing moving and then a paragraph.
 *
 * The writer's turn stays one message however it is taken. More written under
 * a turn pushed in without a reply joins that turn, and two of their messages
 * left touching when the reply between them goes are folded back into one. It
 * was always sent as one — see `mergeAdjacentTurns` — and one message is what
 * lets it be edited, deleted and read as the thing it is. See utils/turns.js.
 */

import { useChats } from './useChats.js'
import {
  splitInput,
  splitAnswered,
  inspectCommand,
  askedCommand,
  pendingCommand,
  runCommand,
  assembleTurn,
  pendingSegment,
  commandTakesTurn,
  commandSpeaks,
} from '@/ai/commands.js'
import { CommandError } from '@/utils/errors.js'
import { groupTurns } from '@/utils/turns.js'
import { KEPT_OPENING, compactionCover, isCompaction } from '@/ai/compaction.js'

/** @typedef {import('../types/models.js').Message} Message */
/** @typedef {import('../types/models.js').ChatCommand} ChatCommand */
/** @typedef {import('../ai/tools/registry.js').ToolContext} ToolContext */
/** @typedef {import('../ai/commands.js').CommandInput} CommandInput */
/** @typedef {import('../types/models.js').MessageSegment} MessageSegment */

/**
 * What a message of the writer's is made of. Every one has carried its pieces
 * since schema 11; one that somehow does not is its content, as one piece.
 *
 * @param {Message} message
 * @returns {MessageSegment[]}
 */
function piecesOf(message) {
  if (Array.isArray(message.segments)) return message.segments
  return message.content ? [{ type: 'text', content: message.content }] : []
}

/**
 * @param {string} storyId
 * @param {string} chatId
 * @returns {{
 *   submit: (input: string, context?: ToolContext) => Promise<{spoken: string}>,
 *   rerun: (messageId: string, index?: number|null, context?: ToolContext) => Promise<Message>,
 *   revise: (messageId: string, at: number|null, text: string, context?: ToolContext) => Promise<Message>,
 *   remove: (messageId: string, index?: number|null) => void
 * }}
 */
export function useChatCommands(storyId, chatId) {
  const chatsApi = useChats(storyId)

  /**
   * The chat as it reads, in order.
   * @returns {Message[]}
   */
  const history = () => chatsApi.getMessagesForChat(chatId)?.value || []

  /**
   * How far a summary can move from where it is, up the chat and down it.
   *
   * No further than the summary either side of it, and never above how the
   * conversation opened. Only the newest summary is read, so the newest has to
   * sit lowest: one that keeps four turns, asked for two turns after the last,
   * would otherwise land above it, and the last — written into the new one
   * already — would be read again as a turn under it.
   *
   * @param {string} messageId - The summary, which may still be being written
   * @returns {{up: number, down: number}}
   */
  const roomFor = messageId => {
    const messages = history()
    const at = messages.findIndex(message => message.id === messageId)
    if (at === -1) return { up: 0, down: 0 }

    let up = 0
    while (at - up - 1 >= KEPT_OPENING && !isCompaction(messages[at - up - 1])) up++
    let down = 0
    while (at + down + 1 < messages.length && !isCompaction(messages[at + down + 1])) down++

    return { up, down }
  }

  /**
   * The turn the writer is still taking, when the last thing in the chat is
   * theirs. See the module note: it is one turn, so it is one message.
   *
   * @returns {Message|null}
   */
  const openTurn = () => {
    const last = history().at(-1)
    return last?.role === 'user' && Array.isArray(last.segments) ? last : null
  }

  /**
   * Record everything a submission contains, in the order it was written.
   *
   * Commands all run before anything is written, so a mistyped one leaves the
   * chat exactly as it was and the writer gets their text back to fix. Once
   * they have all answered, the segments are written in order — which is the
   * point of doing it this way at all: a direction belongs after the sentence
   * it is about, and an oracle after the action it resolves.
   *
   * What comes back is the prose, for the caller to decide whether there is
   * anything here to answer — which counts a character's line, since somebody
   * acting is the turn being taken. A submission of nothing but tools settles
   * things and asks for no turn.
   *
   * @param {string} input - Everything the writer submitted
   * @returns {Promise<{spoken: string}>} The prose among it, joined
   * @throws {CommandError} If a command cannot run. Nothing has been written.
   */
  const submit = async (input, context = {}) => {
    const segments = splitInput(input)

    // Everything that can be refused for free is refused here, before a word
    // is written: an unknown command, a question nobody asked. Past this point
    // a consulting command has a message of its own and a failure lands in it.
    //
    // A command that answers on a turn of its own is the last thing a
    // submission can hold, because the writer's words cannot be on both sides
    // of a turn that is not theirs. Everything else answers into this one,
    // whatever it had to ask to do it.
    let apart = ''
    for (const segment of segments) {
      if (apart) {
        throw new CommandError(
          `/${apart} answers on a turn of its own, so nothing can follow it here.`
        )
      }

      if (segment.type !== 'command') continue

      const { error } = inspectCommand(segment)
      if (error) throw new CommandError(error)
      if (commandTakesTurn(segment)) apart = segment.name
    }

    // The instant ones run before anything is written, so a chat that is about
    // to be refused is left exactly as it was. One the writer answered for
    // themselves is not asked at all — that is how an edited turn keeps the
    // answers it had, and how a roll gets fudged.
    /** @type {Map<number, ChatCommand>} */
    const answers = new Map()
    for (const [index, segment] of segments.entries()) {
      if (segment.type !== 'command') continue

      if (segment.result !== undefined) {
        answers.set(index, { ...askedCommand(segment), result: segment.result })
        continue
      }

      if (inspectCommand(segment).consults) continue

      // With the turn's context, for the one kind that reads it: a saved
      // prompt takes the profile's wording of its skill.
      const command = await runCommand(segment, context)
      if ('error' in command) throw new CommandError(command.error)
      answers.set(index, command)
    }

    /** @type {string[]} */
    const spoken = []
    /** @type {Array<() => Promise<void>>} */
    const pending = []

    // What the writer is saying, in the pieces they said it in.
    /** @type {MessageSegment[]} */
    let turn = []
    /** Pieces with no answer yet, by where they sit in the turn. */
    /** @type {Array<{at: number, asked: CommandInput}>} */
    let waiting = []

    // Written into the turn the writer is already taking when there is one,
    // and as a message of its own otherwise. Either way, the pieces still
    // waiting on an answer are filled in where they landed.
    const closeTurn = () => {
      if (turn.length === 0) return

      const open = openTurn()
      let id
      let offset = 0
      if (open) {
        // Counted before the write, which replaces the segments on the very
        // message `open` is: read after it, the new pieces would be counted
        // twice and every answer filled in past the end of the turn.
        offset = open.segments.length
        const segments = [...open.segments, ...turn]
        chatsApi.writeTurn(open.id, segments, assembleTurn(segments))
        id = open.id
      } else {
        const written = chatsApi.addMessage(chatId, 'user', assembleTurn(turn), null, turn)
        if (!written) throw new Error('Failed to add user message')
        id = written.id
      }

      for (const { at, asked } of waiting) {
        pending.push(() => fill(id, offset + at, asked, context))
      }
      turn = []
      waiting = []
    }

    for (const [index, segment] of segments.entries()) {
      if (segment.type === 'text') {
        turn.push({ type: 'text', content: segment.content })
        spoken.push(segment.content)
        continue
      }

      const answered = answers.get(index)
      if (answered) {
        turn.push({ type: 'command', command: answered })
        // A character's line is a turn: they did something, and the table is
        // waiting on what happens next. So is a saved prompt, which is the
        // writer asking for something. Everything else settles something
        // *before* there is a turn to take, which is why a run of oracles asks
        // for nothing.
        if (commandSpeaks(answered)) spoken.push(answered.result)
        continue
      }

      // One that answers on a turn of its own closes whatever the writer was
      // saying and takes a message. Nothing follows it — the refusal above is
      // what makes that true.
      if (commandTakesTurn(segment)) {
        closeTurn()

        const message = chatsApi.addMessage(chatId, 'assistant', '')
        if (!message) throw new Error('Failed to add command message')

        // A summary goes above the turns it was asked to keep, which is where
        // it is read, and is written there as the writer watches. When there
        // are not that many to keep it keeps what there are, and says so: the
        // count on the record is how far past itself it reads when asked
        // again, and has to be what happened. See ai/compaction.js.
        const wanted = askedCommand(segment).keep
        const room = typeof wanted === 'number' ? roomFor(message.id).up : 0
        const asked = wanted > room ? { ...segment, param: String(room) } : segment

        chatsApi.updateMessage(message.id, {
          metadata: { command: pendingCommand(asked) },
          streamingStartTime: Date.now(),
        })
        if (wanted > 0 && room > 0) chatsApi.moveMessage(message.id, Math.min(wanted, room))
        pending.push(() => fill(message.id, null, asked, context))
        continue
      }

      // Everything else is a piece of this turn, written before it can answer
      // so the writer sees the question the moment they ask it — and watches
      // the answer arrive in the place it will stay.
      waiting.push({ at: turn.length, asked: segment })
      turn.push(pendingSegment(segment))
    }

    closeTurn()

    // Sequential, because a consultation and the turn behind it share one
    // abort controller.
    for (const call of pending) await call()

    return { spoken: spoken.join('\n\n') }
  }

  /**
   * Run a command whose message is already in the chat, and fill it in.
   *
   * A failure is recorded rather than thrown. The message exists and the writer
   * is looking at it; taking it away to report the failure elsewhere would lose
   * the question they asked, which is the part worth keeping — they can ask
   * again from the message itself.
   *
   * @param {string} messageId
   * @param {number|null} index - Which piece of the turn, or null for a message
   *   that is nothing but this command
   * @param {CommandInput} parsed
   * @param {ToolContext} context
   * @returns {Promise<void>}
   */
  const fill = async (messageId, index, parsed, context) => {
    // What the stream put on the record while the answer was arriving. It
    // belongs to the answer, and the answer is about to be replaced by the
    // finished one, so it is carried across rather than left behind.
    /** @type {{result?: string, reasoning?: string, thought?: number}} */
    const streamed = {}

    let command
    try {
      const outcome = await runCommand(
        parsed,
        watched({ messageId, index, parsed, streamed }, context)
      )
      command = 'error' in outcome ? { ...askedCommand(parsed), error: outcome.error } : outcome
    } catch (error) {
      // Including a request that threw rather than answering. Whatever happens
      // this stops pending: a question that never resolves is worse than one
      // that says what went wrong.
      command = { ...askedCommand(parsed), error: error.message }
    }

    // Stopped by the writer, which is what it says, and only if it is still
    // there to say it: deleted, or asked again from further up, there is
    // nothing left to fill in.
    if (context.signal?.aborted) {
      if (!chatsApi.getMessageById(messageId)?.value) return
      command = { ...askedCommand(parsed), error: 'Stopped.' }
    }

    const { result: _said, ...thinking } = streamed
    writeCommand(messageId, index, { ...command, ...thinking }, { streamed: true })

    if (index === null || index === undefined) {
      const already = chatsApi.getMessageById(messageId)?.value?.thinkingFinishTime
      chatsApi.updateMessage(messageId, {
        thinkingFinishTime: already || Date.now(),
        streamingFinishTime: Date.now(),
      })
    }
  }

  /**
   * The same context, tied to the record the answer is being written into.
   *
   * Two things this layer knows and the command does not. The first is where to
   * put the answer and the thinking: a command with a model behind it gets the
   * same treatment every other message with a model behind it gets — the writer
   * watches it think and reads what it made of the draw as it is written, which
   * is the only view there is of an interpretation's working, since the pair
   * itself never leaves the skill.
   *
   * The second is where the question sits. A consultation reads the
   * conversation as it stood *before* the message holding it — never itself,
   * and never, on a second asking, a conversation that has moved on since. An
   * interpretation made at turn ten is about the story at turn ten however many
   * times it is asked for. A compaction is the one that reads a little past
   * itself — it sits above the turns it kept and read them too — but only that
   * far, so it is about the same conversation however many times it is asked.
   *
   * @param {{messageId: string, index: number|null, parsed: CommandInput, streamed: Object}} into
   * @param {ToolContext} context
   * @returns {ToolContext}
   */
  const watched = ({ messageId, index, parsed, streamed }, context) => {
    if (typeof context.consult !== 'function') return context

    const started = Date.now()

    const show = () => {
      const command = { ...askedCommand(parsed), pending: true, ...streamed }

      // A message that is nothing but this command has its own content and its
      // own reasoning to stream into. A piece of a turn keeps both on the
      // record, because the turn's content is every piece assembled.
      if (index === null || index === undefined) {
        chatsApi.streamMessageContent(
          messageId,
          command.result || '',
          command.reasoning ?? null,
          streamed.thought ? { thinkingFinishTime: started + streamed.thought } : {}
        )
        return
      }

      writeCommand(messageId, index, command, { streamed: true })
    }

    return {
      ...context,
      consult: (systemPrompt, toolNames, options) =>
        context.consult(systemPrompt, toolNames, {
          ...options,
          onContent: said => {
            streamed.result = said
            // The moment it stopped thinking and started writing, rather than
            // when the last word landed.
            streamed.thought = streamed.thought ?? Date.now() - started
            show()
          },
          onReasoning: thinking => {
            streamed.reasoning = thinking
            show()
          },
          // Last, so it is not a command's to talk its way past.
          before: messageId,
        }),
    }
  }

  /**
   * The command at an address, wherever a command is kept.
   *
   * Two places, because there are two kinds of turn. One the writer took is a
   * message of segments and a command is one of them, named by its index. One
   * somebody else took is a message of its own, and there is nothing to index.
   *
   * @param {string} messageId
   * @param {number|null} [index] - Which segment, on a turn the writer took
   * @returns {ChatCommand}
   * @throws {Error} If there is no command there
   */
  const commandOf = (messageId, index) => {
    const message = chatsApi.getMessageById(messageId)?.value

    if (index === undefined || index === null) {
      const command = message?.metadata?.command
      if (!command) throw new Error('That message is not a command.')
      return command
    }

    const segment = message?.segments?.[index]
    if (segment?.type !== 'command') throw new Error('That is not a command.')
    return segment.command
  }

  /**
   * Put a command back where it came from.
   *
   * A segment carries the turn's own content with it, because the content is
   * the segments assembled and one of them has just changed. There is nothing
   * to assemble on a message that is only ever one command.
   *
   * @param {string} messageId
   * @param {number|null} index
   * @param {ChatCommand} command
   */
  const writeCommand = (messageId, index, command, { streamed = false } = {}) => {
    if (index === undefined || index === null) {
      chatsApi.updateMessage(messageId, { content: command.result || '', metadata: { command } })
      return
    }

    const segments = (chatsApi.getMessageById(messageId)?.value?.segments || []).map(
      (segment, at) =>
        at === index ? { type: /** @type {const} */ ('command'), command } : segment
    )
    const content = assembleTurn(segments)

    // An answer arriving a word at a time, or a question asked again, is not
    // the writer having been back to change something — and `updateMessage`
    // would record it as exactly that.
    if (streamed) chatsApi.writeSegment(messageId, index, command, content)
    else chatsApi.updateMessage(messageId, { segments, content })
  }

  /**
   * Take messages out of the chat.
   *
   * @param {string[]} ids
   */
  const drop = ids => {
    for (const id of ids) chatsApi.deleteMessage(id)
  }

  /**
   * Fold the writer's messages back into one wherever two are left touching.
   *
   * With whatever stood between them gone they are one turn, and were always
   * sent as one; as one message they can be edited and read as one. A turn
   * that had been edited still has been, and is written so. Nothing else about
   * this is the writer having changed anything.
   */
  const fold = () => {
    const messages = history()
    for (const turn of groupTurns(messages, compactionCover(messages))) {
      if (turn.role !== 'user' || turn.messages.length < 2) continue

      const [first, ...rest] = turn.messages
      const segments = turn.messages.flatMap(piecesOf)
      const content = assembleTurn(segments)

      if (turn.messages.some(message => message.edited)) {
        chatsApi.updateMessage(first.id, { segments, content })
      } else {
        chatsApi.writeTurn(first.id, segments, content)
      }
      drop(rest.map(message => message.id))
    }
  }

  /**
   * Take one thing back out of a turn.
   *
   * A turn with nothing left in it is not a turn, so it goes rather than
   * sitting there empty. Anything without an index is a whole message, and
   * what its going leaves touching is folded back together. See `fold`.
   *
   * @param {string} messageId
   * @param {number|null} [index]
   */
  const remove = (messageId, index) => {
    if (index === undefined || index === null) {
      drop([messageId])
      fold()
      return
    }

    const segments = (chatsApi.getMessageById(messageId)?.value?.segments || []).filter(
      (_, at) => at !== index
    )

    if (segments.length === 0) {
      drop([messageId])
      fold()
      return
    }

    chatsApi.updateMessage(messageId, { segments, content: assembleTurn(segments) })
  }

  /**
   * Put the question to the command again and keep whatever it says.
   *
   * @param {string} messageId
   * @param {number|null} index
   * @param {CommandInput} parsed
   * @param {ToolContext} context
   * @returns {Promise<Message>}
   */
  const ask = async (messageId, index, parsed, context) => {
    // One that costs a model call goes back to pending first, so the writer can
    // see it is being asked again rather than watching a stale answer sit there
    // — the old one included, since the answer is the content now.
    if (inspectCommand(parsed).consults) {
      if (index === null || index === undefined) {
        chatsApi.updateMessage(messageId, {
          content: '',
          metadata: { command: pendingCommand(parsed) },
          reasoningContent: null,
          streamingStartTime: Date.now(),
          thinkingFinishTime: null,
        })
      } else {
        writeCommand(messageId, index, pendingCommand(parsed), { streamed: true })
      }

      await fill(messageId, index, parsed, context)
      return chatsApi.getMessageById(messageId)?.value
    }

    // Everything else answers now, so there is no pending state worth showing.
    const outcome = await runCommand(parsed, context)
    writeCommand(
      messageId,
      index,
      'error' in outcome ? { ...askedCommand(parsed), error: outcome.error } : outcome,
      { streamed: true }
    )
    return chatsApi.getMessageById(messageId)?.value
  }

  /**
   * Ask the same question again and keep the new answer.
   *
   * The same question, not the same result: the point of asking again is that
   * the dice are the dice. What was there is replaced rather than added to, so
   * a question the writer did not like the answer to leaves one answer behind
   * and not an argument between two.
   *
   * @param {string} messageId - A message carrying a command
   * @param {ToolContext} [context] - What a consulting command needs to run
   * @returns {Promise<Message>}
   */
  const rerun = async (messageId, index = null, context = {}) => {
    const { name, input, param, character } = commandOf(messageId, index)
    return ask(messageId, index, { name, input, param, character }, context)
  }

  /**
   * The record this parsed command already has, if it is one that survived.
   *
   * Identity is the whole line and the answer under it: same command, same
   * question, same answer. That is what makes it safe where matching questions
   * up would not be — two identical oracles are told apart by what they said,
   * and one whose answer the writer changed is not the same record any more.
   *
   * What it saves is the working. A roll's dice and an interpretation's
   * thinking cannot be recovered from the text, so a line that came through an
   * edit untouched keeps them.
   *
   * @param {import('../types/models.js').MessageSegment[]} spare - Mutated: the
   *   match is taken out, so two identical lines take two records
   * @param {CommandInput & {result?: string}} parsed
   * @returns {ChatCommand|null}
   */
  const takeSurvivor = (spare, parsed) => {
    const { asked } = inspectCommand(parsed)
    const at = spare.findIndex(
      segment =>
        segment.type === 'command' &&
        segment.command.name === asked.name &&
        segment.command.input === asked.input &&
        segment.command.param === asked.param &&
        (segment.command.result || '') === (parsed.result || '')
    )
    if (at === -1) return null

    const [survivor] = spare.splice(at, 1)
    return survivor.type === 'command' ? survivor.command : null
  }

  /**
   * Rewrite a turn, or one piece of it, from the text the writer edited.
   *
   * The text is the turn: commands as they would be typed, answers written
   * under them, prose as prose. Anything that came through unchanged keeps the
   * record it had — including the working, which the text cannot carry — and
   * anything new is run. A command whose answer the writer wrote or changed is
   * taken at their word rather than asked again, which is what lets a roll be
   * fudged and an untouched question stay answered.
   *
   * @param {string} messageId
   * @param {number|null} at - Which piece, or null for the whole turn
   * @param {string} text - The turn as the writer has now written it
   * A context with no model to consult — which is what the caller passes while
   * one is already answering — still takes every edit that asks nothing new of
   * it, and refuses the ones that do.
   *
   * @param {ToolContext} [context] - What a consulting command needs to run
   * @returns {Promise<Message>}
   * @throws {CommandError} If it cannot be run as written. Nothing has changed.
   */
  const revise = async (messageId, at, text, context = {}) => {
    const message = chatsApi.getMessageById(messageId)?.value

    // A message that is nothing but a command has no pieces, but it edits the
    // same way: one command, written as a line with its answer under it —
    // unquoted, since there is nothing else for the answer to be told from.
    const alone = !message?.segments && message?.metadata?.command
    const parsed = alone ? splitAnswered(text) : splitInput(text)

    if (parsed.length === 0) {
      throw new CommandError('There is nothing there. Delete it instead.')
    }

    const held = alone
      ? [{ type: /** @type {const} */ ('command'), command: message.metadata.command }]
      : message?.segments || []

    // Everything refusable is refused before a word changes, the same as a
    // submission — and for the same reason.
    for (const segment of parsed) {
      if (segment.type !== 'command') continue

      const { error } = inspectCommand(segment)
      if (error) throw new CommandError(error)

      // A turn holds what answers into it, and a message that answers alone
      // holds only itself. Neither can become the other in place.
      if (commandTakesTurn(segment) !== Boolean(alone)) {
        throw new CommandError(
          alone
            ? `A /${message.metadata.command.name} stays a /${message.metadata.command.name} here.`
            : `/${segment.name} answers on a turn of its own, not inside one.`
        )
      }
    }

    if (alone && (parsed.length !== 1 || parsed[0].type !== 'command')) {
      throw new CommandError(`A /${message.metadata.command.name} is one thing, not several.`)
    }

    // A summary sits above the turns it kept, so keeping a different number of
    // them is moving it — as far as there is room to, which is what the record
    // is then made to say. Nothing is summarised again: it read those turns
    // either way, and says what it said.
    let shift = 0
    if (alone && typeof alone.keep === 'number' && parsed[0].type === 'command') {
      const wanted = askedCommand(parsed[0]).keep
      if (typeof wanted === 'number' && wanted !== alone.keep) {
        const { up, down } = roomFor(messageId)
        shift = Math.max(-down, Math.min(up, wanted - alone.keep))
        if (shift !== wanted - alone.keep) {
          parsed[0] = { ...parsed[0], param: String(alone.keep + shift) }
        }
      }
    }

    const spare = at === null || at === undefined ? [...held] : held.slice(at, at + 1)

    /** @type {MessageSegment[]} */
    const next = []
    /** @type {Array<{at: number, asked: CommandInput}>} */
    const waiting = []

    for (const segment of parsed) {
      if (segment.type === 'text') {
        next.push({ type: 'text', content: segment.content })
        continue
      }

      const survivor = takeSurvivor(spare, segment)
      if (survivor) {
        next.push({ type: 'command', command: survivor })
        continue
      }

      if (segment.result !== undefined) {
        next.push({
          type: 'command',
          command: { ...askedCommand(segment), result: segment.result },
        })
        continue
      }

      if (inspectCommand(segment).consults) {
        waiting.push({ at: next.length, asked: segment })
        next.push(pendingSegment(segment))
        continue
      }

      const outcome = await runCommand(segment, context)
      if ('error' in outcome) throw new CommandError(outcome.error)
      next.push({ type: 'command', command: outcome })
    }

    const [unanswerable] = waiting
    if (unanswerable && typeof context.consult !== 'function') {
      throw new CommandError(
        `/${unanswerable.asked.name} asks the model, which is busy. Save it once the reply is in.`
      )
    }

    if (alone) {
      const [only] = next
      if (only.type === 'command') {
        if (shift !== 0) chatsApi.moveMessage(messageId, shift)
        writeCommand(messageId, null, only.command)
      }
      for (const { asked } of waiting) await fill(messageId, null, asked, context)
      return chatsApi.getMessageById(messageId)?.value
    }

    const segments =
      at === null || at === undefined
        ? next
        : [...held.slice(0, at), ...next, ...held.slice(at + 1)]
    const offset = at === null || at === undefined ? 0 : at

    chatsApi.updateMessage(messageId, { segments, content: assembleTurn(segments) })

    for (const { at: where, asked } of waiting) {
      await fill(messageId, offset + where, asked, context)
    }

    return chatsApi.getMessageById(messageId)?.value
  }

  return { submit, rerun, revise, remove }
}
