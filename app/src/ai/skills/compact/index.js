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
 * How the summarizer's own request is sampled.
 *
 * The one role here that is not writing. Everything else on this table is tuned
 * to invent, and a summary written at those settings invents too — a detail
 * that reads well, is never corrected, and is a fact for the rest of the game
 * because it is the only version of the past that survived. So the temperature
 * comes down, and nothing else is named: what the writer tuned for their model
 * still applies everywhere this does not.
 *
 * The place to tune the role — see ai/skills/index.js.
 *
 * @type {import('../../defaults.js').AISettingsOverrides}
 */
export const COMPACT_SETTINGS = { parameters: { temperature: 0.3 } }

/**
 * The role, and what this particular compaction is for.
 *
 * The writer's instructions go in the system prompt rather than the transcript,
 * for the same reason a skill's question does: the transcript is the material,
 * and a note about how to read it that arrives inside the material reads as
 * something a character said.
 *
 * @param {string} [instructions] - What the writer asked this one to favour
 * @param {string} [base] - What the role runs under; its own when not given
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
 * Write the summary.
 *
 * It reads the turns it is keeping as well as the ones it stands for: they are
 * kept so the next turn has a scene to continue, not because the summary
 * leaves them out. And it reads them under the default names rather than the
 * table's — compaction happens to any chat, and a summarizer told it is
 * reading a game master starts writing like one.
 *
 * @param {string} instructions - What the writer asked this one to favour, if anything
 * @param {ToolContext} [context]
 * @param {{past?: number}} [options] - How many turns the summary sits above
 * @returns {Promise<{answer: string}|{error: string}>}
 */
export async function askCompact(instructions, context = {}, { past } = {}) {
  if (typeof context.consult !== 'function') {
    return { error: 'There is no conversation here to compact.' }
  }

  const under = buildCompactPrompt(instructions, context.promptFor?.('compact'))
  const summary = await context.consult(under, undefined, {
    overrides: COMPACT_SETTINGS,
    past,
  })
  if (!summary) {
    return { error: 'Nothing came back to stand in for the conversation.' }
  }

  return { answer: summary }
}
