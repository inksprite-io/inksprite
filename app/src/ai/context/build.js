/**
 * @module ai/context/build
 * @description Build chat completion messages for the AI request.
 *
 * The model reaches the project through tools, and a small block rides at the
 * tail of every conversation carrying what is true right now: the project's
 * name and overview, how much is in it, the current text of the documents the
 * writer pinned, and which documents read earlier have changed since. Not the
 * tree: the block moves forward to the newest message every turn, so no
 * prompt cache ever covers it, and what is in it is paid in full on every
 * request. The model lists the project with a tool when it needs to.
 *
 * A pin is on the chat, not in the history, so it outlives the turns that made
 * it and a compaction that replaces them. Only the writer pins. See
 * pinnedContent.
 *
 * Every call a turn made goes back on every later turn, where it was made, with
 * its result and without its words — the turn's content is the one copy of
 * what was said, which is what makes it the writer's to edit. A read the model
 * can no longer see is one it reads again or paraphrases; a history in which
 * it rolled is the one thing that keeps it rolling; and a history in which
 * answers came out of nowhere teaches it that they do. A call that stays where
 * it was made never moves, so the prompt cache keeps it. A summary is where
 * calls are let go. A read is a record of one moment, so the project block
 * says which documents read in view have changed since (ai/context/reads.js).
 *
 * Turns from before keep going back as they did, so that an old chat does not
 * grow by every call it ever made: one written while only the document calls
 * went back sends those, and one from before that sends none. See
 * .llm/web_search_design.md and .llm/project_context_design.md.
 *
 * A skill the model loaded goes back from every turn, however old. What
 * `use_skill` answered is instructions to follow from then on, and they go
 * back where they were loaded on every request, so they are still followed at
 * turn two hundred and the prefix before them is never disturbed. A summary
 * that stands in for the turn that loaded one has it carried to just under it,
 * and the writer's loads with it. A load the writer dropped is read where it
 * is until a summary stands in for it, and is not carried under one. See
 * ai/skills/loads.js.
 *
 * The tree used to sit in the system message, and that was worse on both
 * counts it was meant to help: the model itself churns the project, so the
 * cached prefix broke on the next turn anyway. What was wrong was the
 * placement, not the idea. At the tail the block sits after every cache
 * breakpoint, so it can change as often as the project does without
 * invalidating a single completed turn — and nobody spends a round trip
 * asking what already exists.
 *
 * A chat that plays a card has names for its macros, and they are filled in
 * here in what the chat holds as written: the prompt, the author's note and
 * the pinned documents. The tools fill in what they read the same way; see
 * cards/macros.js.
 *
 * Nothing here is persisted. The block is built per request; the stored
 * conversation holds only what the writer and the model actually said.
 */

import { applyCompaction, isCompaction } from '@/ai/compaction.js'
import { renderCommand } from '@/ai/commands.js'
import { USE_SKILL, carriedLoads, loadedText } from '@/ai/skills/loads.js'
import { changedSinceRead, keepsDocumentCalls, keepsEveryCall } from './reads.js'
import { substitute } from '@/cards/macros.js'

/**
 * What to call the two voices when the caller has not said.
 *
 * The roles as the API names them, because that is the one thing true of every
 * conversation this builds. A skill that reads a conversation with a vocabulary
 * of its own passes that instead — see TABLE_ROLES.
 *
 * @type {TranscriptRoles}
 */
export const DEFAULT_TRANSCRIPT_ROLES = { user: 'user', assistant: 'assistant' }

