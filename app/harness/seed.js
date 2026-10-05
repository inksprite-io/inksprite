/**
 * @module harness/seed
 * @description A project from a fixture folder, built through the stores the
 * app builds one with, so every row is the shape the app would have written.
 *
 * A fixture is a folder holding `project.json` and the documents it names:
 *
 *     {
 *       "title": "Heat Wave",
 *       "summary": "What the story is about, for the root document",
 *       "documents": [
 *         { "path": "Characters/Noah", "file": "noah.md", "summary": "..." },
 *         { "path": "Characters/Riley", "card": "../../cards/Riley.json", "userName": "Noah",
 *           "hidden": ["greeting"] },
 *         { "path": "Chapters", "folder": true, "ordered": true }
 *       ]
 *     }
 *
 * Folders on a path are created as they are met, unordered unless the fixture
 * lists them. A character card goes through the app's own importer and lands
 * as the folder of documents an import leaves — description, examples,
 * greetings, the hidden rules and sidecar — under the last segment of its path.
 * Each call builds a new story, so runs never see each other's edits.
 *
 * Skills are seeded apart from the project, since the library is app-wide:
 * `seedSkills` puts skill folders into it, each a SKILL.md and whatever files
 * sit beside it, the way an import of a skills folder would.
 */

import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { useStoriesStore } from '@/stores/storiesStore.js'
import { useDocumentsStore } from '@/stores/documentsStore.js'
import { useSyncStore } from '@/stores/syncStore.js'
import { useSkillStore } from '@/stores/skillStore.js'
import { parseSkill } from '@/ai/skills/format.js'
import { getSkill } from '@/ai/skills/index.js'
import { cardFromPng } from '@/cards/png.js'
import { readCard, shapeOf } from '@/cards/card.js'
import { writeCard } from '@/cards/write.js'

/**
 * @typedef {Object} FixtureDocument
 * @property {string} path - Where it goes, folders separated by `/`
 * @property {string} [file] - Markdown file beside project.json holding the content
 * @property {string} [content] - The content inline, when there is no file
 * @property {string} [summary]
 * @property {boolean} [folder] - A folder rather than a text document
 * @property {boolean} [ordered] - Folders only: children keep their order
 * @property {string} [card] - A character card, PNG or JSON, relative to project.json;
 *   imported as the app imports one, into a folder titled by the path's last segment
 * @property {string} [userName] - Cards only: what `{{user}}` becomes; "You" otherwise,
 *   which is the app's default too
 * @property {string[]} [hidden] - Cards only: kinds of the card's documents to hide from
 *   the model, the way a writer hides one in the tree — `greeting`, say, which is an
 *   opening for a chat rather than a note about the character
 *
 * @typedef {Object} Fixture
 * @property {string} title
 * @property {string} [summary]
 * @property {FixtureDocument[]} [documents]
 */

/**
 * Build the fixture's project and flush it to the database.
 *
 * @param {string} fixtureDir - Folder holding project.json
 * @returns {Promise<{storyId: string, title: string, documents: number}>}
 */
