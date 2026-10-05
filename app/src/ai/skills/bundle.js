/* global Blob */
/**
 * @module ai/skills/bundle
 * @description Skills in and out of files: a skills folder, a `.zip` of one, a
 * lone SKILL.md, and back again.
 *
 * A skill is a folder: its SKILL.md, and whatever else is in the folder with
 * it — references, examples, templates. What comes in is searched for every
 * SKILL.md in it, so a writer can hand over a whole skills folder, or the
 * `.zip` claude.ai takes and GitHub serves, and each skill comes with the files
 * in its own folder. A Markdown file with frontmatter that is in no skill's
 * folder is a skill on its own, the way a Claude Code command is: one file,
 * named for what it does.
 *
 * Only text comes along. `scripts/` is left behind, because nothing in the page
 * can run it, and so is anything that does not read as text or is too big to
 * be instructions. Each is named in what is left behind, so the writer knows.
 *
 * What goes out is a `.zip` with each skill in a folder of its name, SKILL.md
 * and all, which is the shape every tool that reads skills expects.
 */

import { strToU8, unzipSync, zipSync } from 'fflate'
import { joinSkill, splitSkill } from './format.js'

/** @typedef {import('../../types/models.js').SkillFile} SkillFile */

/**
 * A file in what was handed over, by where it was.
 *
 * @typedef {Object} BundleEntry
 * @property {string} path - Folders separated by `/`
 * @property {Uint8Array} bytes
 */

/**
 * A skill found in what was handed over.
 *
 * @typedef {Object} FoundSkill
 * @property {string} path - Where its SKILL.md, or its one file, was
 * @property {string} text - The SKILL.md
 * @property {SkillFile[]} files - The text in its folder, by where it sits in it
 * @property {string[]} dropped - What in its folder was left behind, and why
 */

/** The largest file that comes along: instructions, not a library. */
export const MAX_FILE_BYTES = 1024 * 1024

/**
 * Whether a path is something no skill is made of: a hidden file, a
 * version-control folder, the macOS resource forks a zip made there carries.
 *
 * @param {string} path
 * @returns {boolean}
 */
function isNoise(path) {
  return path
    .split('/')
    .some(part => part.startsWith('.') || part === '__MACOSX' || part === 'node_modules')
}

/** @param {string} path */
const folderOf = path => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')

/** @param {string} path */
const nameOf = path => path.slice(path.lastIndexOf('/') + 1)

/**
 * @param {Uint8Array} bytes
 * @returns {string|null} The text, or null when it is not UTF-8
 */
function textOf(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * The files in a `.zip`.
 *
 * @param {Uint8Array} bytes
 * @returns {BundleEntry[]}
 */
export function entriesFromZip(bytes) {
  return Object.entries(unzipSync(bytes))
    .filter(([path]) => !path.endsWith('/'))
    .map(([path, data]) => ({ path, bytes: data }))
}

/**
 * The files the writer chose: loose files, a folder's worth, or `.zip`s, whose
 * contents are read in place of them.
 *
 * @param {Iterable<File>} chosen
 * @returns {Promise<BundleEntry[]>}
 */
export async function entriesFromFiles(chosen) {
  /** @type {BundleEntry[]} */
  const entries = []
  for (const file of chosen) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (/\.zip$/i.test(file.name)) {
      entries.push(...entriesFromZip(bytes))
    } else {
      const path = /** @type {any} */ (file).webkitRelativePath || file.name
      entries.push({ path, bytes })
    }
  }
  return entries
}

/**
 * A lone file's text with its name in its frontmatter, taken from the file's
 * own name when the frontmatter has none: a Claude Code command is named for
 * its file. Left as it is when it already has one, or has no frontmatter to
 * put one in.
 *
 * @param {string} text
 * @param {string} path
 * @returns {string}
 */
