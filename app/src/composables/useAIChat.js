/* global AbortController, AbortSignal, DOMException */
/**
 * @module composables/useAIChat
 * @description Composable for AI-powered chat conversations. Handles streaming
 * chat responses, context building from story content, and integration with chat messages.
 * This is the primary interface for the chat assistant feature.
 *
 * @example
 * const { sendMessage, isGenerating, stopGeneration } = useAIChat()
 *
 * // Send a message and get AI response
 * await sendMessage(chatId, 'Help me develop this character', storyContext)
 */

/**
 * @typedef {import('../types/composables.js').StoryContext} StoryContext
 * @typedef {import('../types/models.js').AIPreset} AIPreset
 * @typedef {import('../types/models.js').Message} Message
 * @typedef {import('../types/models.js').ApiMessage} ApiMessage
 * @typedef {import('./useChats.js').ChatsApi} ChatsApi
 * @typedef {import('../ai/tools/registry.js').ToolCall} ToolCall
 * @typedef {import('../types/models.js').TurnUsage} TurnUsage
 */

import { computed, ref } from 'vue'
import { useAIConfig } from './useAIConfig.js'
import { useAIService } from './useAIService.js'
import { useAIContext } from './useAIContext.js'
import { useChats } from './useChats.js'
import { useProfiles } from './useProfiles.js'
import { useSkills } from './useSkills.js'
import { skillPrompt } from '@/ai/skills/index.js'
import { useChatCommands } from './useChatCommands.js'
import { useApplicationState } from './useApplicationState.js'
import { ProviderNotConfiguredError } from '@/utils/errors.js'
import { connectionGap } from '@/ai/providers.js'
import { DEFAULT_CHAT_PROMPT } from '@/ai/prompts/index.js'
import { noteOnProfile } from '@/ai/profiles/index.js'
import { TITLE_DEFAULTS, mergeAISettings, resolveAISettings } from '@/ai/defaults.js'
import {
  getEnabledToolDefinitions,
  getToolDefinitionsFor,
  getToolTimeout,
  executeTool,
  hasTools,
  isSkill,
  handsOverReply,
} from '@/ai/tools/index.js'
import { needsApproval, serversForChat } from '@/mcp/servers.js'
import { askApproval, denyWaiting } from './useToolApprovals.js'
import { useMcpServers } from './useMcpServers.js'
import { SKILL_MAX_ROUNDS } from '@/ai/skills/index.js'
import { USE_SKILL, loadedSkills } from '@/ai/skills/loads.js'
import { DEFAULT_TRANSCRIPT_ROLES } from '@/ai/context/build.js'
import { readNotes, applyProposal } from '@/ai/tools/documents.js'
import { useDocuments } from './useDocuments.js'
import { keepDecisions } from '@/utils/edits.js'
import { refusedAnswer, trimRound } from '@/ai/rounds.js'

const TITLE_SYSTEM_PROMPT =
  'You are a helpful assistant that creates short, descriptive titles for chat conversations.'

const titleUserPrompt = userMessage =>
  `Summarize the first message of this chat into a short title. It should be only a few words. Only return the title, with no explanation or context: ${userMessage}`

/**
 * Drop inline reasoning. Backends that stream reasoning in the content channel
 * rather than a channel of its own wrap it in a <think> block, and every caller
 * here wants the answer, not the thinking.
 *
 * @param {string} raw - Accumulated content
 * @returns {string} The content with any reasoning removed
 */
function stripThinking(raw) {
  return (
    raw
      .replace(/<think>[\s\S]*?<\/think>/gi, '')
      // An unterminated block means the response was cut off mid-thought.
      .replace(/<think>[\s\S]*$/i, '')
  )
}

/**
 * Pull a usable title out of a completion.
 *
 * Take the first non-empty line: models tend to add a sentence of commentary
 * despite being told not to.
 *
 * @param {string} raw - Accumulated content
 * @returns {string} A cleaned title, or '' if nothing usable came back
 */
function extractTitle(raw) {
  const line =
    stripThinking(raw)
      .split('\n')
      .find(l => l.trim()) || ''
  return line
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim()
}

/**
 * How much of a tool's answer a consultation's record keeps. The record is for
 * the writer to see what a skill did, and a document a skill read is already
 * in the project; the whole of it on the turn as well would be the turn's
 * largest part for nothing.
 */
const TRACE_RESULT_CHARS = 2000

/**
 * The tools a consultation called, as the turn keeps them: each with what it
 * was asked and what it answered, cut to a length worth reading, and what the
 * skill it reached did in turn when it reached one.
 *
 * @param {ToolCall[]} calls
 * @param {ApiMessage[]} answered - Their results, in the same order
 * @returns {import('../types/models.js').ConsultedCall[]}
 */
function consultedCalls(calls, answered) {
  return calls.map((call, index) => {
    const result = String(answered[index]?.content ?? '')
    const consultation = answered[index]?._consultation
    return {
      name: call.function?.name || '',
      arguments: call.function?.arguments || '',
      result:
        result.length > TRACE_RESULT_CHARS ? `${result.slice(0, TRACE_RESULT_CHARS)}…` : result,
      ...(consultation ? { consultation } : {}),
    }
  })
}

/** @typedef {import('../types/models.js').DocumentEdit} DocumentEdit */

/**
 * What rewinding to a message would do, for asking the writer first.
 * @typedef {Object} RewindPlan
 * @property {Message[]} messages - The turns after it, which go
 * @property {DocumentEdit[]} edits - Their changes, in the order they would be undone
 * @property {{documentId: string, path: string}[]} documents - The documents those touch, each once
 */

/**
 * How a rewind went: what was undone, and what was left because the writer
 * had edited it since.
 * @typedef {{reverted: DocumentEdit[], skipped: DocumentEdit[]}} RewindOutcome
 */

/**
 * What the turn being generated is doing right now. `calling` is the model
 * writing the round's calls, and `running` is those tools at work. `waiting` is a request out with nothing back yet — after a
 * tool result that can be a long time, while the model takes in what the tool
 * returned. `thinking` and `writing` are the model streaming one or the other.
 *
 * Live only, and never stored: a page reloaded mid-turn has no turn running,
 * and nothing left over should say it has.
 *
 * @typedef {Object} TurnActivity
 * @property {string} messageId - The message the turn is writing into
 * @property {'calling'|'running'|'waiting'|'thinking'|'writing'} phase
 * @property {number} [since] - When a wait began, for saying how long it has been
 * @property {import('../ai/tools/progress.js').RoundCall[]} [calls] - The calls
 *   being written or run, or the ones whose results the model is waited on
 *   for; absent before the turn's first round of them
 */

/**
 * AI chat service for assistant conversations
 *
 * @param {string} storyId - The story ID
 * @param {string} chatId - The chat ID
 * @returns {{
 *   isGenerating: import('vue').Ref<boolean>,
 *   isThinking: import('vue').Ref<boolean>,
 *   activity: import('vue').Ref<TurnActivity|null>,
 *   configurationError: import('vue').ComputedRef<Error|null>,
 *   sendMessage: (userMessage: string) => Promise<Message|null>,
 *   insertMessage: (text: string, role?: 'user'|'assistant') => Promise<Message|null>,
 *   regenerateMessage: (messageId: string) => Promise<Message|null>,
 *   selectAlternate: (messageId: string, index: number) => Promise<{skipped: DocumentEdit[]}>,
 *   resendMessage: (messageId: string) => Promise<Message|null>,
 *   rewindPlan: (messageId: string) => RewindPlan,
 *   rewindTo: (messageId: string) => RewindOutcome,
 *   acceptEdit: (messageId: string, index: number) => Promise<void>,
 *   rejectEdit: (messageId: string, index: number) => void,
 *   stopGeneration: () => Promise<{skipped: DocumentEdit[]}>,
 *   rerunCommand: (messageId: string, index?: number|null) => Promise<Message|null>,
 *   editCommand: (messageId: string, index: number|null, text: string) => Promise<Message|null>,
 *   removeCommand: (messageId: string, index?: number|null) => void,
 *   generateChatTitle: (userMessage: string) => Promise<string>
 * }}
 */
