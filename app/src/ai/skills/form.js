/**
 * @module ai/skills/form
 * @description A SKILL.md as the three fields the settings edit, and back.
 *
 * The library keeps a skill as its file, and the file is what is exported, so
 * the fields own a copy of nothing: a name, a description and the
 * instructions are read out of the file and written back into it. Everything
 * else in it stays where it was: who may call it, how it runs, a license, a
 * key another tool invented. Those are changed in the file itself, which the
 * editor opens whole.
 *
 * The name is written as the writer would say it, "Short Story Editor", and
 * the name the skill is called by is made from that: `short-story-editor`.
 * What they wrote is kept beside it, as `metadata.inksprite-title`, where it
 * says more than the name does.
 *
 * A change to the instructions alone leaves the frontmatter exactly as it was
 * written. A change to the name or the description writes the frontmatter
 * afresh, and a comment in it goes.
 */

import { MAX_NAME, joinSkill, splitSkill } from './format.js'

/**
 * What the settings edit of a skill.
 *
 * @typedef {Object} SkillForm
 * @property {string} name - As the writer wrote it: a title, or the name
 *   itself
 * @property {string} description - What it does and when to use it, which
 *   the model reads
 * @property {string} body - Its instructions
 */

/** The frontmatter as it was written, dashes and all, up to the body. */
const FRONT_BLOCK = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/

/**
 * A field as the form shows it: text, or what YAML read a bare word as.
 *
 * @param {unknown} value
 * @returns {string}
 */
const shown = value =>
  typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''

/** Where a file keeps what the writer called its skill. */
const TITLE = 'inksprite-title'

/**
 * What a file's frontmatter says the writer called its skill, when it does.
 *
 * @param {Record<string, unknown>} front
 * @returns {string}
 */
function titleIn(front) {
  const meta = front.metadata
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return ''
  return shown(/** @type {Record<string, unknown>} */ (meta)[TITLE])
}

/**
 * The three fields, from a SKILL.md. A file whose frontmatter cannot be read
 * has none, and says why: it is put right in the file.
 *
 * @param {string} text
 * @returns {{form: SkillForm}|{error: string}}
 */
export function formFromText(text) {
  const split = splitSkill(text)
  if ('error' in split) return split

  return {
    form: {
      name: titleIn(split.front) || shown(split.front.name),
      description: shown(split.front.description),
      body: split.body,
    },
  }
}

/**
 * The name a skill is called by, from what the writer wrote for one:
 * lowercase letters, digits and single hyphens, a letter first. A name
 * written that way already is itself.
 *
 * @param {string} written
 * @returns {string} Nothing when there is no name in it
 */
export function nameFromTitle(written) {
  return (
    (written || '')
      // An accented letter is its letter.
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[\s_]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .replace(/-{2,}/g, '-')
      .replace(/^[^a-z]+/, '')
      .slice(0, MAX_NAME)
      .replace(/-+$/, '')
  )
}

/**
 * The frontmatter with the skill called this, and the rest of it as it was.
 * What was written is kept only where the name does not already say it.
 *
 * @param {Record<string, unknown>} front
 * @param {string} title - Nothing, for a name that says it all
 * @returns {Record<string, unknown>}
 */
function withTitle(front, title) {
  const meta = front.metadata
  const kept =
    meta && typeof meta === 'object' && !Array.isArray(meta)
      ? { .../** @type {Record<string, unknown>} */ (meta) }
      : {}
  delete kept[TITLE]
  if (title) kept[TITLE] = title

  const { metadata: _, ...rest } = front
  return Object.keys(kept).length > 0 ? { ...rest, metadata: kept } : rest
}

/**
 * The SKILL.md with the three fields as given, and the rest of it as it was.
 *
 * @param {SkillForm} form
 * @param {string} [text] - The file as it stands; none for a new skill
 * @returns {string}
 */
export function textFromForm(form, text = '') {
  const split = text ? splitSkill(text) : { front: {}, body: '' }
  const front = 'error' in split ? {} : split.front
  const written = form.name.trim()
  const name = nameFromTitle(written)
  const title = written === name ? '' : written
  const description = form.description.trim()

  // Only the instructions changed: the frontmatter is the writer's own
  // typing, and stays that way.
  const block = FRONT_BLOCK.exec(text)?.[0]
  if (
    block &&
    shown(front.name) === name &&
    titleIn(front) === title &&
    shown(front.description) === description
  ) {
    return `${block.trimEnd()}\n\n${form.body.trim()}\n`
  }

  return joinSkill(withTitle({ ...front, name, description }, title), form.body)
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