function namedAfterFile(text, path) {
  const split = splitSkill(text)
  if ('error' in split || split.front.name) return text
  const name = nameOf(path)
    .replace(/\.md$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return name ? joinSkill({ name, ...split.front }, split.body) : text
}

/**
 * Every skill in what was handed over.
 *
 * Each SKILL.md is a skill, and every file in its folder is its — the deepest
 * such folder's, when one skill sits inside another's. A Markdown file with
 * frontmatter in no skill's folder is a skill of its own. Anything else in no
 * skill's folder is not part of one, and is named in `stray`.
 *
 * @param {BundleEntry[]} entries
 * @returns {{skills: FoundSkill[], stray: string[]}}
 */
export function findSkills(entries) {
  const files = entries
    .map(entry => ({ ...entry, path: entry.path.replace(/\\/g, '/').replace(/^\/+/, '') }))
    .filter(entry => !isNoise(entry.path))

  const folders = files
    .filter(entry => nameOf(entry.path).toLowerCase() === 'skill.md')
    .map(entry => folderOf(entry.path))

  /** @param {string} path - The skill folder a file is in, deepest first, or null */
  const ownerOf = path => {
    let owner = null
    for (const folder of folders) {
      const inside = folder === '' || path.startsWith(`${folder}/`)
      if (inside && (owner === null || folder.length > owner.length)) owner = folder
    }
    return owner
  }

  /** @type {Map<string, FoundSkill>} */
  const found = new Map()
  /** @type {string[]} */
  const stray = []

  for (const entry of files) {
    const owner = ownerOf(entry.path)

    if (owner === null) {
      const text = /\.md$/i.test(entry.path) ? textOf(entry.bytes) : null
      if (text !== null && !('error' in splitSkill(text))) {
        found.set(entry.path, {
          path: entry.path,
          text: namedAfterFile(text, entry.path),
          files: [],
          dropped: [],
        })
      } else {
        stray.push(entry.path)
      }
      continue
    }

    const skill = found.get(owner) || { path: '', text: '', files: [], dropped: [] }
    found.set(owner, skill)
    const inFolder = owner === '' ? entry.path : entry.path.slice(owner.length + 1)

    if (inFolder.toLowerCase() === 'skill.md') {
      skill.path = entry.path
      skill.text = textOf(entry.bytes) ?? ''
      continue
    }
    if (inFolder.startsWith('scripts/')) {
      skill.dropped.push(`${inFolder}: scripts can’t run here`)
      continue
    }
    if (entry.bytes.length > MAX_FILE_BYTES) {
      skill.dropped.push(`${inFolder}: too big`)
      continue
    }
    const content = textOf(entry.bytes)
    if (content === null) {
      skill.dropped.push(`${inFolder}: not text`)
      continue
    }
    skill.files.push({ path: inFolder, content })
  }

  return { skills: [...found.values()], stray }
}

/**
 * Skills as a `.zip`: each in a folder of its name, with its SKILL.md and the
 * files that came with it.
 *
 * @param {Array<{name: string, text: string, files?: SkillFile[]}>} skills
 * @returns {Uint8Array}
 */
export function zipSkills(skills) {
  /** @type {Record<string, Uint8Array>} */
  const contents = {}
  for (const skill of skills) {
    contents[`${skill.name}/SKILL.md`] = strToU8(skill.text)
    for (const file of skill.files || []) {
      contents[`${skill.name}/${file.path}`] = strToU8(file.content)
    }
  }
  return zipSync(contents)
}

/**
 * Skills as a `.zip` to hand the browser to save. See `zipSkills`.
 *
 * @param {Array<{name: string, text: string, files?: SkillFile[]}>} skills
 * @returns {Blob}
 */
export function zipBlob(skills) {
  // fflate's bytes are typed as possibly shared memory, which a Blob will not
  // take; what it makes is an ordinary buffer.
  const bytes = /** @type {Uint8Array<ArrayBuffer>} */ (zipSkills(skills))
  return new Blob([bytes], { type: 'application/zip' })
}
