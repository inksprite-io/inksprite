/**
 * @module ai/skills/director
 * @description The Director: a second opinion on pacing, consulted by the Game
 * Master at the start of a turn.
 *
 * It reads the same conversation and the same project the Game Master does, but
 * from outside the fiction, and answers in a few sentences of freeform advice.
 * It narrates nothing and writes nothing — its whole output is the tool result,
 * which the player never sees.
 *
 * It rolls, though. Direction turns on things the fiction has not settled —
 * whether the pursuit is still behind them, whether the rumour was true — and a
 * Director that assumes an answer is advising the Game Master toward a scene
 * the oracle may be about to contradict. So it gets the same resolution tools
 * the Game Master has and reports what they said as part of its answer: the
 * question is asked once, by whichever of them needed it first.
 *
 * The Game Master decides when to ask, as it does for any other tool. The turn
 * loop used to be able to consult it first instead, before the Game Master had
 * written anything, and that is gone: forcing the call every turn read worse
 * than letting the role ask when it wanted one. `buildDirectionBlock` is still
 * how a direction is handed over, for the writer's own `/director`.
 *
 * What the Director is lives in its SKILL.md, beside this: its prompt, what the
 * model is told about it, the tools it gets, and what the transcript it reads
 * calls the two voices at the table. This module is the part a file cannot
 * say — how it is asked, and what it answers with.
 */

import skillFile from './SKILL.md?raw'
import { readBuiltInSkill, toolDefinitionFor } from '../format.js'

/** @typedef {import('../../tools/registry.js').ToolDefinition} ToolDefinition */
/** @typedef {import('../../tools/registry.js').ToolContext} ToolContext */

/** The Director, as its SKILL.md has it. */
export const DIRECTOR = readBuiltInSkill(skillFile)

export const DIRECTOR_PROMPT = DIRECTOR.body

/**
 * The tools the Director asks for: the ones that settle what the fiction has
 * not, and nothing else. They are the `allowed-tools` of its SKILL.md.
 *
 * Not the document tools. The Director reads the project through the block that
 * rides at the tail of every conversation, and it writes nothing — keeping the
 * notes true is the Game Master's job, and two roles revising the same document
 * inside one turn is a race with no reason to exist.
 *
 * Nor `generate_names`. Naming a thing is part of putting it on the page, and
 * the Director does not put anything on the page.
 *
 * `interpret` was here for the other half of the same problem, and is not at
 * the moment: the oracle settles a question the Director already thought to
 * ask, and interpret is what it asks when it has run out of questions — when
 * the honest answer to "what does this scene need" is that the fiction has gone
 * somewhere nothing in the notes anticipated. That belonged to a Director that
 * advised; this one directs the action, and a role deciding what happens next
 * has fewer occasions to ask what it is looking at. Kept written down because
 * the reasoning survives the role it was written for, and a skill calling a
 * skill is a thing the depth limit still allows exactly this far. See
 * SKILL_MAX_DEPTH.
 *
 * That line is the whole configuration: add a name to give the Director a tool,
 * remove one to take it away. It is not the chat's to change — a writer who
 * switches off RPG Tools is saying what the Game Master may do at the
 * table, not that the Director should go back to guessing.
 *
 * Names, not definitions, so this module imports nothing from ../tools — which
 * imports this one. The caller resolves them.
 *
 * @type {string[]}
 */
export const DIRECTOR_TOOLS = DIRECTOR.tools

/**
 * How the Director's own request is sampled: at the moment, the way everything
 * else is. Empty while the role is being retuned, and the knob to reach for
 * first when it is.
 *
 * Whatever goes here is laid over what the writer tuned for their model rather
 * than instead of it, so setting a temperature leaves a local model that needs
 * a particular top-k with it.
 *
 * What was here was a temperature cooler than the table runs at, because the
 * two roles want opposite things
 * from the same model. The Game Master is writing, and writing wants variance
 * — the same scene twice should not come out the same way. The Director is
 * reading and judging: what this scene needs is a question with better and
 * worse answers, and sampling the tail of that distribution is how you get
 * advice about a game nobody is playing.
 *
 * Whatever is set here, every field left out is one AI_DEFAULTS still decides,
 * and a maxTokens cap in particular is a trap on a model that thinks first,
 * which would spend the cap on its reasoning and return a truncated block. See
 * TITLE_DEFAULTS, which learned that the hard way.
 *
 * @type {import('../../defaults.js').AISettingsOverrides}
 */
export const DIRECTOR_SETTINGS = {}

/** What the model calls it by: its SKILL.md's description, and no parameters. */
export const directorDefinition = toolDefinitionFor(DIRECTOR)

/**
 * @param {Object} _args - The Director takes no arguments; it reads the turn it is in
 * @param {ToolContext} [context]
 * @returns {Promise<{direction: string}|{error: string}>}
 */
export async function executeDirector(_args, context = {}) {
  if (typeof context.consult !== 'function') {
    return { error: 'The Director is not available in this conversation.' }
  }

  const direction = await context.consult(
    context.promptFor?.('director') || DIRECTOR_PROMPT,
    DIRECTOR_TOOLS,
    {
      roles: DIRECTOR.speakers ?? undefined,
      overrides: DIRECTOR_SETTINGS,
    }
  )
  if (!direction) {
    return { error: 'The Director had nothing to say. Narrate the turn as you see it.' }
  }

  return { direction }
}

/**
 * The direction, as the Game Master should read it.
 *
 * A turn that consults the Director itself has no tool result to put the answer
 * in, so the answer arrives as text at the end of the conversation, where it is
 * indistinguishable from something the writer typed unless it says otherwise.
 * A tag pair says otherwise at both ends: a heading opens a section but nothing
 * closes one, and a Game Master that cannot tell where the direction stops
 * carries its voice into the narration.
 *
 * It says nothing about not calling the Director. The turn withholds the tool
 * on this path, so there is nothing to call — and an instruction not to do
 * something impossible is a line spent every turn arguing with the prompt.
 *
 * Only the direction goes in. What the Director thought on the way to it is
 * kept for the reader — a Game Master handed the working narrates the working.
 *
 * @param {string} direction - What the Director said
 * @returns {string}
 */
export function buildDirectionBlock(direction) {
  return `<director>\n${direction.trim()}\n</director>`
}
