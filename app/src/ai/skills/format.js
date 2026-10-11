/**
 * @module ai/skills/format
 * @description A skill as a file: SKILL.md, read into what the app runs.
 *
 * A skill is YAML frontmatter and a Markdown body, the Agent Skills format
 * that Claude, Codex and others read. Where Claude Code already has a field
 * for something a skill here needs, the field is spelled its way —
 * `disable-model-invocation`, `user-invocable`, `context: fork`, `arguments`,
 * `argument-hint`, `allowed-tools` — so a file written for it reads here as it
 * was meant. What only inksprite needs goes under `metadata`, as
 * `inksprite-*`, because claude.ai refuses a skill whose frontmatter has fields
 * it does not know.
 *
 * The built-in skills are read by this too, from their own SKILL.md, so the
 * format has to answer to the four skills that were measured. See
 * `.llm/skills_design.md`, part 2.
 *
 * Pure, and it imports nothing of the app's: a skill file is text until this
 * says what it is.
 */

import { dump, load } from 'js-yaml'

/** @typedef {import('../tools/registry.js').ToolDefinition} ToolDefinition */
/** @typedef {import('../context/build.js').TranscriptRoles} TranscriptRoles */

/**
 * Where a skill that runs on its own puts what it said.
 *
 * - `result`: back to whoever called it — the model's tool result, or a record
 *   in the writer's turn
 * - `reply`: it is the reply
 * - `summary`: it stands in for the conversation above it
 * - `edit`: a replacement for a passage in a document
 *
 * @typedef {'result'|'reply'|'summary'|'edit'} SkillOutput
 */

/**
 * A skill, as read from its file.
 *
 * @typedef {Object} SkillDefinition
 * @property {string} name - What the writer types after the slash, and the
 *   model's name for the tool
 * @property {string} description - What it does and when to use it. The model
 *   reads this to decide whether to call it.
 * @property {string} summary - What it does, in a line, for the writer: the
 *   command menu and the chat's settings. The description when the file gives
 *   no line of its own.
 * @property {boolean} model - Whether the model may call it
 * @property {boolean} user - Whether the writer may
 * @property {boolean} fork - Whether it runs on its own, as an inference of its
 *   own under its own prompt, rather than joining its caller's conversation
 * @property {SkillOutput} output - Where its answer goes, when it runs on its own
 * @property {string|null} argument - The name of its one argument, when it names
 *   one. A named argument is required.
 * @property {string} argumentHint - What the writer is shown after the name
 * @property {string} argumentDescription - What the model is told about the argument
 * @property {string[]} tools - The tools it is given, when it runs on its own
 * @property {TranscriptRoles|null} speakers - What the conversation it reads
 *   calls its two voices, when it says; the transcript's own names otherwise
 * @property {string} body - Its instructions: the prompt it runs under, or the
 *   text an inline skill brings to its caller
 * @property {string} [license]
 * @property {string} [compatibility]
 */

/** Frontmatter between two lines of three dashes, at the very top. */
const FRONTMATTER = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * Lowercase letters, digits and single hyphens, as the standard has it, and a
 * letter first, as the command line has it. `COMMAND_LINE` in ai/commands.js
 * would take more; this is the part both agree on.
 */
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** The longest name and description the standard allows. */
const MAX_NAME = 64
const MAX_DESCRIPTION = 1024

/** What an argument can be called and still be written `$name` in a body. */
const ARGUMENT = /^[A-Za-z_][\w-]*$/

/** @type {readonly SkillOutput[]} */
const OUTPUTS = ['result', 'reply', 'summary', 'edit']

/**
 * The fields this reads. Anything else is let through and named as ignored:
 * mostly fields about somewhere else — `model` and `effort`, which name
 * another product's models, when which model runs a skill is the writer's
 * setup rather than the skill's, and `agent`, `background`, `hooks`, `paths`
 * and `shell`, which are about how a coding tool hosts one.
 */
const FIELDS = new Set([
  'name',
  'description',
  'when_to_use',
  'disable-model-invocation',
  'user-invocable',
  'context',
  'arguments',
  'argument-hint',
  'allowed-tools',
  'metadata',
  'license',
  'compatibility',
])

/**
 * A space- or comma-separated string, or a list, as a list.
 *
 * @param {unknown} value
 * @returns {string[]|null} Null when it is neither
 */
