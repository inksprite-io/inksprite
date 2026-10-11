/**
 * @module ai/skills
 * @description Skills: the pieces of the work with a prompt of their own, and
 * the registry of them.
 *
 * A skill is a SKILL.md — a name, a description, instructions — and three
 * settings: who may call it (the model, the writer, or both), whether it runs
 * on its own or joins its caller's conversation, and, when it runs on its own,
 * where its answer goes. The file format is ./format.js; the four that ship
 * with the app each have a folder here, their SKILL.md beside the code for
 * what a file cannot say. See `.llm/skills_design.md`.
 *
 * Everything else is made from this list rather than naming skills one at a
 * time: the tools the model can call a skill by (../tools/index.js), the
 * commands the writer can (../commands.js), and the chat settings that list
 * them and hold a profile's rewording of each.
 *
 * All four run on their own. Such a skill is another inference: its own system
 * prompt, over the conversation the caller is already in, handing back what it
 * said. That is the whole contract — same registry, same tool call, no
 * orchestration layer above the turn loop, which already sequences model calls
 * and tool results and is the only scheduler this needs.
 *
 * The inference itself belongs to the caller, not to this module. A skill
 * reaches it through `consult` on the tool context, supplied by whoever is
 * running the turn (see composables/useAIChat.js), so nothing here has to know
 * which provider, profile, or chat it is running in — and a skill stays a
 * plain function of its arguments in a test.
 *
 * A skill may have tools of its own. Its SKILL.md names the ones it needs and
 * `consult` runs the loop, through the same executor the turn loop uses, so a
 * tool behaves the same whichever role reached for it. Those tools belong to
 * the skill, the way its prompt does, and are not the chat's to switch off,
 * since the chat's tool settings are about the assistant the writer is talking
 * to and a skill is not that assistant.
 *
 * One of those tools may be another skill: the Director asks `interpret` for an
 * idea the same way the Game Master does. What stops that from running away is
 * SKILL_MAX_DEPTH, applied where the tools are resolved rather than trusted to
 * each skill's list.
 *
 * A skill says how its own request is sampled, too: an AISettingsOverrides bag
 * declared beside its code, and passed with its prompt and tools. The roles
 * want different things from the same model — the Game Master is writing and
 * wants variance, the Director is judging and does not — and one profile
 * cannot be right for all of them at once. The bag is laid over what the
 * writer tuned rather than replacing it, so it should name only what it
 * actually means to change: every field left out is one they keep.
 *
 * Write and Compact are the writer's alone. A summary is not an answer at
 * all. A scene is, and a turn can hand its reply to a skill now, so what it
 * writes is the reply rather than relayed and written twice (see
 * handOverReply in composables/useAIChat.js); Write is offered to the model
 * once the harness says a chat that hands off its writing still reads well.
 *
 * The wording is the writer's to change, in two places: a built-in's for every
 * chat, in the library, and any skill's for the chats on one profile. Each is
 * an override, never a copy: a skill whose prompt the writer has not touched
 * reads the one its file has, and keeps picking up improvements to it — the
 * reason a profile made today is not stranded on today's wording. See
 * `skillPrompt`.
 */

import { INTERPRET, executeInterpret, askInterpret } from './interpret/index.js'
import { WRITE, askWrite, executeWrite } from './write/index.js'
import { COMPACT, askCompact } from './compact/index.js'
import { parseSkill } from './format.js'
import { offeredToModel, runOnItsOwn, writerCalls } from './runner.js'

/** @typedef {import('../tools/registry.js').ToolContext} ToolContext */

/**
 * A skill the app can run: what its file says, and the code for what a file
 * cannot.
 *
 * @typedef {import('./format.js').SkillDefinition & {
 *   builtIn: boolean,
 *   id?: string,
 *   files?: import('../../types/models.js').SkillFile[],
 *   execute?: (args: Object, context?: ToolContext) => Promise<Object>,
 *   ask?: (argument: string, context?: ToolContext, options?: {past?: number}) => Promise<{answer: string}|{error: string}>,
 * }} Skill
 *
 * `builtIn` says whether it ships with the app; one of the writer's has the
 * `id` their library keeps it under, and the `files` that came with it, which
 * a skill the model loads can point it to (see ../tools/useSkill.js).
 * `execute` is what the model's call runs,
 * and what it returns is the model's tool result, in whatever shape that skill
 * answers in. `ask` is what the writer's command runs, and what it answers is
 * text: a record in their turn, the reply, or a summary, as the skill's output
 * says. A skill with neither is one the model or the writer cannot call yet,
 * or one the writer calls as a saved prompt; see ./runner.js.
 */