/**
 * @typedef {{ role: 'system'|'user'|'assistant'|'tool', content: string|null, tool_call_id?: string, tool_calls?: any[], reasoning_details?: any[] }} ChatMessage
 *
 * @typedef {Object} BuildOptions
 * @property {string} storyId
 * @property {string} [documentId] - Summarize mode only; the document to summarize
 * @property {string} [chatId] - For chat mode
 * @property {string} systemPrompt
 * @property {string} [userPrompt] - Summarize mode only
 * @property {import('@/ai/tools/documents.js').ProjectOverview|null} [project] -
 *   The project's name, overview and size, for the block. Supplied by the
 *   caller, so this module keeps taking everything it reads as an argument
 *   rather than reaching for a store. Absent means no block.
 * @property {string} [note] - The chat's author's note: the writer's standing
 *   instructions, sent after the project block and ahead of what they said.
 *   Not read in a transcript — a skill reading the conversation is not the
 *   one the note is addressed to. See `renderAuthorsNote`.
 * @property {import('@/ai/tools/documents.js').DocumentListing[]} [pinned] -
 *   Documents whose text rides in the project block on every turn: the
 *   writer's pins. Already resolved: folders expanded, hidden left out. See
 *   `pinnedDocuments`.
 * @property {TranscriptRoles} [transcript] - Set to hand the conversation over
 *   as a transcript inside one user message, under these names, rather than as
 *   messages. For a reader that is not a party to it.
 * @property {string} [before] - Read the conversation as it stood before this
 *   message, which is not in it. For a request that is itself a message in the
 *   chat: what it says cannot be part of what it read, and asking it again
 *   later must read the same conversation it read the first time.
 * @property {number} [past] - With `before`: read this many messages past it
 *   as well. Compaction's. A summary sits above the turns that were kept when
 *   it was asked for, and it read those too — so asked again, it reads the same
 *   conversation, and not the one that has carried on since.
 * @property {(name: string) => boolean} [keeps] - Which tools' calls a turn
 *   written while only they went back sends: the document tools. Absent means
 *   such a turn sends none. A turn written since sends every call. See
 *   ai/context/reads.js.
 * @property {(id: string) => import('./reads.js').Located|null} [locate] -
 *   Where a document is now and what it says, for the block to say which reads
 *   have changed since. Absent means nothing is said.
 * @property {import('@/cards/macros.js').Names|null} [names] - What `{{char}}`
 *   and `{{user}}` become in the prompt, the author's note and the pinned
 *   documents: the chat's, when it plays a card. Absent means they are sent as
 *   written. The overview, the pins' paths and the changed reads arrive with
 *   them in already, from the tools that resolved them.
 *
 * @typedef {Object} TranscriptRoles
 * @property {string} user - What to call the writer's turns
 * @property {string} assistant - What to call the assistant's
 *
 * @typedef {Object} Stores
 * @property {any} documentsStore
 * @property {any} chatsStore
 * @property {any} messagesStore
 */

/**
 * @param {'chat'|'summarize'} mode
 * @param {Stores} stores
 * @param {BuildOptions} opts
 * @returns {Promise<{ messages: ChatMessage[] }>}
 */
export async function buildContext(mode, stores, opts) {
  if (mode === 'chat') return buildChat(stores, opts)
  if (mode === 'summarize') return buildSummarize(stores, opts)
  throw new Error(`Unknown context mode: ${mode}`)
}

/**
 * @param {Stores} stores
 * @param {BuildOptions} opts
 * @returns {Promise<{ messages: ChatMessage[] }>}
 */
async function buildChat(
  stores,
  {
    storyId,
    chatId,
    systemPrompt,
    project,
    pinned,
    note,
    transcript,
    before,
    past,
    keeps,
    locate,
    names,
  }
) {
  if (!storyId) throw new Error('storyId is required')

  /** @type {ChatMessage[]} */
  const messages = []

  // The whole system message, and it never changes mid-session, so it hashes
  // the same across turns and the prompt cache hits.
  const systemContent = substitute(systemPrompt, names).trim()
  if (systemContent) messages.push({ role: 'system', content: systemContent })

  const read = chatId ? chatMessages(stores, chatId, { before, past }) : []
  const history = applyCompaction(read)

  if (transcript) {
    // A reader of the transcript sees no calls, so there is no read for it
    // to have seen go stale.
    const block = renderProjectState(project, pinnedContent(stores, pinned, names))
    messages.push({
      role: 'user',
      content: [renderTranscript(history, transcript), renderLoads(read, history), block]
        .filter(Boolean)
        .join('\n\n---\n\n'),
    })
    return { messages }
  }

  // Every turn sends its loads back, and every call it made when it says it
  // keeps them; a turn from when only the document calls went back sends those.
  const loads = name => name === USE_SKILL
  const every = () => true
  const carried = carriedLoads(read)
  for (const msg of history) {
    const kept = keepsEveryCall(msg) ? every : keeps && keepsDocumentCalls(msg) ? keeps : null
    expandMessage(msg, messages, name => loads(name) || Boolean(kept?.(name)))
    if (isCompaction(msg)) messages.push(...carriedMessages(carried))
  }

  const changed = locate ? changedSinceRead(read, locate) : []
  const block = renderProjectState(project, pinnedContent(stores, pinned, names), changed)
  const head = [block, renderAuthorsNote(substitute(note, names))].filter(Boolean).join('\n\n')
  attachProjectState(mergeAdjacentTurns(messages), head)

  return { messages }
}