function listOf(value) {
  if (value === undefined || value === null) return []
  if (typeof value === 'string') return value.split(/[\s,]+/).filter(Boolean)
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
    return value.map(item => item.trim()).filter(Boolean)
  }
  return null
}

/**
 * A SKILL.md in its two parts: the frontmatter, as the fields YAML reads it
 * into, and the body. Nothing about what the fields mean — that is
 * `parseSkill` — only whether there are fields to read.
 *
 * @param {string} text - The whole file
 * @returns {{front: Record<string, unknown>, body: string}|{error: string}}
 */
export function splitSkill(text) {
  const match = FRONTMATTER.exec(text || '')
  if (!match) {
    return { error: 'A skill starts with its frontmatter, between two lines of three dashes.' }
  }

  let front
  try {
    front = load(match[1])
  } catch (error) {
    return { error: `Its frontmatter is not YAML that can be read: ${error.message}` }
  }
  if (!front || typeof front !== 'object' || Array.isArray(front)) {
    return { error: 'Its frontmatter has to be a set of fields.' }
  }

  return {
    front: /** @type {Record<string, unknown>} */ (front),
    body: (text || '').slice(match[0].length).trim(),
  }
}

/**
 * A SKILL.md from its two parts: the fields written as YAML between the
 * dashes, and the body under them.
 *
 * @param {Record<string, unknown>} front
 * @param {string} body
 * @returns {string}
 */
export function joinSkill(front, body) {
  return `---\n${dump(front, { lineWidth: 80, noRefs: true })}---\n\n${body.trim()}\n`
}

/** What a skill with no description is told. */
export const NEEDS_DESCRIPTION = 'It needs a `description`: what it does, and when to use it.'

/** What a skill with no instructions is told. */
export const NEEDS_INSTRUCTIONS = 'It needs instructions, under its frontmatter.'

/**
 * What is wrong with a skill's name as a name, whatever else has it.
 *
 * @param {string} name - Trimmed
 * @returns {string} Nothing for a good one
 */
export function nameError(name) {
  if (!name) return 'It needs a `name`.'
  if (name.length > MAX_NAME) return `Its name is longer than ${MAX_NAME} characters.`
  if (!NAME.test(name)) {
    return `"${name}" cannot be a name: lowercase letters, digits and single hyphens, starting with a letter.`
  }
  return ''
}

/**
 * Read a SKILL.md.
 *
 * Everything that is wrong with it is said, not just the first thing, so a
 * writer fixing a file by hand fixes it once. Fields it does not use are named
 * in `ignored`, for anyone importing it who wants to know what did not come
 * across.
 *
 * @param {string} text - The whole file
 * @returns {{skill: SkillDefinition, ignored: string[]}|{errors: string[]}}
 */