/**
 * How many round trips a skill gets before it has to answer.
 *
 * A skill is consulted mid-turn and the turn that called it is waiting, so this
 * is the budget for its whole conversation with itself: enough to ask, look,
 * and answer, and not enough to run a scene. A skill that spends it without
 * answering is treated as having said nothing.
 */
export const SKILL_MAX_ROUNDS = 4

/**
 * How many skills deep a turn may go.
 *
 * The turn the writer is waiting on is depth 0; a skill it consults runs at
 * depth 1, and a skill that one consults at depth 2, which is as far as this
 * goes. Depth 1 is the Director; depth 2 is the `interpret` it asks for an idea
 * on the way to its advice. Below that there is nothing a role needs that it
 * cannot ask for itself, and the recursion has no natural floor — every skill
 * runs inside the clock of the turn that called it, and a model choosing its
 * own depth is a model choosing how long the writer waits.
 *
 * The limit lives at the point tools are resolved (see getToolDefinitionsFor),
 * so it holds whatever a skill's list asks for.
 */
export const SKILL_MAX_DEPTH = 2

/**
 * The skills that ship with the app, in the order the settings list them and
 * the model's tools are offered.
 *
 * The Director is not among them for now: it does not direct well enough yet
 * to be offered to the model or shown in the settings. Its file and its code
 * stay in ./director, and putting `{ ...DIRECTOR, builtIn: true, execute:
 * executeDirector }` back at the head of this list brings it back. The
 * writer's own `/director`, which asks no model, is a command of its own and
 * stays.
 *
 * @type {Skill[]}
 */
export const BUILT_IN_SKILLS = [
  { ...INTERPRET, builtIn: true, execute: executeInterpret, ask: askInterpret },
  // A tool too, for when the model is offered it; the file says whether it is.
  { ...WRITE, builtIn: true, execute: executeWrite, ask: askWrite },
  { ...COMPACT, builtIn: true, ask: askCompact },
]

/**
 * The writer's own skills, as their library last said: each read from its
 * file and given the general runner, since it has no code of its own. See
 * ./runner.js.
 *
 * Set by the store that keeps the library (`setLibrarySkills`) rather than
 * read from it, so nothing here knows there is a database, and a test can
 * hand it a library of its own.
 *
 * @type {Skill[]}
 */
let library = []

/**
 * What the writer has a built-in run under in every chat, by name, as their
 * library last said. A built-in absent here runs under its own file's words.
 *
 * Set from the same store as the library (`setSkillWordings`). A skill of the
 * writer's has no entry: its words are its file, which they edit instead.
 *
 * @type {Map<string, string>}
 */
let wordings = new Map()

/** @type {Set<() => void>} */
const listeners = new Set()

/**
 * A skill of the writer's, from what the library keeps of it.
 *
 * One whose file does not read is left out rather than guessed at. The screen
 * that keeps the library says what is wrong with it; the model and the command
 * line never see it. So is one that takes a built-in's name, which the screen
 * does not allow and a library from elsewhere might.
 *
 * @param {{id: string, text: string, files?: import('../../types/models.js').SkillFile[]}} stored
 * @returns {Skill|null}
 */
function fromLibrary(stored) {
  const read = parseSkill(stored.text)
  if ('errors' in read) return null
  const skill = read.skill
  if (BUILT_IN_SKILLS.some(one => one.name === skill.name)) return null

  /** @type {Skill} */
  const made = { ...skill, id: stored.id, builtIn: false, files: stored.files || [] }
  if (offeredToModel(skill)) {
    made.execute = (args, context) =>
      runOnItsOwn(skill, skill.argument ? args?.[skill.argument] : '', context)
  }
  if (writerCalls(skill) === 'ask') {
    made.ask = (input, context) => runOnItsOwn(skill, input, context)
  }
  return made
}