/**
 * The writer's standing instructions, as the turn reads them.
 *
 * In the writer's latest message, after the project block and before what
 * they said. Late, because a sentence at the top of a long conversation loses
 * to everything under it, and the few instructions a long chat keeps eroding —
 * who not to write for, how long a turn runs — are the ones that most need to
 * hold at turn two hundred. Not last, because the answer should be to what the
 * writer said, and what sits right before generation is what gets echoed.
 *
 * Named, like the project block, because what is around it changes every turn.
 * Named as the writer sees it, so that what they wrote and what the model is
 * shown are called the same thing.
 *
 * @param {string} [note]
 * @returns {string} Empty when there is no note
 */
export function renderAuthorsNote(note) {
  const text = (note || '').trim()
  return text ? `<authors_note>\n${text}\n</authors_note>` : ''
}

/**
 * The conversation as a record of it, for a reader that had no part in it.
 *
 * A skill runs under its own prompt over someone else's conversation, and the
 * turn it is asked for lands in the same assistant slot the Game Master has
 * been narrating from all game. Handed that history as messages, a model does
 * what the shape asks and writes the next one: prose, in the Game Master's
 * voice, from a role whose entire job is not to write prose. No amount of
 * saying so in the system prompt outranks the pattern, because the pattern is
 * the last thing it reads and the prompt is the first.
 *
 * As a transcript there is no pattern to continue. The assistant slot is empty,
 * the turns are labelled with the names the skill's own prompt uses, and what
 * comes next is an answer about a document rather than the next line of a play.
 *
 * Only what was said goes in. The tool calls in this history are the Game
 * Master's, and a reader shown calls it never made and cannot answer writes
 * another one out in plain text.
 *
 * @param {any[]} history
 * @param {TranscriptRoles} roles
 * @returns {string}
 */
function renderTranscript(history, roles) {
  const turns = []

  for (const msg of history) {
    // A command is tagged with the tool that answered it, and it is nobody's
    // turn to speak — wrapping it in either name would say it was.
    const command = msg.metadata?.command
    if (command) {
      if (command.label || command.result) turns.push(renderCommand(command))
      continue
    }
    if (!msg.content) continue

    // A turn that is nothing but commands is nobody speaking — the writer ran
    // three tools and said nothing — so it goes in already tagged with what
    // answered rather than under their name. One that also has words in it is
    // their turn, tools and all.
    const segments = msg.segments || []
    if (segments.length > 0 && segments.every(segment => segment.type === 'command')) {
      turns.push(msg.content)
      continue
    }

    const name = msg.role === 'user' ? roles.user : msg.role === 'assistant' ? roles.assistant : ''
    if (!name) continue
    turns.push(`<${name}>\n${msg.content}\n</${name}>`)
  }

  return `<transcript>\n${turns.join('\n')}\n</transcript>`
}

/**
 * The skills the conversation has loaded, for a reader of its transcript.
 *
 * The model's loads are calls, which a transcript leaves out, so they go
 * here: the instructions, and any of the skill's files it read. The writer's
 * are in their turns already, and only one a summary has taken out of the
 * transcript goes here as well.
 *
 * @param {any[]} read - The conversation before compaction
 * @param {any[]} history - What the transcript shows of it
 * @returns {string} Empty when nothing is loaded
 */
function renderLoads(read, history) {
  const shown = new Set(history.map(msg => msg.id))
  const loads = loadedText(read).filter(load => load.by === 'model' || !shown.has(load.messageId))
  if (loads.length === 0) return ''
  const skills = loads.map(load =>
    [
      `<skill name="${load.name}">`,
      load.instructions,
      ...load.files.map(file => `<file path="${file.path}">\n${file.content}\n</file>`),
      '</skill>',
    ].join('\n')
  )
  return [
    'The conversation has loaded these skills, and what is written for it follows them:',
    ...skills,
  ].join('\n\n')
}

/**
 * What the documents the writer pinned say now, each with its listing.
 *
 * Now, not what they said when they were pinned. That is the whole point: the
 * writer edits the same documents the model is working from, and a copy taken
 * eight turns ago is a copy of something that has since moved.
 *
 * Text and files both: a file's content is the text that was read out of it.
 * Length is no bar. A long document in this list was pinned by the writer from
 * the outline, or by a card import: a decision, which the block honours whole
 * rather than second-guessing with a note.
 *
 * @param {Stores} stores
 * @param {import('@/ai/tools/documents.js').DocumentListing[]} [pinned]
 * @param {import('@/cards/macros.js').Names|null} [names] - Filled in, when the chat has them
 * @returns {Array<Omit<import('@/ai/tools/documents.js').DocumentListing, 'id'> & {content: string}>}
 */
