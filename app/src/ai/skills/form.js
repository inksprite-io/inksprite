/**
 * @module ai/skills/form
 * @description A SKILL.md as the fields a form edits, and back.
 *
 * The library keeps a skill as its file, and the file is what is exported, so
 * the form does not own a copy of anything: it reads its fields out of the
 * frontmatter and writes them back into it. Every other field stays where it
 * was — a license, a `model`, a key another tool invented — and so does the
 * order the fields were in. What does not survive a save from the form is a
 * comment in the frontmatter, because the frontmatter is written afresh.
 *
 * Settings at their default are taken out rather than written, so a skill
 * saved from the form reads the way one written by hand would: no
 * `user-invocable: true`, no empty `metadata`.
 */

import { joinSkill, splitSkill } from './format.js'

/** @typedef {import('./format.js').SkillOutput} SkillOutput */

/**
 * What the form edits.
 *
 * @typedef {Object} SkillForm
 * @property {string} name
 * @property {string} description - What the model reads
 * @property {string} summary - What the writer reads; the description when empty
 * @property {boolean} model - The model may call it
 * @property {boolean} user - The writer may
 * @property {boolean} fork - It runs on its own
 * @property {SkillOutput} output - Where its answer goes, when it runs on its own
 * @property {string} argument - Its argument's name, or empty for none
 * @property {string} argumentHint
 * @property {string[]} tools - The tools it is given, when it runs on its own
 * @property {string} body - Its instructions
 */

/** @type {readonly SkillOutput[]} */
const OUTPUTS = ['result', 'reply', 'summary', 'edit']

/**
 * A field's text, or nothing for anything that is not text.
 *
 * @param {unknown} value
 * @returns {string}
 */
const textOf = value => (typeof value === 'string' ? value.trim() : '')

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function listOf(value) {
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean)
  if (Array.isArray(value)) return value.filter(item => typeof item === 'string')
  return []
}

/**
 * The form's fields, from a SKILL.md, with the frontmatter they came from. A
 * file whose frontmatter cannot be read has no form, and says why: it is
 * edited as the file until it can be.
 *
 * @param {string} text
 * @returns {{form: SkillForm, front: Record<string, unknown>}|{error: string}}
 */
export function formFromText(text) {
  const split = splitSkill(text)
  if ('error' in split) return split

  const { front, body } = split
  const metadata =
    front.metadata && typeof front.metadata === 'object' && !Array.isArray(front.metadata)
      ? /** @type {Record<string, unknown>} */ (front.metadata)
      : {}

  const model = front['disable-model-invocation'] !== true
  const output = textOf(metadata['inksprite-output'])

  return {
    front,
    form: {
      name: textOf(front.name),
      description: textOf(front.description),
      summary: textOf(metadata['inksprite-summary']),
      model,
      user: front['user-invocable'] !== false,
      fork: front.context === 'fork',
      output: /** @type {SkillOutput} */ (
        OUTPUTS.includes(/** @type {SkillOutput} */ (output)) ? output : model ? 'result' : 'reply'
      ),
      argument: listOf(front.arguments)[0] || '',
      argumentHint: textOf(front['argument-hint']),
      tools: listOf(front['allowed-tools']),
      body,
    },
  }
}

/**
 * Set a field, or take it out when it is at its default.
 *
 * @param {Record<string, unknown>} fields
 * @param {string} key
 * @param {unknown} value
 * @param {boolean} unset - Whether it is at its default
 */
function put(fields, key, value, unset) {
  if (unset) delete fields[key]
  else fields[key] = value
}

/**
 * The SKILL.md the form says, written into the frontmatter it came from.
 *
 * @param {SkillForm} form
 * @param {Record<string, unknown>} [front] - What the file had, kept where the
 *   form does not reach; a new skill has none
 * @returns {string}
 */
export function textFromForm(form, front = {}) {
  /** @type {Record<string, unknown>} */
  const fields = { ...front }
  const metadata = /** @type {Record<string, unknown>} */ ({
    ...(fields.metadata && typeof fields.metadata === 'object' ? fields.metadata : {}),
  })

  fields.name = form.name.trim()
  fields.description = form.description.trim()
  put(fields, 'disable-model-invocation', true, form.model)
  put(fields, 'user-invocable', false, form.user)
  put(fields, 'context', 'fork', !form.fork)
  put(fields, 'arguments', form.argument.trim(), !form.argument.trim())
  put(fields, 'argument-hint', form.argumentHint.trim(), !form.argumentHint.trim())
  // A skill that joins the conversation has whatever tools its chat has.
  put(fields, 'allowed-tools', form.tools.join(' '), !form.fork || form.tools.length === 0)

  put(metadata, 'inksprite-summary', form.summary.trim(), !form.summary.trim())
  // Where the answer goes only matters to a skill that runs on its own, and
  // the default — back to whoever asked, or as the reply when only the writer
  // calls it — needs no saying.
  const byDefault = form.model ? 'result' : 'reply'
  put(metadata, 'inksprite-output', form.output, !form.fork || form.output === byDefault)
  put(fields, 'metadata', metadata, Object.keys(metadata).length === 0)

  return joinSkill(fields, form.body)
}

/**
 * A SKILL.md under another name, and otherwise as it was: for a skill brought
 * in under a name something here already answers to. The frontmatter is
 * written afresh, so a comment in it goes; a file whose frontmatter cannot be
 * read is left as it is.
 *
 * @param {string} text
 * @param {string} name
 * @returns {string}
 */
export function withName(text, name) {
  const split = splitSkill(text)
  if ('error' in split) return text
  return joinSkill({ ...split.front, name: name.trim() }, split.body)
}

/**
 * The SKILL.md a new skill starts as: one only the writer calls, so it is a
 * saved prompt until they say otherwise, and a name they will change. Its
 * description and instructions are the writer's to write, so they start empty
 * and it does not read as a skill until they are written.
 *
 * @param {string} name
 * @returns {string}
 */
export function newSkillText(name) {
  return textFromForm({
    name,
    description: '',
    summary: '',
    model: false,
    user: true,
    fork: false,
    output: 'reply',
    argument: '',
    argumentHint: '',
    tools: [],
    body: '',
  })
}
