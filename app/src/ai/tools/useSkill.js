/**
 * @module ai/tools/useSkill
 * @description `use_skill`: how the model loads a skill into its own
 * conversation.
 *
 * A skill that joins the conversation is instructions for a kind of work —
 * a house style, a way of giving notes — rather than a model call that answers.
 * The model gets one tool for all of them, with the skills it may load listed
 * in its description a line each, the way Agent Skills are offered elsewhere:
 * a line per skill costs less than a tool per skill, and none of them has an
 * argument to fill in. The skills that run on their own stay tools of their
 * own, each with its parameter (see ../skills/index.js).
 *
 * What it answers stays where it was asked for. The context builder sends the
 * call back at that point on every request, and carries it under a summary
 * when one stands in for the turn that made it (see ../skills/loads.js), so the
 * instructions are followed from then on without being sent twice.
 *
 * A skill can come with files — references, examples, templates — which its
 * instructions point to. `file` reads one of them, once the skill is loaded
 * and says which.
 */

import { getSkill, allSkills } from '../skills/index.js'
import { fillArgument, loadedByModel } from '../skills/runner.js'
import { USE_SKILL } from '../skills/loads.js'

/**
 * @typedef {import('./registry.js').ToolContext} ToolContext
 * @typedef {import('./registry.js').ToolDefinition} ToolDefinition
 * @typedef {import('../skills/index.js').Skill} Skill
 */

export { USE_SKILL }

/**
 * The skills the model may load, as the registry has them now.
 *
 * @returns {Skill[]}
 */
export function loadableSkills() {
  return allSkills().filter(loadedByModel)
}

/**
 * The tool, offering these skills.
 *
 * @param {Skill[]} skills - The ones it may load here
 * @returns {ToolDefinition}
 */
export function useSkillDefinition(skills) {
  const listed = skills.map(skill => `- ${skill.name}: ${skill.description}`)
  return {
    type: /** @type {const} */ ('function'),
    function: {
      name: USE_SKILL,
      description: [
        'Load a skill: instructions for a kind of work, which join this conversation and are followed from then on. Load one when the work in front of you is what it is for. A skill stays loaded, so load each one once.',
        '',
        'Skills:',
        ...listed,
      ].join('\n'),
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            enum: skills.map(skill => skill.name),
            description: 'The skill to load',
          },
          file: {
            type: 'string',
            description:
              'One of the skill’s files, by the path its instructions give, to read instead of loading the skill',
          },
        },
        required: ['name'],
      },
    },
  }
}

/**
 * A path as a skill's instructions might write it, as its files are kept:
 * relative to the skill's folder, with nothing in front.
 *
 * @param {string} path
 * @returns {string}
 */
function inFolder(path) {
  return path.trim().replace(/^(\.\/|\/)+/, '')
}

/**
 * The skill the model loads that a path is one of the files of, when it is
 * one: a path a skill's instructions give, asked for as a document.
 *
 * @param {string} path
 * @returns {string|null} The skill's name
 */
export function skillWithFile(path) {
  if (typeof path !== 'string' || !path.trim()) return null
  const asked = inFolder(path)
  const owner = loadableSkills().find(skill =>
    (skill.files || []).some(file => inFolder(file.path) === asked)
  )
  return owner?.name || null
}

/**
 * @param {{name?: string, file?: string}} args
 * @param {ToolContext} [context]
 * @returns {Promise<Object>}
 */
export async function executeUseSkill(args, context = {}) {
  const name = typeof args?.name === 'string' ? args.name.trim() : ''
  const skill = name ? getSkill(name) : undefined
  if (!skill || !loadedByModel(skill)) {
    return { error: `There is no skill called "${name}" to load.` }
  }

  const files = skill.files || []
  const asked = typeof args?.file === 'string' ? inFolder(args.file) : ''
  if (asked) {
    const file = files.find(one => inFolder(one.path) === asked)
    if (!file) {
      return {
        error: files.length
          ? `${name} has no file "${asked}". Its files: ${files.map(one => one.path).join(', ')}.`
          : `${name} has no files.`,
      }
    }
    return { name, file: file.path, content: file.content }
  }

  if (context.loadedSkills?.().includes(name)) {
    return { name, loaded: 'Already loaded earlier in this conversation. Follow it from there.' }
  }

  // How to read the files goes with the list. Told only that a skill had
  // files, GLM 5.2 went looking for one with read_document, which knows the
  // project and not the skill.
  const base = context.promptFor?.(name) || skill.body
  return {
    name,
    instructions: fillArgument(base, skill.argument, ''),
    ...(files.length
      ? {
          files: files.map(one => one.path),
          reading: `These are the skill’s files, not documents in the project. Read one with use_skill(name: "${name}", file: "<path>").`,
        }
      : {}),
  }
}