function pinnedContent(stores, pinned, names) {
  return (pinned || []).flatMap(({ id, ...entry }) => {
    const document = stores.documentsStore.getDocument(id)
    if (!document || document.type === 'folder') return []
    return [{ ...entry, content: substitute(document.content, names) }]
  })
}

/**
 * The project as it stands, for the model to read without asking.
 *
 * JSON, in the shape the document tools already answer in, because a pinned
 * document carries both what is said about it and its text, and prose has no
 * way of saying which is which. Empty fields are dropped rather than sent
 * blank, so an absent key means the thing is absent.
 *
 * What this block *is* belongs in the system prompt, not in here. This sits
 * past every cache breakpoint, so a line of explanation is a line re-sent on
 * every single turn; the system message is written once and cached.
 *
 * The fence stays, though. The writer's own message follows immediately after
 * this, and it needs a boundary that a writer would not type by accident.
 *
 * The tag around it is not a second boundary — it is a name. A prompt that has
 * to say where the block sits is a prompt that goes stale the moment the turn
 * appends anything else to the same message, which is exactly what a chat
 * running the Director does. Named, it can be pointed at instead of located.
 *
 * @param {import('@/ai/tools/documents.js').ProjectOverview|null} [project]
 * @param {Array<{path: string, content: string}>} [pinned] - The pinned
 *   documents, with their text now
 * @param {Array<{path: string, since: string}>} [changed] - Documents read in
 *   view that have changed since, by the path they were read at
 * @returns {string}
 */
function renderProjectState(project, pinned = [], changed = []) {
  if (!project) return ''
  const body = {
    ...project,
    ...(pinned.length > 0 ? { pinned } : {}),
    ...(changed.length > 0 ? { changed } : {}),
  }
  return `<project>\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\`\n</project>`
}

/**
 * Fold a run of turns in one voice into one turn.
 *
 * Two messages in a row from the same side are legal and rendered wrong — the
 * same reason the project block is merged rather than sent as its own turn. A
 * run of them is what the writer makes by running three oracles before saying
 * anything, or by pushing an opening scene into the Game Master's voice a
 * paragraph at a time: each is a message so it can be shown, retried and
 * deleted on its own, and they reach the model as the single turn they are.
 *
 * A turn carrying tool_calls is never folded, on either side of it. The result
 * after it answers those calls by id, and it has no words for a fold to join
 * anyway. So only what was said is joined, which is all a run of pushed turns
 * ever contains.
 *
 * @param {ChatMessage[]} messages
 * @returns {ChatMessage[]} The same array, mutated and returned for chaining
 */
function mergeAdjacentTurns(messages) {
  for (let i = messages.length - 1; i > 0; i--) {
    const current = messages[i]
    const previous = messages[i - 1]
    if (current.role !== previous.role) continue
    if (current.role !== 'user' && current.role !== 'assistant') continue
    if (current.tool_calls || previous.tool_calls) continue
    previous.content = `${previous.content}\n\n${current.content}`
    messages.splice(i, 1)
  }
  return messages
}

/**
 * Put the project state at the tail of the conversation.
 *
 * It goes after every completed turn, which is what lets it change as often as
 * the project does: the prefix in front of it is identical to what the last
 * request sent, so the cache still hits.
 *
 * It is merged into the writer's latest message rather than sent as one of its
 * own. Two user messages in a row are legal in this format, but the chat
 * templates local backends apply often assume user and assistant strictly
 * alternate, and render a non-alternating array wrong or drop a turn outright.
 *
 * @param {ChatMessage[]} messages
 * @param {string} block
 */
function attachProjectState(messages, block) {
  if (!block) return

  const last = messages[messages.length - 1]
  if (last?.role === 'user') {
    messages[messages.length - 1] = {
      ...last,
      content: `${block}\n\n---\n\n${last.content}`,
    }
    return
  }

  messages.push({ role: 'user', content: block })
}

/**
 * Expand a stored message into wire-format ChatMessages.
 *
 * An assistant turn goes out as its content and the tool calls it made on the
 * way that the caller says go back, without their words. The rest of the
 * trajectory stays on the message: the tool call panel reads it, and a read
 * counts the reads before it there.
 *
 * Content rather than the trajectory's own text, because the content is what
 * the writer sees and edits, and what they edit has to be what the model
 * reads.
 *
 * @param {any} msg
 * @param {ChatMessage[]} out
 * @param {((name: string) => boolean)|null} replays - Which of the turn's
 *   calls to send back, by tool name. Null sends none.
 */
