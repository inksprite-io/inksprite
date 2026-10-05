/**
 * @module ai/skills/write
 * @description Write: a piece of prose, from the project's notes, on its own
 * prompt.
 *
 * The chat's prompt is editorial — brainstorm, read, give notes — and the rules
 * that make a model write well are prohibitions, which cost something wherever
 * they sit: told never to say what a gesture means, an assistant asked for
 * feedback on a gesture has been told not to give it. So the writing gets a
 * prompt of its own, and this is it. What the prompt says was arrived at by
 * measurement, one rule per round, in the transcript harness (`harness/` in
 * the app; each round's scores are beside its transcripts), and it should
 * change the same way: a sentence at a time, against five runs.
 *
 * It is a skill by the same contract as the others — its own prompt over the
 * conversation it is asked in, reached through `consult` — but the model is
 * not offered it yet. A tool's answer is consumed by the model that called
 * it, and a scene handed back that way would be relayed by a second model
 * pass: twice the tokens, and a rewrite by exactly the prompt this one exists
 * to get away from. A turn can hand its reply to a skill outright now, which
 * is the way round that (handOverReply in composables/useAIChat.js); whether
 * a chat that does reads well is the harness's to say before Write is offered.
 * Until then the writer reaches it themselves, as `/write`, and what it writes
 * is the reply. See ai/commands.js.
 *
 * It reads the project and never writes to it. Where a piece goes is the
 * writer's decision, made after they have read it.
 *
 * What it is lives in its SKILL.md, beside this.
 */

import skillFile from './SKILL.md?raw'
import { readBuiltInSkill } from '../format.js'

/** @typedef {import('../../tools/registry.js').ToolContext} ToolContext */

/** Write, as its SKILL.md has it. */
export const WRITE = readBuiltInSkill(skillFile)

export const WRITE_PROMPT = WRITE.body

/**
 * The tools it asks for: the ones that read. Names, not definitions, the same
 * way the Director declares its own — the caller resolves them, and this module
 * imports nothing from ../../tools. They are the `allowed-tools` of its
 * SKILL.md.
 *
 * @type {string[]}
 */
export const WRITE_TOOLS = WRITE.tools

/**
 * How the writing request is sampled.
 *
 * Nothing yet: the prompt was tuned at the writer's own settings, and a change
 * here would be a change to what was measured. It is the place to make one —
 * writing wants variance where judging does not, and the design notes argue
 * for thinking off on lines of dialogue — but each is a round of the harness,
 * not an assumption. Whatever goes in is laid over the writer's settings and
 * should name only what it means to change; see ai/skills/index.js.
 *
 * @type {import('../../defaults.js').AISettingsOverrides}
 */
export const WRITE_SETTINGS = {}

/**
 * The role, and what it was asked for.
 *
 * The brief goes in the system prompt because that is the one message a skill
 * gets to itself; the rest of what it reads is the writer's conversation and
 * the project, and it is not the writer's turn it is answering.
 *
 * After the role, rather than written into its body, for the reason
 * Interpret's question is: a profile's rewording is the role alone.
 *
 * @param {string} brief - What the writer asked for, in their words
 * @param {string} [base] - What the role runs under; its own when not given
 * @returns {string}
 */
export function buildWritePrompt(brief, base) {
  return `${base || WRITE_PROMPT}

## The brief

${brief}`
}

/**
 * @param {{brief?: string}} args
 * @param {ToolContext} [context]
 * @returns {Promise<{draft: string}|{error: string}>}
 */
export async function executeWrite(args, context = {}) {
  const brief = typeof args?.brief === 'string' ? args.brief.trim() : ''
  if (!brief) {
    return {
      error: 'Say what to write, e.g. write("The scene where Riley turns up at the apartment").',
    }
  }

  if (typeof context.consult !== 'function') {
    return { error: 'There is no model here to write with.' }
  }

  // Under the default names, not the table's: a piece of writing is asked for
  // in any chat, and a writer told it is reading a game master writes a game.
  const draft = await context.consult(
    buildWritePrompt(brief, context.promptFor?.('write')),
    WRITE_TOOLS,
    {
      overrides: WRITE_SETTINGS,
    }
  )
  if (!draft) {
    return { error: 'Nothing came back to put on the page.' }
  }

  return { draft }
}

/**
 * Write, asked by the writer: `/write The scene at the door`. What it writes is
 * the reply.
 *
 * @param {string} brief
 * @param {ToolContext} [context]
 * @returns {Promise<{answer: string}|{error: string}>}
 */
export async function askWrite(brief, context = {}) {
  const outcome = await executeWrite({ brief }, context)
  return 'error' in outcome ? outcome : { answer: outcome.draft }
}