export async function seedProject(fixtureDir) {
  /** @type {Fixture} */
  const spec = JSON.parse(await readFile(join(fixtureDir, 'project.json'), 'utf8'))
  const stories = useStoriesStore()
  const documents = useDocumentsStore()

  const story = await stories.createStory(spec.title)
  const root = documents.getRoot(story.id)
  if (!root) throw new Error(`No root document for ${story.id}`)
  if (spec.summary) documents.updateDocument(root.id, { summary: spec.summary })

  /** @type {Map<string, string>} path → document id */
  const byPath = new Map()

  /**
   * The folder at a path, created along with any missing parents.
   * @param {string} path
   * @param {boolean} [ordered]
   * @returns {string} Its id
   */
  const folderAt = (path, ordered = false) => {
    if (!path) return root.id
    const known = byPath.get(path)
    if (known) {
      if (ordered) documents.updateDocument(known, { ordered: true })
      return known
    }
    const parts = path.split('/')
    const title = parts.pop() || ''
    const parentId = folderAt(parts.join('/'))
    const folder = documents.createDocument({
      storyId: story.id,
      parentId,
      type: 'folder',
      title,
      ordered,
    })
    byPath.set(path, folder.id)
    return folder.id
  }

  let count = 0
  for (const entry of spec.documents || []) {
    if (entry.folder) {
      folderAt(entry.path, entry.ordered === true)
      continue
    }
    const parts = entry.path.split('/')
    const title = parts.pop() || ''
    const parentId = folderAt(parts.join('/'))
    if (entry.card) {
      const written = await seedCard(story.id, parentId, title, entry, fixtureDir)
      for (const child of documents.getChildrenOrdered(written.folderId)) {
        if (entry.hidden?.includes(child.kind)) documents.updateDocument(child.id, { hidden: true })
      }
      byPath.set(entry.path, written.folderId)
      count += written.documents
      continue
    }
    const content = entry.file
      ? await readFile(join(fixtureDir, entry.file), 'utf8')
      : entry.content || ''
    const document = documents.createDocument({
      storyId: story.id,
      parentId,
      type: 'text',
      title,
      content: content.trim(),
    })
    if (entry.summary) documents.updateDocument(document.id, { summary: entry.summary })
    byPath.set(entry.path, document.id)
    count++
  }

  await useSyncStore().processSync()
  return { storyId: story.id, title: spec.title, documents: count }
}

/**
 * A character card, imported the way the app imports one.
 *
 * The folder takes the fixture's title rather than the card's, which is what a
 * writer renaming the folder after an import would get; the card's own name
 * still stands in for `{{char}}` in its text, and in the sidecar.
 *
 * @param {string} storyId
 * @param {string} parentId - The folder the card goes in
 * @param {string} title - What to call the card's folder
 * @param {FixtureDocument} entry
 * @param {string} fixtureDir
 * @returns {Promise<import('@/cards/write.js').Written>}
 */
async function seedCard(storyId, parentId, title, entry, fixtureDir) {
  const file = resolve(fixtureDir, entry.card || '')
  const bytes = await readFile(file)
  const value = file.endsWith('.png') ? cardFromPng(bytes) : JSON.parse(bytes.toString('utf8'))
  if (shapeOf(value) !== 'card') throw new Error(`${file} is not a character card`)
  const card = { ...readCard(value), title }
  return writeCard(storyId, card, { parentId, userName: entry.userName })
}

/**
 * Put skill folders into the writer's library, through the store the Skills
 * settings save with, so the model is offered them as it would be in the app.
 *
 * Each folder holds a SKILL.md; every other file under it, at any depth, comes
 * along by its path in the folder (`references/voice.md`), which is how an
 * imported skill keeps its files. The library is app-wide, so this runs once,
 * before the first run, and every run's chat sees the same skills.
 *
 * A file the parser refuses, or a name a built-in has, would be left out of
 * the registry without a word — which is what the app does with one, and the
 * wrong thing for an experiment — so either stops the batch here.
 *
 * @param {string[]} dirs - Skill folders
 * @returns {Promise<Array<{name: string, files: string[]}>>} What went in
 */
export async function seedSkills(dirs) {
  const store = useSkillStore()
  await store.ensureInitialized()
  const seeded = []
  for (const dir of dirs) {
    const text = await readFile(join(dir, 'SKILL.md'), 'utf8')
    const read = parseSkill(text)
    if ('errors' in read) throw new Error(`${dir}/SKILL.md does not read: ${read.errors.join(' ')}`)
    const name = read.skill.name
    if (getSkill(name)?.builtIn) throw new Error(`${dir}: "${name}" is a built-in skill's name`)

    const files = []
    for (const path of await filesUnder(dir)) {
      const inFolder = relative(dir, path).split('\\').join('/')
      if (inFolder === 'SKILL.md') continue
      files.push({ path: inFolder, content: await readFile(path, 'utf8') })
    }
    store.createSkill({ name, text, files })
    if (!getSkill(name)) throw new Error(`${dir}: "${name}" did not reach the registry`)
    seeded.push({ name, files: files.map(file => file.path) })
  }
  await useSyncStore().processSync()
  return seeded
}

/**
 * Every file under a folder, sorted.
 *
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function filesUnder(dir) {
  const found = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await filesUnder(path)))
    else if (entry.isFile()) found.push(path)
  }
  return found.sort()
}