export function useAIChat(storyId, chatId) {
  const chatsApi = useChats(storyId)
  const profilesApi = useProfiles()
  const skillsApi = useSkills()
  const mcpApi = useMcpServers()
  const commands = useChatCommands(storyId, chatId)
  const aiConfig = useAIConfig()
  const aiService = useAIService()
  const { debug, applyEdits } = useApplicationState()

  // State
  const isGenerating = ref(false)
  const isThinking = ref(false)

  /**
   * The turn under way, for the tool calls made inside it: which message a
   * call waiting on the writer belongs to. A chat runs one turn at a time.
   */
  /** @type {{messageId: string, finish: (() => void)|null}} */
  const turn = { messageId: '', finish: null }

  /**
   * The work under way — a turn, a submission and the turn it asks for, a
   * command asked again — and what stops it. Stopped work goes on until it
   * next looks at its signal, and by then its message may be gone and other
   * work may hold the chat, so it looks after every wait and before it
   * writes, and once stopped touches neither.
   * @type {AbortController|null}
   */
  let current = null

  /**
   * Hold the chat for a piece of work.
   * @returns {AbortSignal} The work's, aborted when it is stopped
   */
  const begin = () => {
    current = new AbortController()
    isGenerating.value = true
    return current.signal
  }

  /**
   * Let the chat go at the end of a piece of work. Not for one that was
   * stopped: stopping let it go, and other work may hold it by now.
   * @param {AbortSignal} signal - The work's
   */
  const end = signal => {
    if (signal.aborted) return
    current = null
    isGenerating.value = false
    isThinking.value = false
  }

  /**
   * What a submission's commands run with: a `consult` that stops with the
   * work, and the signal itself, for a command to tell stopped from failed.
   * @param {AbortSignal} signal
   * @returns {import('../ai/tools/registry.js').ToolContext}
   */
  const commandContext = signal => ({
    consult: (systemPrompt, toolNames, options = {}) =>
      consult(systemPrompt, toolNames, { ...options, signal }),
    promptFor: skillPromptFor,
    signal,
  })

  /** @type {import('vue').Ref<TurnActivity|null>} */
  const activity = ref(null)

  /**
   * Get the active AI profile.
   * @returns {AIPreset|null}
   */
  const getActiveProfile = () => aiConfig.activeAIPreset.value

  /**
   * Check if AI is properly configured for chat
   * @returns {AIPreset} The active AI profile if configured
   * @throws {ProviderNotConfiguredError} If provider is not properly configured
   * @throws {Error} If other configuration issues exist
   */
  const getChatProfileIfValid = () => {
    const profile = getActiveProfile()
    if (!profile || !profile.providerId) {
      throw new ProviderNotConfiguredError('Set up a provider to use chat.')
    }

    const provider = aiConfig.getProvider(profile.providerId)
    if (!provider) {
      throw new ProviderNotConfiguredError('Set up a provider to use chat.')
    }

    if (!profile.model) {
      throw new Error('Select a model for chat in the settings menu.')
    }

    const gap = connectionGap(provider)
    if (gap === 'key') {
      throw new ProviderNotConfiguredError('Enter your OpenRouter API key to use chat.')
    }
    if (gap === 'endpoint') {
      throw new Error('Enter the endpoint for this connection in the settings menu.')
    }

    return profile
  }

  /**
   * What stands in the way of sending, if anything: the error a send would
   * fail with, or null. For the composer to read before a message is
   * recorded, so a chat with nobody to answer says so instead of keeping a
   * message nobody answers.
   * @type {import('vue').ComputedRef<Error|null>}
   */
  const configurationError = computed(() => {
    try {
      getChatProfileIfValid()
    } catch (error) {
      return error
    }
    return null
  })

  /**
   * The chat profile this chat runs on: the one it names, or the project's
   * default when that one is gone.
   * @returns {import('./useProfiles.js').ProfileEntry|null}
   */
  const runningProfile = () =>
    profilesApi.getProfile(chatsApi.getChatById(chatId)?.profileId) ||
    profilesApi.getProfile(chatsApi.defaultProfileId())

  /**
   * The system prompt for this chat, as the library holds it now.
   *
   * A chat runs on whichever prompt it points at, read fresh each turn, so an
   * edit in the settings lands on the next request — the way the profile's
   * parameters do. The profile itself never enters into it: switching models
   * shouldn't change what the assistant was told to be.
   *
   * The prompt replaces the built-in outright, so it owns any tool and oracle
   * instructions it still wants followed, and an empty one means "send no
   * instructions" rather than "use the default". Only a chat with no prompt,
   * or one whose prompt has since been deleted, falls back to the built-in
   * its story starts chats on.
   *
   * @returns {Promise<string>}
   */
  const resolveSystemPrompt = async () => {
    // Saved profiles load from the database; a lookup before that would find
    // the built-ins alone and quietly send the wrong prompt.
    await profilesApi.ready()
    return (runningProfile()?.settings?.prompt ?? DEFAULT_CHAT_PROMPT).trim()
  }

  /**
   * The author's note this turn sends: the chat's, as the profile it runs on
   * reads it. See `noteOnProfile`.
   * @returns {string|undefined}
   */
  const resolveNote = () => noteOnProfile(chatsApi.getChatById(chatId)?.rules, runningProfile())

  /**
   * What a skill runs under in this chat: the profile's wording for it when it
   * has one, and the skill's own otherwise.
   *
   * Read at the moment the skill is reached rather than resolved once for the
   * turn, because a turn can take a while and the writer may be editing the
   * very prompt it is about to use.
   *
   * @param {string} name - The skill's
   * @returns {string}
   */
  const skillPromptFor = name => skillPrompt(name, runningProfile()?.settings)

  /**
   * How many rounds running a turn may make the same calls and get the same
   * answers before it is taken to be going round: re-reading a document it
   * has, retrying a call that fails the same way. The answers are part of it,
   * so three rolls of the same die are three rolls and not a loop.
   */
  const REPEATS_BEFORE_STUCK = 3

  /**
   * What a round amounted to, for telling a turn that is going round from one
   * that is working: its calls, and what came back.
   *
   * @param {ToolCall[]} calls
   * @param {ApiMessage[]} results
   * @returns {string}
   */
  function roundSignature(calls, results) {
    return JSON.stringify([
      calls.map(call => [call.function?.name, call.function?.arguments]),
      results.map(result => result.content),
    ])
  }

  /**
   * What the turn is told when it has to stop calling tools and answer. Sent
   * for that last request alone, as the writer's side of the conversation,
   * and kept out of the trajectory: it is the app talking, and no later turn
   * needs to read it.
   *
   * @param {'limit'|'stuck'} why
   * @param {number} rounds - The rounds the turn made
   * @returns {string}
   */
  function wrapUpNote(why, rounds) {
    const reason =
      why === 'stuck'
        ? 'The same calls have come back with the same answers three rounds running'
        : `This turn has made its ${rounds} rounds of tool calls`
    return `[${reason}, so it can make no more. Answer now, without tools: say what you got done, what you found, and what is left, so the writer can tell you how to carry on.]`
  }

  /** Per-tool execution timeout. Long enough for slow lookups, short enough that a stuck tool doesn't hang the chat. */
  const TOOL_TIMEOUT_MS = 10000

  /**
   * A promise that gives up when the signal does, with the signal's reason. A
   * tool that hands the signal on stops there too; one with nothing to hand
   * it to is not waited for.
   * @template T
   * @param {Promise<T>} promise
   * @param {AbortSignal} signal
   * @returns {Promise<T>}
   */
  function untilAborted(promise, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason)
      const onAbort = () => reject(signal.reason)
      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
    })
  }

  /**
   * Run another inference over this same conversation under a different system
   * prompt, and hand back what it said.
   *
   * This is how a skill reaches a model — see ai/skills/index.js. Its request
   * is its own, stopped by the signal of the call it was made from, so a skill
   * runs out of time or stops with the turn without touching anything else.
   * Nothing streams: what a skill says is for the model that asked, not for
   * the player.
   *
   * A skill that names tools gets a small loop of its own, over the same
   * executor the turn loop uses, so a tool behaves identically whichever role
   * reached for it. What it may reach for comes from the skill and not from
   * this chat's tool switches: those say what the assistant the writer is
   * talking to may do, and a skill is not that assistant. Its calls and their
   * results live in this local array — nothing is streamed, stored, or
   * replayed on a later turn, and the caller sees only the sentences at the
   * end.
   *
   * The request differs from the turn's own only in the system message, which
   * is position zero — so the two share no cached prefix and each keeps a cache
   * line of its own. Cheaper than it sounds turn to turn, since each hits its
   * own entry and pays full price only on what is new. But it means a skill
   * called *occasionally* costs more per call than one called every turn: let
   * its entry age past the cache TTL and the next call rewrites the whole
   * conversation. Cadence is not the saving it looks like.
   *
   * @param {string} systemPrompt - The role to run as
   * @param {string[]} [toolNames] - Tools the skill is asking for, by name
   * @param {Object} [options]
   * @param {number} [options.depth] - How many skills deep this consultation
   *   is. The turn is 0 and each skill it reaches through adds one; a skill
   *   among the names is offered only while there is depth left for it. The
   *   loop sets it, not the skill: a skill that named its own depth could
   *   claim to be shallower than it is.
   * @param {import('@/ai/context/build.js').TranscriptRoles} [options.roles] -
   *   What to call the two voices in the conversation it is about to read.
   * @param {import('@/ai/defaults.js').AISettingsOverrides} [options.overrides] -
   *   Sampler and reasoning settings for this role, laid over the ones the
   *   writer tuned for their model rather than replacing them.
   * @param {(said: string) => void} [options.onContent] - Called with the answer
   *   so far as it is written, thinking already stripped out of it. What comes
   *   back is one round's worth: a round that ends in tool calls was not the
   *   answer, and the next round's first words replace it.
   * @param {(thinking: string) => void} [options.onReasoning] - Called with
   *   everything this consultation has thought so far, cumulative, as it
   *   arrives. For a caller that wants to show its working.
   * @param {string} [options.before] - Read the conversation as it stood before
   *   this message. Set by a caller whose consultation is itself a message in
   *   the chat, so it neither reads itself nor, asked again later, reads a
   *   conversation that has moved on without it.
   * @param {number} [options.past] - With `before`: read this many messages
   *   past it as well. Compaction's, whose summary sits above the turns that
   *   were kept and read them all the same.
   * @param {DocumentEdit[]} [options.edits] - The turn's record of what its
   *   tools changed, for the skill's own writes to join
   * @param {import('../types/models.js').ConsultedCall[]} [options.trace] - Where to
   *   record the tools this consultation called and what they answered, for a
   *   turn that shows what a skill did on the way to its answer
   * @param {AbortSignal} [options.signal] - Stops it. Set by whoever runs the
   *   work it is part of, not by the skill.
   * @returns {Promise<string>} What it said, or '' if it said nothing usable
   * @throws The signal's reason, once stopped
   */
  const consult = async (systemPrompt, toolNames = [], options = {}) => {
    const {
      depth = 1,
      roles = DEFAULT_TRANSCRIPT_ROLES,
      onContent,
      onReasoning,
      overrides,
      before,
      past,
      edits,
      trace,
      signal = new AbortController().signal,
    } = options
    const profile = getChatProfileIfValid()

    // The profile's gate still applies, because it is not a preference: a model
    // that cannot call tools cannot call them for a skill either.
    const tools =
      profile.toolsEnabled !== false && toolNames.length > 0
        ? getToolDefinitionsFor(toolNames, depth)
        : []

    const { messages } = await useAIContext(storyId).build({
      mode: 'chat',
      systemPrompt,
      chatId,
      // As a transcript, not as messages. A skill asked for the next assistant
      // turn after a history of assistant turns writes the next one; asked to
      // read a record, it answers about it. See renderTranscript.
      transcript: roles,
      before,
      past,
    })
    signal.throwIfAborted()

    // Everything this consultation has thought, across its rounds, for a
    // caller that asked to watch. Each round is a thought of its own, so they
    // are joined the way the turn loop joins its own runs.
    let thinking = ''

    for (let round = 0; round < SKILL_MAX_ROUNDS; round++) {
      let content = ''
      let thought = ''
      const result = await aiService.generateChatCompletion(
        messages,
        profile,
        chunk => {
          if (chunk?.content) {
            content += chunk.content
            // Stripped as it goes, so what the caller shows is what it will be
            // left holding. A round that ends in tool calls is not the answer,
            // and the next round's first words replace it — which is the same
            // thing the final value does.
            if (onContent) onContent(stripThinking(content).trim())
          }
          if (chunk?.reasoning) {
            // An empty `thought` means this is the round's first run, so a
            // round that thinks nothing contributes no separator either.
            if (!thought && thinking) thinking += '\n\n'
            thought += chunk.reasoning
            thinking += chunk.reasoning
            if (onReasoning) onReasoning(thinking)
          }
        },
        {
          tools: tools.length > 0 ? tools : undefined,
          // The role's settings win where they overlap; everything it does not
          // mention is still the writer's to tune.
          overrides: mergeAISettings(profile.generationOverrides, overrides),
          signal,
        }
      )

      console.log(`Skill round ${round}:`, {
        said: content,
        thought,
        toolCalls: result?.toolCalls?.map(call => call.function?.name),
      })

      if (!result?.toolCalls?.length) return stripThinking(content).trim()

      // Each distinct call once, and not too many: see ai/rounds.js.
      const { run, refused, left } = trimRound(result.toolCalls)
      const calls = refused ? [...run, refused] : run
      const assistantMessage = buildAssistantMessage(content, calls, result.reasoningDetails)
      // Its own thinking goes back to it while it is still deciding, the same
      // way the turn loop does it and for the same reason.
      messages.push(thought ? { ...assistantMessage, _reasoning: thought } : assistantMessage)
      const answered = await executeToolCalls(run, depth, edits, signal)
      signal.throwIfAborted()
      if (refused) answered.push(refusedAnswer(refused, left))
      messages.push(...answered)
      if (trace) trace.push(...consultedCalls(calls, answered))
    }

    // Still reaching for tools with the budget gone. Whatever it last said is a
    // fragment of a consultation it had not finished, so it does not go back as
    // advice: the skill reports having heard nothing and the turn goes on
    // without it, which is the same thing that happens when it says nothing.
    console.warn(`Skill used all ${SKILL_MAX_ROUNDS} rounds without answering`)
    return ''
  }

  /**
   * Execute a single tool call until its signal says to stop. A tool that runs
   * out of time comes back as an error result, so the model can react rather
   * than the chat hanging.
   *
   * @param {ToolCall} toolCall
   * @param {import('../ai/tools/registry.js').ToolContext & {signal: AbortSignal}} context - Its signal stops the call
   * @returns {Promise<ApiMessage>}
   */
  async function executeOneToolCall(toolCall, context) {
    const name = toolCall.function.name
    console.log(`Executing tool: ${name}`, toolCall.function.arguments)
    try {
      // Stopped before it began, it doesn't: a write now would be a change
      // made after the writer said stop, and on no record.
      context.signal.throwIfAborted()
      const result = await untilAborted(executeTool(toolCall, context), context.signal)
      console.log(`Tool result for ${name}:`, result.content)

      /** @type {ApiMessage} */
      const message = {
        role: 'tool',
        tool_call_id: result.tool_call_id,
        content: result.content,
      }

      // Which document this read, where, and what it said, for the project
      // block to say when it has changed since. Stripped before the message is
      // sent: notes to ourselves that happen to travel on the trajectory.
      const read = readNotes(name, result.result)
      if (read) Object.assign(message, read)

      return message
    } catch (err) {
      // Stopped is not failed, and nobody reads the result. Running out of
      // time is, and the model is told.
      if (err?.name !== 'AbortError') console.warn(`Tool ${name} failed:`, err.message)
      return {
        role: 'tool',
        tool_call_id: toolCall.id,
        content: JSON.stringify({ error: err.message }),
      }
    }
  }

  /**
   * Execute tool calls concurrently and return their API result messages
   * in input order.
   *
   * Including a skill and an ordinary tool called together. A call made in the
   * same step as `director` was chosen without the direction, and one of them —
   * the oracle, asked a question the Director is asking too — can come back
   * disagreeing with it. Holding those back cost every other call in the step a
   * round trip it did not need, for a rule the prompt can state: ask the
   * Director first, and don't re-ask what it tells you it already asked.
   *
   * @param {ToolCall[]} toolCalls
   * @param {number} depth - How many skills deep these calls are being made.
   *   The turn's own are 0; a skill reached from here consults one deeper.
   * @param {DocumentEdit[]|undefined} edits - The turn's record of what its tools
   *   changed, for a writing tool to add to. A skill's calls add to the same
   *   record: they are the turn's changes too.
   * @param {AbortSignal} signal - The work's, which stops the calls with it
   * @returns {Promise<ApiMessage[]>}
   */
  async function executeToolCalls(toolCalls, depth, edits, signal) {
    return Promise.all(toolCalls.map(call => runToolCall(call, depth, edits, signal)))
  }

  /**
   * Run one tool call, and when it is a skill, keep what the skill did on the
   * way to its answer beside its result: what it thought, and the tools it
   * called. The turn shows a consultation as a block of its own, and a block
   * that showed only the answer would leave out the part worth reading when
   * the answer came out strange. Kept as `_consultation`, a note to ourselves
   * that never reaches the wire, like `_document`.
   *
   * No documentId: nothing is scoped to "the document the writer is looking
   * at" any more. A tool that acts on a document is told which one.
   *
   * @param {ToolCall} toolCall
   * @param {number} depth - How many skills deep the call is made. The turn's
   *   own are 0; a skill reached from here consults one deeper.
   * @param {DocumentEdit[]|undefined} edits - The turn's record of what its tools changed
   * @param {AbortSignal} signal - The work's
   * @param {{onContent?: (said: string) => void, onReasoning?: (thinking: string) => void}} [stream] -
   *   For a skill whose answer is the reply: its words and its thinking as
   *   they arrive, to put in front of the writer as it writes
   * @returns {Promise<ApiMessage>}
   */
  async function runToolCall(toolCall, depth, edits, signal, stream = {}) {
    // A server's tool that may change something asks first, and waits as long
    // as the writer takes: the wait is not the tool's, so it is not timed.
    if (needsApproval(toolCall.function.name)) {
      const decision = await askApproval(turn.messageId, toolCall)
      if (decision === 'deny') {
        return {
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: 'The writer did not allow this call.' }),
        }
      }
      if (decision === 'always') mcpApi.allowTool(toolCall.function.name)
      if (decision === 'always-server') mcpApi.allowServer(toolCall.function.name)
    }

    // Whether the writer is asked before a document changes is theirs to
    // set, app-wide; read here so the tools need not know where it lives.
    const propose = applyEdits.value === 'ask'
    /** @type {{thinking: string, calls: import('../types/models.js').ConsultedCall[]}} */
    const record = { thinking: '', calls: [] }

    // Timed from here, after any wait on the writer, which is not the tool's.
    // The call stops when its time is up or when the work it is part of does.
    const name = toolCall.function.name
    const timeout = getToolTimeout(name) ?? TOOL_TIMEOUT_MS
    const timer = new AbortController()
    const handle = setTimeout(
      () => timer.abort(new DOMException(`${name} timed out after ${timeout}ms`, 'TimeoutError')),
      timeout
    )
    const callSignal = AbortSignal.any([signal, timer.signal])

    const context = {
      storyId,
      chatId,
      ...(propose ? { propose: true } : {}),
      ...(edits ? { edits } : {}),
      // What each skill runs under here, which is the profile's business and
      // not the skill's. A skill that wanted to work this out itself would
      // have to know which chat it was in.
      promptFor: skillPromptFor,
      // What this chat has loaded, for `use_skill` to say so rather than send
      // a skill twice. Read when asked: a load earlier in this same turn is on
      // the message by then.
      loadedSkills: () => loadedSkills(chatsApi.getMessagesForChat(chatId)?.value || []),
      // The conversation whose document calls this caller sees: the turn's own
      // calls only. A skill reads a transcript without them, so a read above
      // is not in front of it, and it is never told one is.
      ...(depth === 0
        ? { conversation: () => chatsApi.getMessagesForChat(chatId)?.value || [] }
        : {}),
      signal: callSignal,
      // A skill gets a `consult` that knows where it is standing, so the depth
      // is counted here rather than trusted to whoever passes it on.
      consult: (systemPrompt, toolNames, options = {}) =>
        consult(systemPrompt, toolNames, {
          ...options,
          depth: depth + 1,
          edits,
          trace: record.calls,
          signal: callSignal,
          onReasoning: thinking => {
            record.thinking = thinking
            options.onReasoning?.(thinking)
            stream.onReasoning?.(thinking)
          },
          onContent: said => {
            options.onContent?.(said)
            stream.onContent?.(said)
          },
        }),
    }

    let message
    try {
      message = await executeOneToolCall(toolCall, context)
    } finally {
      clearTimeout(handle)
    }
    if (isSkill(name)) {
      message._consultation = {
        ...(record.thinking ? { thinking: record.thinking } : {}),
        calls: record.calls,
      }
    }
    return message
  }

  /**
   * Build one assistant entry of the trajectory: an iteration that requested
   * tools, or the trailing text the turn ended on.
   *
   * @param {string|null} content - Message content
   * @param {ToolCall[]} [toolCalls] - Tool calls, when this iteration made any
   * @param {import('./useAIService.js').ReasoningDetail[]} [reasoningDetails] - Reasoning details for continuation
   * @returns {ApiMessage}
   */
  function buildAssistantMessage(content, toolCalls, reasoningDetails) {
    /** @type {ApiMessage} */
    const message = {
      role: 'assistant',
      content: content || null,
    }
    if (toolCalls?.length > 0) {
      message.tool_calls = toolCalls
    }
    if (reasoningDetails?.length > 0) {
      message.reasoning_details = reasoningDetails
    }
    return message
  }

  /**
   * Streaming state for a chat completion
   * @typedef {Object} StreamingState
   * @property {string} content - Accumulated content
   * @property {string|null} reasoning - Accumulated reasoning
   * @property {boolean} reasoningBreak - Whether a new iteration is about to think
   * @property {boolean} contentBreak - Whether a new iteration is about to write, so its
   *   first words start a paragraph rather than run on from the last
   * @property {number|null} thinkingFinishTime - When thinking first finished
   * @property {number} roundStart - When this round's request went out
   * @property {boolean} awaiting - Whether this round has had nothing back yet
   * @property {number|null} thinkingSince - When the stretch of thinking under
   *   way began. A round that opens by thinking counts from its request, since
   *   taking in what it was sent is part of the thought.
   * @property {number} thinkingTime - Milliseconds thought, over the stretches that have ended
   * @property {Object} timing - Timing info for the message
   */

  /**
   * End the stretch of thinking under way, if there is one, and add it to the
   * turn's. A turn that calls tools thinks again after each result, so its
   * time thinking is the stretches added up, not the time until the first one
   * ended.
   *
   * @param {StreamingState} state
   */
  function endThinking(state) {
    if (state.thinkingSince === null) return
    state.thinkingTime += Date.now() - state.thinkingSince
    state.thinkingSince = null
    state.timing.thinkingTime = state.thinkingTime
  }

  /**
   * Create a streaming callback that updates message state
   * @param {string} messageId - Message ID to update
   * @param {StreamingState} state - Mutable state object
   * @param {AbortSignal} signal - The turn's
   * @returns {(chunk: import('./useAIService.js').StreamChunk) => void}
   */
  function createStreamingCallback(messageId, state, signal) {
    return chunkData => {
      if (signal.aborted) return
      if (!chunkData) {
        console.error('Received empty chunk while streaming chat response')
        return
      }

      const opening = state.awaiting
      state.awaiting = false

      // A call being written is the model past thinking and at work; the
      // chat shows the call growing where it would otherwise show nothing.
      if (chunkData.toolCalls) {
        if (!state.thinkingFinishTime) {
          state.thinkingFinishTime = Date.now()
          state.timing.thinkingFinishTime = state.thinkingFinishTime
          isThinking.value = false
        }
        endThinking(state)
        // Said in the status line rather than grown in the message: a call
        // shown while it is written and gone when its result lands made the
        // turn jump on every round.
        activity.value = {
          messageId,
          phase: 'calling',
          since: state.roundStart,
          calls: chunkData.toolCalls.map(({ name, arguments: args }) => ({
            name,
            arguments: args,
          })),
        }
        chatsApi.streamMessageContent(
          messageId,
          state.content,
          state.reasoning,
          state.timing,
          chunkData.toolCalls
        )
      }

      if (chunkData.reasoning) {
        isThinking.value = true
        if (state.thinkingSince === null) {
          state.thinkingSince = opening ? state.roundStart : Date.now()
        }
        activity.value = { messageId, phase: 'thinking' }
        // Thinking resumes from scratch after every tool result, so run the
        // rounds together and the panel reads as one derailed thought.
        const separator = state.reasoning && state.reasoningBreak ? '\n\n' : ''
        state.reasoningBreak = false
        state.reasoning = (state.reasoning || '') + separator + chunkData.reasoning
        chatsApi.streamMessageContent(messageId, state.content, state.reasoning, state.timing)
      }

      if (!chunkData.content) {
        return
      }

      if (!state.thinkingFinishTime) {
        state.thinkingFinishTime = Date.now()
        state.timing.thinkingFinishTime = state.thinkingFinishTime
        isThinking.value = false
      }
      endThinking(state)
      activity.value = { messageId, phase: 'writing' }
      // What a model says before a tool call and what it says after are two
      // paragraphs, not one sentence: "Let me read the notes.The knock…" is
      // how a preamble reads when the rounds are simply joined.
      if (state.contentBreak && state.content && !/\s$/.test(state.content)) {
        state.content += '\n\n'
      }
      state.contentBreak = false
      state.content += chunkData.content
      chatsApi.streamMessageContent(messageId, state.content, state.reasoning, state.timing)
    }
  }

  /**
   * What a skill that answers as the reply wrote, from its tool result, or
   * nothing when it wrote nothing. Write answers with a `draft`; a skill of the
   * writer's with an `answer`.
   *
   * @param {ApiMessage} message
   * @returns {string}
   */
  function replyIn(message) {
    try {
      const result = JSON.parse(String(message.content))
      const text = result?.draft ?? result?.answer
      return typeof text === 'string' ? text.trim() : ''
    } catch {
      return ''
    }
  }

  /**
   * Run a round in which the model handed its reply to a skill.
   *
   * The round's other calls first, since what they do — a document written, a
   * question answered — is there for the skill to read. Then the skill, its
   * words streamed into the message as the reply and its thinking after the
   * turn's own. What the model wrote before handing over is its working, not
   * the reply, so it goes in with the thinking, folded.
   *
   * One voice writes the reply: a second skill handed it in the same round is
   * answered with an error and not run.
   *
   * A skill that writes something has written the reply, and its result says
   * so rather than holding the text a second time: no round follows to read
   * it, and the message's content is the one copy. One that writes nothing, or
   * fails, gives the turn back as it was — its words, its thinking — and the
   * model reads the error in the next round, as it would any tool's.
   *
   * @param {ToolCall[]} toolCalls - The round's calls, one of them handing over
   * @param {string} messageId - The assistant message being written
   * @param {StreamingState} state - The turn's streaming state
   * @param {DocumentEdit[]} edits - The turn's record of what its tools changed
   * @param {AbortSignal} signal - The turn's
   * @returns {Promise<{results: ApiMessage[], wrote: boolean}>} The round's
   *   results in call order, and whether the reply was written
   */
  async function handOverReply(toolCalls, messageId, state, edits, signal) {
    const handOff = toolCalls.find(call => handsOverReply(call.function?.name))
    const others = toolCalls.filter(call => call !== handOff)
    const run = others.filter(call => !handsOverReply(call.function?.name))

    /** @type {Map<ToolCall, ApiMessage>} */
    const answered = new Map()
    for (const call of others) {
      if (run.includes(call)) continue
      answered.set(call, {
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify({
          error: `${handOff.function.name} is writing the reply; only one skill can.`,
        }),
      })
    }
    const results = await executeToolCalls(run, 0, edits, signal)
    signal.throwIfAborted()
    run.forEach((call, index) => answered.set(call, results[index]))

    const before = { content: state.content, reasoning: state.reasoning }
    const folded = [state.reasoning, state.content.trim()].filter(Boolean).join('\n\n') || null
    state.content = ''
    state.reasoning = folded
    chatsApi.streamMessageContent(messageId, state.content, state.reasoning, state.timing)

    const message = await runToolCall(handOff, 0, edits, signal, {
      onReasoning: thinking => {
        if (signal.aborted) return
        isThinking.value = true
        if (state.thinkingSince === null) state.thinkingSince = Date.now()
        activity.value = { messageId, phase: 'thinking' }
        state.reasoning = [folded, thinking].filter(Boolean).join('\n\n')
        chatsApi.streamMessageContent(messageId, state.content, state.reasoning, state.timing)
      },
      onContent: said => {
        if (!said || signal.aborted) return
        isThinking.value = false
        endThinking(state)
        activity.value = { messageId, phase: 'writing' }
        state.content = said
        chatsApi.streamMessageContent(messageId, state.content, state.reasoning, state.timing)
      },
    })
    signal.throwIfAborted()
    endThinking(state)

    const reply = replyIn(message)
    if (reply) {
      state.content = reply
      answered.set(handOff, {
        ...message,
        content: JSON.stringify({ reply: 'Written as the reply.' }),
        _consultation: { calls: message._consultation?.calls || [], reply: true },
      })
    } else {
      state.content = before.content
      state.reasoning = before.reasoning
      answered.set(handOff, message)
    }

    return { results: toolCalls.map(call => answered.get(call)), wrote: Boolean(reply) }
  }

  /**
   * The turn's metadata as it is written, less the request it kept if Debug has
   * been switched off since the turn began. Switching it off forgets every
   * saved request, and a turn still running would otherwise write its own back.
   *
   * @param {Record<string, any>} metadata
   * @returns {Record<string, any>}
   */
  const unlessForgotten = metadata => {
    if (debug.value || !('context' in metadata)) return metadata
    const rest = { ...metadata }
    delete rest.context
    return rest
  }

  /**
   * Run the completion loop, handling tool calls until done.
   *
   * Produces an apiTrajectory: the per-iteration assistant deltas (with any
   * tool_calls), followed by tool result messages, followed by the final
   * assistant text. Each assistant entry carries only the content streamed
   * during that iteration — not cumulative content — which is the wire format
   * the turn itself continues in. Stored afterwards as the record of what the
   * turn called; a later request sends the turn's words as its content and
   * replays only the calls worth it. See ai/context/build.js.
   *
   * state.content stays cumulative because that's what the chat UI renders.
   *
   * A round that calls a skill whose answer is the reply hands the turn to it,
   * and the turn ends on what it writes. See handOverReply.
   *
   * A turn that has made the rounds the writer allows it (`maxToolRounds`), or
   * that keeps making the same calls and getting the same answers, is told so
   * and asked once more with the tools switched off, so it ends by saying
   * where it got to rather than mid-work.
   *
   * @param {Object} params
   * @param {Array} params.messages - Initial messages
   * @param {import('../types/models.js').AIPreset} params.profile - AI profile
   * @param {string} params.messageId - Assistant message ID for streaming
   * @param {import('../ai/tools/registry.js').ToolDefinition[]} params.tools - Available tools
   * @param {Object} [params.turnMetadata] - Metadata already on the message, carried
   *   through the mid-turn writes because updateMessage replaces metadata whole
   * @param {AbortSignal} params.signal - The turn's. Once it is aborted the
   *   loop writes nothing more and throws its reason.
   * @returns {Promise<{content: string, reasoning: string|null, apiTrajectory: ApiMessage[], edits: DocumentEdit[], usage: TurnUsage|null}>}
   */
  async function runCompletionLoop({
    messages,
    profile,
    messageId,
    tools,
    turnMetadata = {},
    signal,
  }) {
    const state = {
      content: '',
      reasoning: null,
      reasoningBreak: false,
      contentBreak: false,
      thinkingFinishTime: null,
      roundStart: Date.now(),
      awaiting: true,
      thinkingSince: null,
      thinkingTime: 0,
      timing: {},
    }
    let committedLen = 0
    let reasoningCommittedLen = 0
    /** @type {ApiMessage[]} */
    const apiTrajectory = []
    /** What the turn's tools changed, for rewinding past it. @type {DocumentEdit[]} */
    const edits = []

    // A turn can span several requests when tools are called. promptTokens
    // tracks the last one — the full context including this turn's tool
    // results, which is what the next turn builds on — while the rest
    // accumulate, since every request is billed.
    const usage = { promptTokens: 0, completionTokens: 0, requests: 0 }
    const workingMessages = [...messages]
    const onChunk = createStreamingCallback(messageId, state, signal)

    // How many rounds of calls the turn may make; the writer's to set, with 0
    // for no limit. Past it, or once the turn is going round, it gets one more
    // request with the tools switched off, and answers.
    const roundLimit = resolveAISettings(profile.generationOverrides).maxToolRounds
    const maxRounds = roundLimit > 0 ? roundLimit : Infinity
    /** Why the next request is the turn's last, when it is. @type {'limit'|'stuck'|null} */
    let wrapUp = null
    /** What the last few rounds amounted to. @type {string[]} */
    const recentRounds = []

    // However the turn ends — finished, stopped, or thrown — it is no longer
    // thinking. The indicator clears on the first content chunk, so a turn
    // that produced no content at all would otherwise leave the message
    // saying "Thinking…" for good. A stopped turn is finished by `halt`, there
    // and then: its request gives up a moment later, and by then the message
    // may have been deleted or be being asked again.
    const finish = () => {
      if (!state.thinkingFinishTime) {
        state.thinkingFinishTime = Date.now()
        state.timing.thinkingFinishTime = state.thinkingFinishTime
      }
      endThinking(state)
      activity.value = null
      // Nothing will come of a call still waiting on the writer.
      denyWaiting(messageId)
      turn.messageId = ''
      turn.finish = null
      // What the tools changed that the message has no record of yet: a round
      // stopped, or thrown, partway through, with a call that wrote finished
      // beside one still running. On the record as a finished round's changes
      // are, so the turn can still be undone — and is, when it was stopped to
      // be asked again, resent or rewound.
      if (edits.length > (recordOf(messageId)?.length ?? 0)) {
        chatsApi.updateMessage(messageId, {
          metadata: unlessForgotten({
            ...(chatsApi.getMessageById(messageId)?.value?.metadata || turnMetadata),
            documentEdits: keepDecisions([...edits], recordOf(messageId)),
          }),
        })
      }
      state.timing.streamingFinishTime = Date.now()
      chatsApi.streamMessageContent(messageId, state.content, state.reasoning, state.timing, [])
    }

    turn.messageId = messageId
    turn.finish = finish

    // The last round's calls, whose results the next request carries: what
    // the status line says the model is taking in.
    /** @type {import('../ai/tools/progress.js').RoundCall[]|null} */
    let lastCalls = null

    try {
      for (let iteration = 0; ; iteration++) {
        const lastRound = wrapUp !== null
        state.reasoningBreak = iteration > 0
        state.contentBreak = iteration > 0
        state.roundStart = Date.now()
        state.awaiting = true
        activity.value = {
          messageId,
          phase: 'waiting',
          since: state.roundStart,
          ...(lastCalls ? { calls: lastCalls } : {}),
        }

        const result = await aiService.generateChatCompletion(workingMessages, profile, onChunk, {
          tools: tools.length > 0 ? tools : undefined,
          // Still declared, so the calls already made stay valid, and not to
          // be called.
          ...(lastRound ? { toolChoice: /** @type {const} */ ('none') } : {}),
          overrides: profile.generationOverrides,
          signal,
        })

        // A round can end on a thought, with the call it led to sent whole
        // rather than streamed.
        endThinking(state)

        if (result?.usage) {
          usage.promptTokens = result.usage.prompt_tokens || 0
          usage.completionTokens += result.usage.completion_tokens || 0
          usage.requests += 1
        }

        const delta = state.content.slice(committedLen)
        committedLen = state.content.length

        const reasoningSoFar = state.reasoning || ''
        const reasoningDelta = reasoningSoFar.slice(reasoningCommittedLen)
        reasoningCommittedLen = reasoningSoFar.length

        // Everything one round trip produced, in one place. Whether a model
        // thinks again after a tool result is the model's business and not
        // every provider does; this is how to tell that apart from the panel
        // failing to show what did come back.
        console.log(`Turn iteration ${iteration}:`, {
          content: delta,
          reasoning: reasoningDelta,
          reasoningDetails: result?.reasoningDetails,
          toolCalls: result?.toolCalls?.map(call => call.function?.name),
          finishReason: result?.finishReason,
        })

        // No tool calls — emit a trailing assistant text entry (if any) and stop.
        // The last round stops whatever it asked for: its calls are not run.
        if (!result?.toolCalls?.length || lastRound) {
          if (delta) {
            apiTrajectory.push(buildAssistantMessage(delta, undefined, result?.reasoningDetails))
          }
          if (lastRound) {
            console.warn(`Turn stopped calling tools (${wrapUp}) after ${iteration} rounds`)
            // A model that ignored being told to answer, or said nothing.
            if (!delta.trim()) {
              state.content +=
                wrapUp === 'stuck'
                  ? '\n\n*[Stopped: the same calls kept getting the same answers]*'
                  : `\n\n*[Stopped after ${iteration} rounds of tool calls]*`
            }
          }
          break
        }

        console.log('Model requested tool calls:', result.toolCalls)
        if (result.reasoningDetails) {
          console.log('Preserving reasoning_details for continuation:', result.reasoningDetails)
        }

        // Each distinct call once, and not too many: a response that came
        // apart asked for one listing 253 times, and every answer would stay
        // in the conversation. See ai/rounds.js.
        const { run, refused, left } = trimRound(result.toolCalls)
        if (refused) {
          console.warn(`A round asked for ${result.toolCalls.length} calls; ran ${run.length}`)
        }
        const calls = refused ? [...run, refused] : run

        // Assistant entry for this iteration: just this iteration's text + tool calls.
        const assistantMessage = buildAssistantMessage(delta, calls, result.reasoningDetails)
        apiTrajectory.push(assistantMessage)

        // The turn gets its own thinking back while it is still running, so
        // the next request shows a model that was mid-thought rather than one
        // that reached for a tool without having one. Intra-turn only: it goes
        // to `workingMessages` and not to the trajectory, so nothing stores it
        // and no later turn replays it. The service renames it to whatever
        // this backend calls the field, or drops it.
        workingMessages.push(
          reasoningDelta ? { ...assistantMessage, _reasoning: reasoningDelta } : assistantMessage
        )

        // Words before a round that only loads a skill are the model saying
        // what it is about to do ("Let me load the house style first"), not
        // the reply, so they go in with the thinking, as a hand-off's do. Only
        // then: before a read or a search they can be half of an answer.
        if (delta.trim() && run.every(call => call.function?.name === USE_SKILL)) {
          state.content = state.content.slice(0, state.content.length - delta.length)
          committedLen = state.content.length
          state.reasoning = [state.reasoning, delta.trim()].filter(Boolean).join('\n\n')
          reasoningCommittedLen = state.reasoning.length
          chatsApi.streamMessageContent(messageId, state.content, state.reasoning, state.timing)
        }

        // Nothing streams while the calls run, or while the model takes in
        // what they returned — which for a long document is the longest wait
        // in the turn.
        lastCalls = run.map(call => ({
          name: call.function?.name || '',
          arguments: call.function?.arguments,
        }))
        activity.value = { messageId, phase: 'running', since: Date.now(), calls: lastCalls }
        const handsOver = run.some(call => handsOverReply(call.function?.name))
        const { results: toolResults, wrote } = handsOver
          ? await handOverReply(run, messageId, state, edits, signal)
          : { results: await executeToolCalls(run, 0, edits, signal), wrote: false }
        // Stopped while the calls ran: no next round, and the message may be
        // gone.
        signal.throwIfAborted()
        if (refused) toolResults.push(refusedAnswer(refused, left))
        apiTrajectory.push(...toolResults)
        workingMessages.push(...toolResults)

        // The round's calls have their results now, and the trajectory shows
        // them; the in-flight copies come off.
        chatsApi.updateMessage(messageId, {
          metadata: unlessForgotten({
            ...turnMetadata,
            apiTrajectory: [...apiTrajectory],
            ...(edits.length > 0
              ? { documentEdits: keepDecisions([...edits], recordOf(messageId)) }
              : {}),
          }),
        })
        chatsApi.streamMessageContent(messageId, state.content, state.reasoning, state.timing, [])

        // A skill wrote the reply, and the turn ends on it: a round after
        // would give the model the draft to rewrite, which is what handing it
        // over was for avoiding.
        if (wrote) break

        recentRounds.push(roundSignature(calls, toolResults))
        const lastFew = recentRounds.slice(-REPEATS_BEFORE_STUCK)
        if (lastFew.length === REPEATS_BEFORE_STUCK && lastFew.every(one => one === lastFew[0])) {
          wrapUp = 'stuck'
        } else if (iteration + 1 >= maxRounds) {
          wrapUp = 'limit'
        }
        if (wrapUp) {
          workingMessages.push({ role: 'user', content: wrapUpNote(wrapUp, iteration + 1) })
        }
      }
    } finally {
      // A stopped turn was finished when it was stopped.
      if (!signal.aborted) finish()
    }

    return {
      content: state.content,
      reasoning: state.reasoning,
      apiTrajectory,
      edits,
      usage: usage.requests > 0 ? usage : null,
    }
  }

  /**
   * Generate an AI response for the current conversation
   * @param {string} storyId - The story ID
   * @param {string} chatId - The chat ID
   * @param {string} into - An assistant message to write into, emptied and
   *   waiting, or '' for a new one at the end. Asking again: the message
   *   keeps its place and its other answers, and the conversation is read
   *   as it stood before it.
   * @param {AbortSignal} signal - The work's, from `begin`. Whoever began it
   *   ends it.
   * @returns {Promise<Message|null>} The generated assistant message, or null
   *   if it was stopped
   */
  const generateAIResponse = async (storyId, chatId, into, signal) => {
    const profile = getChatProfileIfValid()

    try {
      isThinking.value = true

      // The writer's own skills are some of the tools about to be offered, and
      // a turn sent the moment the app opens can beat the library to it; so
      // are their servers'.
      await Promise.all([skillsApi.ready(), mcpApi.ready()])

      // Build context
      const aiContext = useAIContext(storyId)
      const contextResult = await aiContext.build({
        mode: 'chat',
        systemPrompt: await resolveSystemPrompt(),
        note: resolveNote(),
        chatId,
        ...(into ? { before: into } : {}),
      })
      // Stopped before there was an answer to write into: none is made.
      signal.throwIfAborted()

      // Create assistant message AFTER building context so it's not included
      const assistantMsg = into
        ? chatsApi.getMessageById(into)?.value
        : chatsApi.addMessage(chatId, 'assistant', '', null)
      if (!assistantMsg) {
        throw new Error('Failed to create assistant message')
      }

      // Who is writing this answer goes on it before a word of it arrives, so
      // that one which fails halfway still says what it was failing on.
      // Everything written to this message's metadata from here on carries it,
      // and the debug context, because updateMessage replaces metadata whole.
      const turnMetadata = {
        model: profile.model,
        provider: aiConfig.getProvider(profile.providerId)?.name,
        // This turn's document calls go back with the conversation; a turn
        // from before they did keeps going back as it did. See
        // ai/context/reads.js.
        documentCallsKept: /** @type {const} */ (true),
        ...(debug.value ? { context: contextResult.messages } : {}),
      }
      chatsApi.updateMessage(assistantMsg.id, { metadata: { ...turnMetadata } })

      const chat = chatsApi.getChatById(chatId)

      // Run the completion loop with tool support. Profiles pointed at models
      // that can't handle tool calls opt out via toolsEnabled.
      // Two gates: the profile says whether the model can call tools at all,
      // the chat says which of them it should be offered.
      const toolsAllowed = profile.toolsEnabled !== false
      const tools =
        toolsAllowed && hasTools()
          ? getEnabledToolDefinitions({
              disabledTools: chat?.disabledTools,
              disabledGroups: chat?.disabledToolGroups,
              servers: serversForChat(
                chat,
                profilesApi.getProfile(chat?.profileId)?.id ?? chatsApi.defaultProfileId()
              ).map(server => server.id),
            })
          : []
      const { apiTrajectory, edits, usage } = await runCompletionLoop({
        messages: contextResult.messages,
        profile,
        messageId: assistantMsg.id,
        tools,
        turnMetadata,
        signal,
      })

      if (apiTrajectory.length > 0 || usage) {
        chatsApi.updateMessage(assistantMsg.id, {
          metadata: unlessForgotten({
            ...turnMetadata,
            ...(apiTrajectory.length > 0 ? { apiTrajectory } : {}),
            ...(edits.length > 0
              ? { documentEdits: keepDecisions(edits, recordOf(assistantMsg.id)) }
              : {}),
            ...(usage ? { usage } : {}),
          }),
        })
      }

      return assistantMsg
    } catch (error) {
      // Stopped is not failed. What the rounds before the stop made of the
      // message is on it already.
      if (signal.aborted) return null
      console.error('Failed to generate chat response:', error)
      throw error
    }
  }

  /**
   * Send a message and get AI response
   * @param {string} userMessage - The user's message
   * @returns {Promise<Message|null>} The generated assistant message or null
   */
  const sendMessage = async userMessage => {
    if (isGenerating.value) {
      throw new Error("Can't start a new generation while one is in progress.")
    }

    // Check if this is the first message in the chat
    const existingMessagesRef = chatsApi.getMessagesForChat(chatId)
    const existingMessages = existingMessagesRef?.value || []
    const isFirstMessage = existingMessages.length === 0

    // What the writer submitted may be prose, commands, or both in whatever
    // order they wrote them. This records all of it; `spoken` is the part
    // there is anything to answer.
    // Held from here rather than from the start of the reply. A chat's first
    // message runs title generation first, and that's a full round trip — and
    // a command may cost one too. On a slow local model the UI would otherwise
    // offer no way to stop for the whole duration of either.
    const signal = begin()
    try {
      // A command of the writer's own may be one of their skills.
      await skillsApi.ready()
      const { spoken } = await commands.submit(userMessage, commandContext(signal))

      // Commands only. They settle things — is the door locked, wrap this
      // scene up — and settling something is not asking for a turn. The writer
      // says when they are ready.
      if (!spoken) return null

      // Generate a title if this is the first message
      if (isFirstMessage) {
        try {
          const title = await generateChatTitle(spoken, signal)
          signal.throwIfAborted()
          chatsApi.updateChat(chatId, { title })
          console.log(`Generated chat title: ${title}`)
        } catch (error) {
          if (signal.aborted) throw error
          console.error('Failed to generate chat title, using default:', error)
          // Don't fail the entire operation if title generation fails
        }
      }

      // Generate AI response with the new user message included
      return await generateAIResponse(storyId, chatId, '', signal)
    } catch (error) {
      // Stopped while the title or a command was being asked for.
      if (signal.aborted) return null
      throw error
    } finally {
      end(signal)
    }
  }

  /**
   * Write a turn into the chat without asking for one back.
   *
   * Two things the writer can only do by hand: say something the model is not
   * meant to answer yet — three oracles, a note, the next beat — and write the
   * assistant's turn themselves, which is how a voice gets corrected or a scene
   * gets opened the way it needs to open.
   *
   * As the writer, this is `sendMessage` without the reply: the same submission,
   * so a pushed turn can still carry commands and they still run. As the
   * assistant it is the text and nothing else — no commands, because a slash in
   * narration is a slash, and no title, because inserting is the one thing here
   * that promises not to call a model.
   *
   * @param {string} text - What to write
   * @param {'user'|'assistant'} [role] - Whose turn it is
   * @returns {Promise<Message|null>} The last message written, or null if there
   *   was nothing to write
   */
  const insertMessage = async (text, role = 'user') => {
    if (isGenerating.value) {
      throw new Error("Can't add a message while a generation is in progress.")
    }

    const said = (text || '').trim()
    if (!said) return null

    if (role === 'assistant') {
      const written = chatsApi.addMessage(chatId, 'assistant', said)
      if (!written) throw new Error('Failed to add assistant message')
      return written
    }

    // Held for the same reason `sendMessage` holds it: a submission carrying
    // /interpret costs a round trip, and there has to be a way to stop it.
    const signal = begin()
    try {
      await skillsApi.ready()
      await commands.submit(said, commandContext(signal))
    } finally {
      end(signal)
    }

    const written = chatsApi.getMessagesForChat(chatId)?.value || []
    return written[written.length - 1] || null
  }

  /**
   * Ask a message again.
   *
   * The answer it has is kept, to be turned back to — see beginAlternate —
   * and everything after it goes, since it was written to that answer. What
   * the turns from here on did to the project goes with them, so the retry
   * starts from where the writer was. What cannot be undone is said, not
   * forced.
   *
   * @param {string} messageId - The assistant message to ask again
   * @returns {Promise<Message|null>} The message, answered again, or null
   */
  const regenerateMessage = async messageId => {
    if (isGenerating.value) halt()

    const messages = chatsApi.getMessagesForChat(chatId)?.value || []
    const messageIndex = messages.findIndex(m => m.id === messageId)
    if (messageIndex === -1) throw new Error('Message not found')
    if (messages[messageIndex].role !== 'assistant') {
      throw new Error('Only an answer can be asked again')
    }

    const { skipped } = revertMessages(messages.slice(messageIndex))
    if (skipped.length > 0) console.warn('Left as edited since:', skipped)

    chatsApi.truncateMessagesForChat(chatId, messageIndex + 1)
    chatsApi.beginAlternate(messageId)

    const signal = begin()
    try {
      return await generateAIResponse(storyId, chatId, messageId, signal)
    } finally {
      end(signal)
    }
  }

  /**
   * Show one of a message's answers, and put the project as that answer
   * left it.
   *
   * Only the last message: everything after a message was written to the
   * answer it was showing. What the answer on show did is undone, newest
   * change first, and what the chosen one did is made again, oldest first —
   * each where the writer has not been since, and the rest reported.
   *
   * @param {string} messageId
   * @param {number} index - Which answer, in the order they were asked for
   * @returns {Promise<{skipped: DocumentEdit[]}>} The changes left as the
   *   writer has them, in either direction
   * @throws {Error} While an answer is being written, when the message is
   *   not the last, or when there is no such answer
   */
  const selectAlternate = async (messageId, index) => {
    if (isGenerating.value) throw new Error('Wait for the answer being written')

    const messages = chatsApi.getMessagesForChat(chatId)?.value || []
    const message = messages[messages.length - 1]
    if (!message || message.id !== messageId) {
      throw new Error('Only the last message can show another answer')
    }
    if (index === (message.alternate ?? 0)) return { skipped: [] }

    const undone = revertMessages([message])
    const chosen = chatsApi.selectAlternate(messageId, index)
    const made = await reapplyMessage(chosen)
    return { skipped: [...undone.skipped, ...made.skipped] }
  }

  /**
   * Undo what a run of assistant turns did to the project, newest first,
   * through the document API. A change whose text has been edited since is
   * left as the writer has it, and reported.
   *
   * @param {Message[]} messages - The turns being removed, in chat order
   * @returns {RewindOutcome}
   */
  function revertMessages(messages) {
    const documents = useDocuments(storyId)
    /** @type {DocumentEdit[]} */
    const reverted = []
    /** @type {DocumentEdit[]} */
    const skipped = []
    for (const edit of editsOf(messages)) {
      ;(documents.revertEdit(edit) ? reverted : skipped).push(edit)
    }
    return { reverted, skipped }
  }

  /**
   * The changes a run of turns made, in the order to undo them: the last
   * turn's last change first.
   *
   * @param {Message[]} messages - In chat order
   * @returns {DocumentEdit[]}
   */
  function editsOf(messages) {
    /** @type {DocumentEdit[]} */
    const out = []
    for (const message of [...messages].reverse()) {
      const edits = message?.metadata?.documentEdits || []
      // A proposal never made, or turned down, changed nothing.
      out.push(...[...edits].reverse().filter(e => !e.status || e.status === 'accepted'))
    }
    return out
  }

  /**
   * Make what an assistant turn did to the project again, oldest change
   * first, through the document API. A change whose passage the writer has
   * edited since is left as they have it, and reported.
   *
   * @param {Message} message - The turn, showing the answer whose changes to make
   * @returns {Promise<{made: DocumentEdit[], skipped: DocumentEdit[]}>}
   */
  async function reapplyMessage(message) {
    const documents = useDocuments(storyId)
    /** @type {DocumentEdit[]} */
    const made = []
    /** @type {DocumentEdit[]} */
    const skipped = []
    for (const edit of editsOf([message]).reverse()) {
      ;((await documents.reapplyEdit(edit)) ? made : skipped).push(edit)
    }
    return { made, skipped }
  }

  /**
   * The record of changes a message holds right now — which may carry a
   * decision the writer made while the turn was still writing.
   * @param {string} messageId
   * @returns {DocumentEdit[]|undefined}
   */
  const recordOf = messageId => chatsApi.getMessageById(messageId)?.value?.metadata?.documentEdits

  /**
   * One recorded change with its status rewritten, on the message it belongs to.
   * @param {string} messageId
   * @param {number} index
   * @param {(edit: DocumentEdit) => DocumentEdit} change
   */
  function rewriteEdit(messageId, index, change) {
    const message = chatsApi.getMessageById(messageId)?.value
    const edits = message?.metadata?.documentEdits
    const edit = edits?.[index]
    if (!edit || edit.status !== 'proposed') throw new Error('Nothing is waiting to be decided')
    const documentEdits = edits.map((e, i) => (i === index ? change(e) : e))
    chatsApi.updateMessage(messageId, { metadata: { ...message.metadata, documentEdits } })
  }

  /**
   * Make a change the assistant proposed, now that the writer has accepted
   * it. Recorded as applied, so rewinding past the turn undoes it.
   *
   * @param {string} messageId
   * @param {number} index - Which of the turn's recorded changes
   * @throws {Error} When the document has changed since, or nothing is waiting
   */
  const acceptEdit = async (messageId, index) => {
    const message = chatsApi.getMessageById(messageId)?.value
    const edit = message?.metadata?.documentEdits?.[index]
    if (!edit || edit.status !== 'proposed') throw new Error('Nothing is waiting to be decided')

    const applied = await applyProposal(storyId, edit)
    if ('error' in applied) throw new Error(applied.error)
    rewriteEdit(messageId, index, e => ({
      id: e.id,
      documentId: applied.documentId,
      path: applied.path,
      tool: e.tool,
      old: applied.old,
      new: applied.new,
      status: 'accepted',
    }))
  }

  /**
   * Turn a proposed change down. It stays on the message as the record of
   * what was offered.
   *
   * @param {string} messageId
   * @param {number} index
   */
  const rejectEdit = (messageId, index) => {
    rewriteEdit(messageId, index, e => ({ ...e, status: 'rejected' }))
  }

  /**
   * What rewinding to a message would do: the turns after it that go, and
   * the documents their tools changed, so the writer can be asked first.
   *
   * @param {string} messageId - The message to keep as the last one
   * @returns {RewindPlan}
   */
  const rewindPlan = messageId => {
    const messages = chatsApi.getMessagesForChat(chatId)?.value || []
    const index = messages.findIndex(m => m.id === messageId)
    if (index === -1) throw new Error('Message not found')

    const removed = messages.slice(index + 1)
    const edits = editsOf(removed)
    /** @type {Map<string, {documentId: string, path: string}>} */
    const documents = new Map()
    for (const edit of edits) {
      if (!documents.has(edit.documentId)) {
        documents.set(edit.documentId, { documentId: edit.documentId, path: edit.path })
      }
    }
    return { messages: removed, edits, documents: [...documents.values()] }
  }

  /**
   * Rewind the conversation to a message: everything after it goes, and what
   * those turns did to the project is undone, newest first, where the writer
   * has not been since.
   *
   * @param {string} messageId - The message to keep as the last one
   * @returns {RewindOutcome}
   */
  const rewindTo = messageId => {
    if (isGenerating.value) halt()

    const messages = chatsApi.getMessagesForChat(chatId)?.value || []
    const index = messages.findIndex(m => m.id === messageId)
    if (index === -1) throw new Error('Message not found')

    const outcome = revertMessages(messages.slice(index + 1))
    chatsApi.truncateMessagesForChat(chatId, index + 1)
    return outcome
  }

  /**
   * Resend a user message (truncate everything after it and generate new response)
   * @param {string} messageId - The user message ID to resend
   * @returns {Promise<Message|null>} The new assistant message or null
   */
  const resendMessage = async messageId => {
    // Stop any ongoing generation first
    if (isGenerating.value) halt()

    // Get all messages for the chat
    const messagesRef = chatsApi.getMessagesForChat(chatId)
    const messages = messagesRef?.value || []

    // Find the index of the message to resend
    const messageIndex = messages.findIndex(m => m.id === messageId)
    if (messageIndex === -1) {
      throw new Error('Message not found')
    }

    // The answer being replaced takes its changes with it, as on regenerate.
    const { skipped } = revertMessages(messages.slice(messageIndex + 1))
    if (skipped.length > 0) console.warn('Left as edited since:', skipped)

    // Truncate from the next message (keep the user message)
    chatsApi.truncateMessagesForChat(chatId, messageIndex + 1)

    const signal = begin()
    try {
      return await generateAIResponse(storyId, chatId, '', signal)
    } finally {
      end(signal)
    }
  }

  /**
   * Generate a title for a chat based on the first user message
   * @param {string} userMessage - The first user message
   * @param {AbortSignal} [signal] - Stops it, and it answers with the default
   * @returns {Promise<string>} Generated title
   */
  const generateChatTitle = async (userMessage, signal) => {
    const profile = getChatProfileIfValid() // Will throw if invalid

    try {
      /** @type {Array<{role: 'system'|'user'|'assistant', content: string}>} */
      const messages = [
        { role: 'system', content: TITLE_SYSTEM_PROMPT },
        { role: 'user', content: titleUserPrompt(userMessage) },
      ]

      let title = ''

      await aiService.generateChatCompletion(
        messages,
        {
          providerId: profile.providerId,
          model: profile.model,
          allowedProviders: profile.allowedProviders,
        },
        chunkData => {
          if (chunkData.content) {
            title += chunkData.content
          }
        },
        { overrides: TITLE_DEFAULTS, signal }
      )

      // Note: We don't store usage for title generation since it's not part of the main context

      title = extractTitle(title)

      // Fallback to a default if title is empty
      if (!title) {
        title = 'New Chat'
      }

      // Limit title length
      if (title.length > 100) {
        title = title.substring(0, 97) + '...'
      }

      return title
    } catch (error) {
      if (!signal?.aborted) console.error('Failed to generate chat title:', error)
      // Return a default title on error
      return 'New Chat'
    }
  }

  /**
   * Ask a command's question again.
   *
   * Here rather than in the component because a command that consults needs a
   * model, and this is where the model is. See useChatCommands.
   *
   * @param {string} messageId - A message carrying a command
   * @param {number|null} [index] - Which segment, on a turn the writer took
   * @returns {Promise<Message|null>}
   */
  const rerunCommand = async (messageId, index = null) => {
    if (isGenerating.value) {
      throw new Error("Can't start a new generation while one is in progress.")
    }

    const signal = begin()
    try {
      return await commands.rerun(messageId, index, commandContext(signal))
    } finally {
      end(signal)
    }
  }

  /**
   * Change what a message says, or what a command in it asked.
   *
   * Held the same way `rerunCommand` is held, because it is sometimes the same
   * thing: an edit that changes which command this is, or one to a command
   * whose answer is its question, runs it again — and running it again may
   * reach a model. See useChatCommands.
   *
   * Most edits reach nothing, though — a typo, a line of prose, a roll
   * fudged — and none of those should wait on a reply that is being written.
   * So while one is, the edit goes ahead without a model to consult, and only
   * one that needs it is refused — along with any edit to the last message,
   * which is the one being written and would be written straight over.
   *
   * @param {string} messageId - A message carrying a command
   * @param {number|null} index - Which piece, or null for the whole turn
   * @param {string} text - The turn as the writer has now written it
   * @returns {Promise<Message|null>}
   */
  const editCommand = async (messageId, index, text) => {
    if (isGenerating.value) {
      const messages = chatsApi.getMessagesForChat(chatId)?.value || []
      if (messages.at(-1)?.id === messageId) {
        throw new Error("That message is still being written. Edit it once it's done.")
      }
      return await commands.revise(messageId, index, text, { promptFor: skillPromptFor })
    }

    const signal = begin()
    try {
      return await commands.revise(messageId, index, text, commandContext(signal))
    } finally {
      end(signal)
    }
  }

  /**
   * Stop the work under way: its request, its tools, its skills. What a turn
   * has written so far stays, finished as it stands; it writes nothing more
   * to it, and nothing else of the chat's, so whatever comes next — a delete,
   * the question asked again — is the only thing touching it.
   */
  const halt = () => {
    console.log('Stopping chat generation...')
    current?.abort()
    current = null
    turn.finish?.()
    isGenerating.value = false
    isThinking.value = false
    activity.value = null
  }

  /**
   * Whether an answer has nothing in it to show or to keep: no words, no
   * thinking, and no record of a call it made or a change it made.
   * @param {Message} message
   * @returns {boolean}
   */
  const isEmptyAnswer = message =>
    !message.content?.trim() &&
    !message.reasoningContent?.trim() &&
    !message.metadata?.apiTrajectory?.length &&
    !message.metadata?.documentEdits?.length

  /**
   * Stop the answer being written, at the writer's word.
   *
   * One stopped before it had anything in it goes, rather than sit in the
   * chat as an empty turn the next request would read. A first answer goes
   * altogether; one asked for again goes back to the answer it was asked
   * instead of, and the project to how that answer left it, since asking
   * again undid it.
   *
   * @returns {Promise<{skipped: DocumentEdit[]}>} The changes of the answer
   *   gone back to that were left as the writer has them
   */
  const stopGeneration = async () => {
    const messageId = turn.messageId
    halt()

    const message = messageId ? chatsApi.getMessageById(messageId)?.value : null
    if (!message || !isEmptyAnswer(message)) return { skipped: [] }
    if ((message.alternates?.length ?? 0) > 1) {
      const shown = chatsApi.dropAlternate(messageId)
      return { skipped: (await reapplyMessage(shown)).skipped }
    }
    chatsApi.deleteMessage(messageId)
    return { skipped: [] }
  }

  /**
   * Delete a message, or one piece of a turn. The answer being written stops
   * first, when it is the one going.
   *
   * @param {string} messageId
   * @param {number|null} [index] - Which piece, on a turn of pieces
   */
  const removeMessage = (messageId, index = null) => {
    if (isGenerating.value && messageId === turn.messageId) halt()
    commands.remove(messageId, index)
  }

  return {
    // State
    isGenerating,
    isThinking,
    activity,
    configurationError,

    // Methods
    sendMessage,
    insertMessage,
    regenerateMessage,
    selectAlternate,
    resendMessage,
    rewindPlan,
    rewindTo,
    acceptEdit,
    rejectEdit,
    stopGeneration,
    rerunCommand,
    editCommand,
    removeCommand: removeMessage,
    generateChatTitle,
  }
}
