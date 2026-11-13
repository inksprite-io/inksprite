/**
 * @module ai/skills/compact
 * @description Compact: a long conversation, folded into a summary of itself.
 *
 * The writer's to call, as `/compact`, and the model's never. What the summary
 * is for, where it sits and how a history reads once there is one is
 * ai/compaction.js; this is the skill that writes one — its prompt, how its
 * request is sampled, and what the writer asked this one to favour.
 *
 * What it is lives in its SKILL.md, beside this. Its prompt is the one most
 * worth rewording by profile: what an editorial chat needs kept (what was
 * decided, what is left to do) throws away exactly what a played-out scene is
 * made of, which is why the Roleplay profile carries a wording of its own.
 */

import skillFile from './SKILL.md?raw'
import { readBuiltInSkill } from '../format.js'

/** @typedef {import('../../tools/registry.js').ToolContext} ToolContext */

/** Compact, as its SKILL.md has it. */
export const COMPACT = readBuiltInSkill(skillFile)

export const COMPACT_PROMPT = COMPACT.body

/**
 * How the summarizer's own request is sampled: the way the writer tuned their
 * model, and nothing laid over it.
 *
 * What was here was a temperature of 0.3. This is the one role that is not
 * writing, and a summary written at settings tuned to invent invents too — a
 * detail that reads well, is never corrected, and is a fact for the rest of
 * the game because it is the only version of the past that survived. But the
 * request goes to whatever model the chat is on, and the newest Claude models
 * refuse any temperature at all, so compacting failed outright on a server
 * that passes the key on. If summaries start to invent, the prompt is the
 * place to say so.
 *
 * The place to tune the role — see ai/skills/index.js.
 *
 * @type {import('../../defaults.js').AISettingsOverrides}
 */
export const COMPACT_SETTINGS = {}

/**
 * What a summary is asked for with, and what this particular one is for: the
 * skill's wording, or the profile's, and what the writer asked it to favour
 * under it.
 *
 * @param {string} [instructions] - What the writer asked this one to favour
 * @param {string} [base] - The wording; the skill's own when not given
 * @returns {string}
 */
export function buildCompactPrompt(instructions, base) {
  const under = base || COMPACT_PROMPT
  const asked = (instructions || '').trim()
  if (!asked) return under

  return `${under}

## What this one is for

${asked}`
}

/**
 * What goes ahead of the wording when the summary is asked for in the thread.
 *
 * The chat's own prompt is still above the conversation, and for a scene it
 * says to stay in it, so this says the one thing the wording does not: that
 * what is wanted is not the next turn. In brackets, as the app's other words
 * to a model in the writer's place are.
 */
const IN_PLACE_OF_A_TURN =
  '[The user has asked for a summary of this conversation, in place of a reply. Write the summary alone: do not continue the conversation, and call no tools.]'

/**
 * Write the summary.
 *
 * It is asked of the chat's own model at the end of the conversation, as the
 * writer's last word (`inThread`): the model has what the conversation holds,
 * the documents it read and the ones the writer attached among them, where a
 * transcript has only what was said, and the request goes on from the turn's
 * cached prefix where a transcript is read from nothing. A context with no
 * `inThread` hands it a transcript under the wording as a system prompt, as
 * every summary once was.
 *
 * It reads the turns it is keeping as well as the ones it stands for: they are
 * kept so the next turn has a scene to continue, not because the summary
 * leaves them out.
 *
 * @param {string} instructions - What the writer asked this one to favour, if anything
 * @param {ToolContext} [context]
 * @param {{past?: number}} [options] - How many turns the summary sits above
 * @returns {Promise<{answer: string}|{error: string}>}
 */
export async function askCompact(instructions, context = {}, { past } = {}) {
  const wording = buildCompactPrompt(instructions, context.promptFor?.('compact'))
  const asked = { overrides: COMPACT_SETTINGS, past }

  let summary
  if (typeof context.inThread === 'function') {
    summary = await context.inThread(`${IN_PLACE_OF_A_TURN}\n\n${wording}`, asked)
  } else if (typeof context.consult === 'function') {
    summary = await context.consult(wording, undefined, asked)
  } else {
    return { error: 'There is no conversation here to compact.' }
  }
  if (!summary) {
    return { error: 'Nothing came back to stand in for the conversation.' }
  }

  return { answer: unwrapSummary(summary) }
}

/**
 * A summary without a `<summary>` tag around the whole of it.
 *
 * That is the tag a summary goes to the model under (`renderCommand` in
 * ai/commands.js), and the oracle's answers and the rest go under tags like
 * it, so a model asked for one may write the tag itself: Claude Sonnet 5.5 did
 * on 12 Oct 2026. Left in, the writer reads the tags, and the model reads the
 * summary wrapped twice.
 *
 * @param {string} summary
 * @returns {string}
 */
export function unwrapSummary(summary) {
  const wrapped = /^\s*<summary>\s*([\s\S]*?)\s*<\/summary>\s*$/.exec(summary)
  return wrapped ? wrapped[1] : summary
}
