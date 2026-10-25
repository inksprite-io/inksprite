/* global Blob, performance */
/**
 * @module harness/scrivener
 * @description Run the Scrivener import over a project on disk and print the
 * tree it makes.
 *
 *   npm run scrivener -- harness/test-scriv/Novel.scriv
 *   npm run scrivener -- ~/Backups/Novel.zip --show "Chapter One"
 *
 * The project is written into a database in memory, as the app would write
 * it, so nothing is kept. Each line is a document as the tree shows it, with
 * its word count, to set beside Scrivener's binder. `--show <title>` prints
 * the markdown of every document with that title under its line.
 *
 * A `.scriv` folder is read as a dropped one is, and a zip as one chosen
 * under Projects › Import project….
 */

import './environment.js'
import { readdir, readFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { packageOfZip } from '../src/scrivener/package.js'
import { openProject, writeProject } from '../src/scrivener/project.js'
import { useStoriesStore } from '../src/stores/storiesStore.js'
import { useDocuments } from '../src/composables/useDocuments.js'
import { rootIdFor } from '../src/stores/migrations/projectTree.js'

const args = process.argv.slice(2)
const showAt = args.indexOf('--show')
const show = showAt >= 0 ? args[showAt + 1] : null
const target = args.find((arg, i) => !arg.startsWith('--') && (showAt < 0 || i !== showAt + 1))

if (!target) {
  console.error('Usage: npm run scrivener -- <project.scriv | project.zip> [--show <title>]')
  process.exit(1)
}

/**
 * A `.scriv` folder's files by their path inside it.
 *
 * @param {string} root
 * @returns {Promise<import('../src/scrivener/package.js').ScrivenerPackage>}
 */
async function packageOnDisk(root) {
  /** @type {Map<string, Blob>} */
  const files = new Map()
  const walk = async (/** @type {string} */ folder) => {
    for (const found of await readdir(folder, { withFileTypes: true })) {
      const full = join(folder, found.name)
      if (found.isDirectory()) await walk(full)
      else if (found.isFile()) {
        files.set(relative(root, full).split('\\').join('/'), new Blob([await readFile(full)]))
      }
    }
  }
  await walk(root)
  return { name: basename(root).replace(/\.scriv$/i, ''), files }
}

const path = resolve(target)
const started = performance.now()
const pack = /\.zip$/i.test(path)
  ? await packageOfZip(new Blob([await readFile(path)]))
  : await packageOnDisk(path)
if (!pack) {
  console.error('There is no Scrivener project in it.')
  process.exit(1)
}

const project = await openProject(pack)
const story = await useStoriesStore().createStory(project.name)
const result = await writeProject(story.id, project)
const seconds = ((performance.now() - started) / 1000).toFixed(1)

const api = useDocuments(story.id)
let words = 0
/**
 * @param {string} parentId
 * @param {number} depth
 */
const print = (parentId, depth) => {
  for (const document of api.childrenOf(parentId)) {
    const indent = '  '.repeat(depth)
    if (document.type === 'folder') {
      console.log(`${indent}${document.title}/`)
      print(document.id, depth + 1)
      continue
    }
    words += document.wordCount || 0
    const kind = document.type === 'file' ? ` (${document.mime})` : ''
    console.log(`${indent}${document.title}${kind}  ${document.wordCount || 0}`)
    if (show !== null && document.title === show) {
      console.log(
        `${indent}  ┌\n${(document.content || '')
          .split('\n')
          .map(line => `${indent}  │ ${line}`)
          .join('\n')}\n${indent}  └`
      )
    }
    // What a document holds.
    print(document.id, depth + 1)
  }
}
print(rootIdFor(story.id), 0)

console.log(
  `\n${project.name}: ${result.documents} documents, ${result.folders} folders, ` +
    `${words.toLocaleString()} words, in ${seconds} s` +
    (result.scans ? `; ${result.scans} PDFs with no text` : '')
)

process.exit(0)