export function parseSkill(text) {
  const split = splitSkill(text)
  if ('error' in split) return { errors: [split.error] }

  const fields = split.front
  /** @type {string[]} */
  const errors = []
  const textField = (/** @type {string} */ key) => {
    const value = fields[key]
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string') {
      errors.push(`\`${key}\` has to be text.`)
      return ''
    }
    return value.trim()
  }
  const flag = (/** @type {string} */ key, /** @type {boolean} */ otherwise) => {
    const value = fields[key]
    if (value === undefined || value === null) return otherwise
    if (typeof value !== 'boolean') {
      errors.push(`\`${key}\` has to be true or false.`)
      return otherwise
    }
    return value
  }

  const name = textField('name')
  const badName = nameError(name)
  if (badName) errors.push(badName)

  const described = textField('description')
  if (!described) errors.push(NEEDS_DESCRIPTION)
  else if (described.length > MAX_DESCRIPTION) {
    errors.push(`Its description is longer than ${MAX_DESCRIPTION} characters.`)
  }
  const whenToUse = textField('when_to_use')
  const description = whenToUse ? `${described} ${whenToUse}` : described

  const model = !flag('disable-model-invocation', false)
  const user = flag('user-invocable', true)
  if (!model && !user) errors.push('Nobody can call it: the model is kept from it, and so are you.')

  const context = fields.context
  if (context !== undefined && context !== null && context !== 'fork') {
    errors.push('`context` can only be `fork`, for a skill that runs on its own.')
  }
  const fork = context === 'fork'

  const named = listOf(fields.arguments)
  if (named === null) errors.push('`arguments` has to be a name, or a list of them.')
  else if (named.length > 1) {
    errors.push('It can take one argument: everything typed after its name.')
  } else if (named.length === 1 && !ARGUMENT.test(named[0])) {
    errors.push(`"${named[0]}" cannot be an argument's name.`)
  }
  const argument = named?.length === 1 ? named[0] : null

  const tools = listOf(fields['allowed-tools'])
  if (tools === null) errors.push('`allowed-tools` has to be a list of tool names.')

  const metadata = fields.metadata ?? {}
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    errors.push('`metadata` has to be a set of fields.')
  }
  const meta = /** @type {Record<string, unknown>} */ (
    typeof metadata === 'object' && !Array.isArray(metadata) ? metadata : {}
  )
  const metaText = (/** @type {string} */ key) => {
    const value = meta[key]
    if (value === undefined || value === null) return ''
    if (typeof value !== 'string') {
      errors.push(`\`metadata.${key}\` has to be text.`)
      return ''
    }
    return value.trim()
  }

  const outputAsked = metaText('inksprite-output')
  if (outputAsked && !OUTPUTS.includes(/** @type {SkillOutput} */ (outputAsked))) {
    errors.push(`\`metadata.inksprite-output\` has to be one of ${OUTPUTS.join(', ')}.`)
  }
  // Where it answers when the file does not say: back to whoever asked, or,
  // for a skill only the writer can call, as the reply — a skill nobody else
  // calls is one they wanted to read.
  const output = /** @type {SkillOutput} */ (
    outputAsked && OUTPUTS.includes(/** @type {SkillOutput} */ (outputAsked))
      ? outputAsked
      : model
        ? 'result'
        : 'reply'
  )

  const voices = metaText('inksprite-speakers').split(/\s+/).filter(Boolean)
  if (voices.length !== 0 && voices.length !== 2) {
    errors.push(
      '`metadata.inksprite-speakers` names two voices: the writer’s, then the other one’s.'
    )
  }
  const speakers = voices.length === 2 ? { user: voices[0], assistant: voices[1] } : null

  const argumentHint = textField('argument-hint')
  const summary = metaText('inksprite-summary') || description
  const argumentDescription = metaText('inksprite-argument') || argumentHint
  const license = textField('license')
  const compatibility = textField('compatibility')

  const body = split.body
  if (!body) errors.push(NEEDS_INSTRUCTIONS)

  if (errors.length > 0) return { errors }

  const ignored = Object.keys(fields).filter(key => !FIELDS.has(key))

  return {
    skill: {
      name,
      description,
      summary,
      model,
      user,
      fork,
      output,
      argument,
      argumentHint,
      argumentDescription,
      tools: /** @type {string[]} */ (tools),
      speakers,
      body,
      ...(license ? { license } : {}),
      ...(compatibility ? { compatibility } : {}),
    },
    ignored,
  }
}

/**
 * Read a skill that ships with the app.
 *
 * One that does not read is a bug in the app rather than a file somebody
 * brought, so it throws, and the module that ships it fails to load where a
 * test will see it.
 *
 * @param {string} text - The SKILL.md
 * @returns {SkillDefinition}
 */
export function readBuiltInSkill(text) {
  const read = parseSkill(text)
  if ('errors' in read) {
    throw new Error(`A built-in skill does not read: ${read.errors.join(' ')}`)
  }
  return read.skill
}

/**
 * What the model is told about a skill whose answer is the reply.
 */
export const HANDS_OVER_REPLY =
  'What it writes is your reply, shown as it is written, and your turn ends there.'

/**
 * The tool the model calls a skill by.
 *
 * Its one argument is its one parameter, required, and described the way the
 * file describes it to the model. A skill with no argument, like the
 * Director, is a tool with no parameters: it reads the turn it is in.
 *
 * One whose answer is the reply says so after its own description, since
 * nothing else would tell the model that calling it ends its turn: a file
 * written for another app describes what the skill does, not what becomes of
 * its answer here.
 *
 * @param {SkillDefinition} skill
 * @returns {ToolDefinition}
 */
export function toolDefinitionFor(skill) {
  const properties = skill.argument
    ? {
        [skill.argument]: {
          type: 'string',
          ...(skill.argumentDescription ? { description: skill.argumentDescription } : {}),
        },
      }
    : {}

  return {
    type: /** @type {const} */ ('function'),
    function: {
      name: skill.name,
      description:
        skill.output === 'reply' ? `${skill.description} ${HANDS_OVER_REPLY}` : skill.description,
      parameters: {
        type: 'object',
        properties,
        ...(skill.argument ? { required: [skill.argument] } : {}),
      },
    },
  }
}
