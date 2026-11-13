/**
 * The skills the harness tunes before any of them ships: each a SKILL.md and
 * the code for what a file can't say, run through the app's own registry
 * once `setTrialSkills` sets them beside the built-ins (`@/ai/skills`). The
 * app sets none of them.
 *
 * - **Interpret** draws a tarot card out of sight and reads it against the
 *   story, for an idea, as a tool and as `/interpret`.
 * - **Write** writes prose from the project's notes as the turn's reply, as a
 *   tool and as `/write`.
 *
 * Whether a scenario's model is offered them is its chat's to say, by its
 * tools: they are in the skills group.
 */

import { INTERPRET, askInterpret, executeInterpret } from './interpret/index.js'
import { WRITE, askWrite, executeWrite } from './write/index.js'

/** @type {import('@/ai/skills/index.js').Skill[]} */
export const TRIAL_SKILLS = [
  { ...INTERPRET, builtIn: true, execute: executeInterpret, ask: askInterpret },
  { ...WRITE, builtIn: true, execute: executeWrite, ask: askWrite },
]
