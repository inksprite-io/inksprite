/**
 * @module ai/skills/interpret
 * @description Interpret: an idea, for the places the fiction does not settle
 * itself.
 *
 * Ask it a question — what this NPC wants, what is in the diary, where the
 * scene should turn — and it draws a tarot card, reads it against the story it
 * is in, and answers with what it made of it.
 *
 * The draw stays here. That is the whole reason this is a skill rather than a
 * tool: a card like The Tower, reversed, is a prompt, not an answer, and a
 * model handed one mid-turn stops running the game and starts solving it —
 * paragraphs of reasoning about what the card could mean, and then a scene bent
 * around whichever reading it argued itself into, because the reading is the
 * freshest thing in its context. Interpreting it somewhere else costs an
 * inference and returns a sentence the caller can simply use.
 *
 * It imports the draw rather than asking for one as a tool. Not for the round
 * it saves: a skill that has to choose to draw can choose not to, and
 * an `interpret` that answered out of its own head would look exactly like one
 * that had drawn. The draw is the point, so it is not the model's to skip.
 * (Importing ../../tools/rpg.js is not the cycle the other skills step around —
 * that one is ../../tools/index.js, which imports this module.)
 *
 * What it is lives in its SKILL.md, beside this; the draw is the part a file
 * cannot say.
 */

import skillFile from './SKILL.md?raw'
import { readBuiltInSkill, toolDefinitionFor } from '../format.js'
import { drawCard } from '../../tools/rpg.js'

/** @typedef {import('../../tools/registry.js').ToolDefinition} ToolDefinition */
/** @typedef {import('../../tools/registry.js').ToolContext} ToolContext */

/** Interpret, as its SKILL.md has it. */
export const INTERPRET = readBuiltInSkill(skillFile)

export const INTERPRET_PROMPT = INTERPRET.body

/**
 * How the oracle's own request is sampled.
 *
 * Nothing, at the moment: it runs at whatever the writer tuned for their model,
 * thinking included. Which is a position and not an oversight — an empty bag
 * says this role has no quarrel with the profile, and the reading it does is
 * close enough to what the model is already set up to do.
 *
 * Its thinking is worth having here in a way it is not in the turn itself. The
 * card is the one thing an interpretation turns on and the one thing nobody is
 * allowed to see; watching it reason toward a reading is the only view of that
 * there is. `/interpret` shows it in the message.
 *
 * The place to tune the role. Whatever goes in is laid over the writer's
 * settings, so it should name only what it means to change — see
 * ai/skills/index.js.
 *
 * @type {import('../../defaults.js').AISettingsOverrides}
 */
export const INTERPRET_SETTINGS = {}

/**
 * A drawn card as the oracle is shown it: its name, and which way up. Upright
 * is said too, so the reader is never left to guess which way it came.
 *
 * @param {import('../../tools/rpg.js').DrawnCard} draw
 * @returns {string}
 */
export function describeCard({ card, reversed }) {
  return `${card}, ${reversed ? 'reversed' : 'upright'}`
}

/**
 * The role, the question it was asked, and the draw it has to read.
 *
 * All three go in the system prompt because that is the one message a skill
 * gets to itself — the rest of the conversation is the game, which it is
 * reading over the caller's shoulder and must not be seen to answer.
 *
 * Put after the role here rather than written into its body as `$question`:
 * a profile that rewords the role stores the role alone, and a body that
 * expected to be filled in would lose the question from every one of those.
 *
 * @param {string} question - What the caller wants an idea about
 * @param {import('../../tools/rpg.js').DrawnCard} draw - The card, and which way up
 * @param {string} [base] - What the role runs under; its own when not given
 * @returns {string}
 */
export function buildInterpretPrompt(question, draw, base) {
  return `${base || INTERPRET_PROMPT}

## The question

${question}

## The card

${describeCard(draw)}`
}

/** What the model calls it by: its SKILL.md's description, and the question. */
export const interpretDefinition = toolDefinitionFor(INTERPRET)

/**
 * @param {{question?: string}} args
 * @param {ToolContext} [context]
 * @returns {Promise<{interpretation: string}|{error: string}>}
 */
export async function executeInterpret(args, context = {}) {
  const question = typeof args?.question === 'string' ? args.question.trim() : ''
  if (!question) {
    return { error: 'Ask a question, e.g. interpret("What is this innkeeper afraid of?").' }
  }

  if (typeof context.consult !== 'function') {
    return { error: 'The oracle is not available in this conversation.' }
  }

  const draw = drawCard()

  // The one place the card is visible. It is kept from the model on purpose and
  // from the reader on purpose, which leaves nowhere to answer the only
  // question worth asking about an interpretation that came out strangely:
  // what did it draw. The console is not the fiction, so it can say.
  console.log('Interpret draw:', describeCard(draw), { question })

  // No tools. The draw it needs is already made, and everything else it could
  // ask is the caller's to ask: it reads, it answers, in one breath.
  const prompt = buildInterpretPrompt(question, draw, context.promptFor?.('interpret'))
  const interpretation = await context.consult(prompt, undefined, {
    roles: INTERPRET.speakers ?? undefined,
    overrides: INTERPRET_SETTINGS,
  })
  if (!interpretation) {
    return { error: 'The oracle had nothing to say. Decide it yourself.' }
  }

  return { interpretation }
}

/**
 * Interpret, asked by the writer: `/interpret What is she afraid of?`.
 *
 * The same skill the model reaches, making the same draw; what differs is only
 * who asked, and that the answer is text for the writer's turn rather than a
 * tool result.
 *
 * @param {string} question
 * @param {ToolContext} [context]
 * @returns {Promise<{answer: string}|{error: string}>}
 */
export async function askInterpret(question, context = {}) {
  const outcome = await executeInterpret({ question }, context)
  return 'error' in outcome ? outcome : { answer: outcome.interpretation }
}
