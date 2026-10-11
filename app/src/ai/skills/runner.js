/**
 * @module ai/skills/runner
 * @description How a skill of the writer's runs, with no code of its own.
 *
 * A built-in has a little code beside its SKILL.md, for what a file cannot say:
 * Interpret's draw, the key the Director answers under. A skill the writer
 * wrote or brought has only its file, so what it does follows from what the
 * file says — whether it runs on its own, who may call it, where its answer
 * goes — and this is the one way each of those runs.
 *
 * Some kinds wait on later work: one that answers with an edit has no editor
 * to put it in (step 8 of `.llm/skills_design.md`). They are kept, and
 * `waitingOn` says in a line what each is waiting for, so the writer is not
 * left guessing why a skill they saved does nothing.
 *
 * One that joins the conversation has no runner here: the model loads it with
 * `use_skill` (../tools/useSkill.js), and the writer's command puts it in
 * their turn (`savedPrompt` in ../commands.js).
 */

/** @typedef {import('./format.js').SkillDefinition} SkillDefinition */
/** @typedef {import('../tools/registry.js').ToolContext} ToolContext */

/**
 * Put what was typed into a skill's instructions.
 *
 * `$ARGUMENTS`, as Claude Code's files write it, and `$name` for a skill that
 * names its argument. Instructions that use neither get it at the end, under
 * `ARGUMENTS:`, so something typed after a name is never lost; with nothing
 * typed, nothing is added.
 *
 * @param {string} text - The instructions
 * @param {string|null} argument - The name the skill gives its argument, if any
 * @param {string} [input] - What was typed after the name
 * @returns {string}
 */
export function fillArgument(text, argument, input) {
  const said = (input || '').trim()
  let used = false
  const fill = () => {
    used = true
    return said
  }

  let out = text.replace(/\$ARGUMENTS(?![\w-])/g, fill)
  if (argument) {
    const escaped = argument.replace(/[-\\^$*+?.()|[\]{}]/g, '\\$&')
    out = out.replace(new RegExp(`\\$${escaped}(?![\\w-])`, 'g'), fill)
  }

  if (!used && said) out = `${out}\n\nARGUMENTS: ${said}`
  return out
}

/**
 * Whether the model is offered this skill yet: one that runs on its own and
 * answers back to whoever asked, or answers as the reply — which the turn
 * hands over to it, and ends with what it writes.
 *
 * @param {SkillDefinition} skill
 * @returns {boolean}
 */
export function offeredToModel(skill) {
  return skill.model && skill.fork && (skill.output === 'result' || skill.output === 'reply')
}

/**
 * Whether the model loads this skill into its own conversation, by
 * `use_skill`, rather than calling it as a tool of its own: one that joins the
 * conversation and that the model may call.
 *
 * @param {SkillDefinition} skill
 * @returns {boolean}
 */
export function loadedByModel(skill) {
  return skill.model && !skill.fork
}

/**
 * How the writer can call this skill yet, if they can.
 *
 * - `ask`: it runs on its own, and its answer is a record in their turn or the
 *   reply, as its output says
 * - `prompt`: it joins the conversation, so calling it puts its instructions in
 *   their turn — a saved prompt, or, for one the model could load too, a load
 *   the chat keeps as it keeps the model's.
 *
 * @param {SkillDefinition} skill
 * @returns {'ask'|'prompt'|null}
 */
export function writerCalls(skill) {
  if (!skill.user) return null
  if (!skill.fork) return 'prompt'
  if (skill.output === 'result' || skill.output === 'reply') return 'ask'
  return null
}

/**
 * Who calls a skill, in a line for the writer: the one thing about it the list
 * cannot otherwise show, since a skill the model calls looks like any other.
 * How it runs and where its answer goes are the editor's to say.
 *
 * @param {SkillDefinition} skill
 * @returns {string}
 */
export function describeCallers(skill) {
  if (skill.model && skill.user) return 'Called by the model or you'
  return skill.model ? 'Called by the model' : 'Called by you'
}

/**
 * What a skill of the writer's is waiting on, in a line, or nothing when all
 * of it works now.
 *
 * @param {SkillDefinition} skill
 * @returns {string}
 */
export function waitingOn(skill) {
  if (skill.output === 'edit' && skill.fork) {
    return 'A skill that answers with an edit has nowhere to put it yet.'
  }
  if (skill.output === 'summary' && skill.fork) {
    return 'Only Compact answers with a summary.'
  }
  return ''
}

/**
 * Run a skill of the writer's that runs on its own: its instructions — a
 * profile's rewording, when there is one — with the argument put in, over the
 * conversation, with the tools and the speakers its file names.
 *
 * @param {SkillDefinition} skill
 * @param {string} input - Its argument, as typed or as the model gave it
 * @param {ToolContext} [context]
 * @returns {Promise<{answer: string}|{error: string}>}
 */
export async function runOnItsOwn(skill, input, context = {}) {
  const said = typeof input === 'string' ? input.trim() : ''
  if (skill.argument && !said) {
    return { error: `Give it its ${skill.argument}: ${skill.name}(${skill.argument}="…").` }
  }
  if (typeof context.consult !== 'function') {
    return { error: 'It can’t run in this conversation.' }
  }

  const base = context.promptFor?.(skill.name) || skill.body
  const answer = await context.consult(fillArgument(base, skill.argument, said), skill.tools, {
    roles: skill.speakers ?? undefined,
  })
  if (!answer) return { error: 'It had nothing to say.' }

  return { answer }
}