function expandMessage(msg, out, replays) {
  if (msg.role !== 'user' && msg.role !== 'assistant') return

  // A command's message holds its answer and nothing else — which is what lets
  // one that consults stream into it the way any other turn does. The tag
  // naming what answered goes on here, on the way out, so what the model reads
  // still says an oracle said it and not the writer.
  const command = msg.metadata?.command
  if (command) {
    if (command.label || command.result)
      out.push({ role: msg.role, content: renderCommand(command) })
    return
  }

  if (replays) out.push(...replayedCalls(msg.metadata?.apiTrajectory, replays))
  if (msg.content) out.push({ role: msg.role, content: msg.content })
}

/**
 * The loads a summary stands in for, as they go under it: a load the model
 * made as the call that made it, and one the writer made as the line it was in
 * their turn.
 *
 * @param {import('@/ai/skills/loads.js').Load[]} carried
 * @returns {ChatMessage[]}
 */
function carriedMessages(carried) {
  return carried.flatMap(load => {
    /** @type {ChatMessage[]} */
    const said = []
    if (load.command) said.push({ role: 'user', content: renderCommand(load.command) })
    else if (load.call && load.result) {
      said.push(
        { role: 'assistant', content: null, tool_calls: [load.call] },
        { role: 'tool', tool_call_id: load.call.id, content: String(load.result.content ?? '') }
      )
    }
    return said
  })
}

/**
 * A turn's tool calls as the API should see them again, without the words.
 *
 * The calls asked for and the results that answer them, in order, and nothing
 * else: a call is kept with its result or not at all, since a result with no
 * call and a call with no result are both requests providers reject. No entry
 * carries text, because the turn's content follows whole and is the one copy
 * of what was said — so an edit to it is what the model reads, and nothing is
 * sent twice. What was streamed before a call now reads as said after it,
 * which no model minds.
 *
 * @param {any[]|undefined} trajectory
 * @param {(name: string) => boolean} replays
 * @returns {ChatMessage[]}
 */
function replayedCalls(trajectory, replays) {
  /** @type {ChatMessage[]} */
  const out = []
  const kept = new Set()

  for (const item of trajectory || []) {
    if (item?.role === 'assistant' && Array.isArray(item.tool_calls)) {
      const calls = item.tool_calls.filter(call => replays(call?.function?.name))
      if (calls.length === 0) continue
      for (const call of calls) kept.add(call.id)
      out.push({ role: 'assistant', content: null, tool_calls: calls })
      continue
    }
    if (item?.role === 'tool' && kept.has(item.tool_call_id)) {
      out.push({ role: 'tool', tool_call_id: item.tool_call_id, content: item.content })
    }
  }

  return out
}

/**
 * @param {Stores} stores
 * @param {BuildOptions} opts
 * @returns {{ messages: ChatMessage[] }}
 */
function buildSummarize(stores, { documentId, systemPrompt, userPrompt }) {
  const scene = documentId ? stores.documentsStore.getDocument(documentId) : null
  const sceneText = scene ? scene.content || '' : ''
  const sceneTitle = scene?.title || ''

  /** @type {ChatMessage[]} */
  const messages = [
    { role: 'system', content: (systemPrompt || '').trim() },
    {
      role: 'user',
      content: `${(userPrompt || '').trim()}${sceneTitle ? `\n\n# ${sceneTitle}` : ''}\n\n${sceneText}`,
    },
  ]
  return { messages }
}

/**
 * The conversation this request reads, before compaction.
 *
 * `before` cuts off a request that is itself a message in the chat, so it
 * cannot read itself or anything written after it — except the few messages
 * `past` it that a summary was put above, which it read when it was written.
 * Compaction then applies, in buildChat, because every reader of a
 * conversation should agree on what the conversation is: the turn, a skill
 * consulted inside it, and the next compaction alike. It applies there rather
 * than here because the loads a summary stands in for are read from what it
 * covers, which compaction leaves out.
 *
 * @param {Stores} stores
 * @param {string} chatId
 * @param {{before?: string, past?: number}} [window]
 * @returns {any[]}
 */
function chatMessages(stores, chatId, { before, past = 0 } = {}) {
  const chat = stores.chatsStore.getChatById(chatId)
  if (!chat) return []

  let messages = stores.messagesStore.getMessagesForChat(chatId) || []

  if (before) {
    const at = messages.findIndex(message => message.id === before)
    // A message that is not there any more narrows nothing. The alternative is
    // reading none of the conversation, which is worse than reading all of it.
    if (at >= 0) {
      messages = [...messages.slice(0, at), ...messages.slice(at + 1, at + 1 + Math.max(0, past))]
    }
  }

  return messages
}