/**
 * Replace the writer's skills with these, and tell everything made from the
 * list — the model's tools, the commands — to make itself again.
 *
 * @param {Array<{id: string, text: string, files?: import('../../types/models.js').SkillFile[]}>} stored -
 *   The library, as kept
 */
export function setLibrarySkills(stored) {
  /** @type {Skill[]} */
  const made = []
  for (const one of stored || []) {
    const skill = fromLibrary(one)
    if (skill && !made.some(other => other.name === skill.name)) made.push(skill)
  }
  library = made
  for (const listener of listeners) listener()
}

/**
 * Replace the writer's wordings of the built-ins with these.
 *
 * Nothing made from the list changes with them — a tool's description is its
 * file's, and the prompt is read when the skill runs — so no one is told.
 *
 * @param {Array<{name: string, prompt: string}>} stored - The wordings, as kept
 */
export function setSkillWordings(stored) {
  wordings = new Map(
    (stored || [])
      .filter(one => BUILT_IN_SKILLS.some(skill => skill.name === one.name))
      .filter(one => typeof one.prompt === 'string' && one.prompt.trim())
      .map(one => [one.name, one.prompt.trim()])
  )
}

/**
 * Be told whenever the library changes.
 *
 * @param {() => void} listener
 * @returns {() => void} What to call to stop being told
 */
export function onSkillsChanged(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Every skill there is: the built-ins, then the writer's own.
 *
 * @returns {Skill[]}
 */
export function allSkills() {
  return [...BUILT_IN_SKILLS, ...library]
}

/**
 * The writer's own skills, as the registry has them now.
 *
 * @returns {Skill[]}
 */
export function librarySkills() {
  return [...library]
}

/**
 * @param {string} name
 * @returns {Skill|null}
 */
export function getSkill(name) {
  return allSkills().find(skill => skill.name === name) || null
}

/**
 * What the writer calls a skill: its name, as a word. `house-style` is House
 * style.
 *
 * @param {{name: string}} skill
 * @returns {string}
 */
export function skillLabel(skill) {
  const words = skill.name.replace(/-/g, ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * What a skill runs under, in a chat on this profile.
 *
 * The profile's wording when it has one, and the skill's own otherwise — which
 * is how a profile nobody has edited keeps getting the app's improvements. A
 * wording of nothing but space is no wording at all.
 *
 * @param {string} name - The skill's
 * @param {{skills?: Record<string, {prompt?: string}>}} [settings] - A profile's
 * @returns {string}
 */
export function skillPrompt(name, settings) {
  const override = settings?.skills?.[name]?.prompt
  if (typeof override === 'string' && override.trim()) return override.trim()
  return ownPrompt(name)
}

/**
 * What a skill runs under on a profile that has not reworded it: the writer's
 * wording of it in the library, for a built-in they have changed there, and
 * its file's otherwise.
 *
 * @param {string} name - The skill's
 * @returns {string}
 */
export function ownPrompt(name) {
  return wordings.get(name) ?? (getSkill(name)?.body || '')
}

export {
  DIRECTOR,
  directorDefinition,
  executeDirector,
  buildDirectionBlock,
  DIRECTOR_PROMPT,
  DIRECTOR_TOOLS,
  DIRECTOR_SETTINGS,
} from './director/index.js'
export {
  INTERPRET,
  interpretDefinition,
  executeInterpret,
  askInterpret,
  INTERPRET_PROMPT,
  INTERPRET_SETTINGS,
  buildInterpretPrompt,
} from './interpret/index.js'
export {
  WRITE,
  executeWrite,
  askWrite,
  buildWritePrompt,
  WRITE_PROMPT,
  WRITE_TOOLS,
  WRITE_SETTINGS,
} from './write/index.js'
export {
  COMPACT,
  askCompact,
  buildCompactPrompt,
  COMPACT_PROMPT,
  COMPACT_SETTINGS,
} from './compact/index.js'
export { parseSkill, readBuiltInSkill, toolDefinitionFor } from './format.js'
