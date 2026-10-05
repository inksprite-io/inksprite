/* global File, performance */
/**
 * @module harness/files
 * @description Run the file importer over a folder and say what it read.
 *
 * For a shelf of real papers, books and saved pages — `harness/research/`,
 * which is gitignored — one line each: what the importer thinks the file is,
 * how long it took to look at, how many pages and words it read out, and the
 * first words, so a PDF that came out as gibberish or a page that came out as
 * its stylesheet shows up here rather than in a chat.
 *
 *   npm run files -- harness/research
 *   npm run files -- harness/research/papers --show 400
 *
 * `--show N` prints the first N characters of each file's text under its
 * line, for looking at the extraction itself.
 *
 * Runs under vite-node so the app's own `inspectFile` is what runs, worker
 * URL import and all. Node has `File`; the DOM the HTML reader wants comes
 * from happy-dom, which the tests use too.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { Window } from 'happy-dom'
import { inspectFile, mimeOf } from '../src/files/inspect.js'

const args = process.argv.slice(2)
const root = args.find(arg => !arg.startsWith('--'))
const showAt = args.indexOf('--show')
const show = showAt >= 0 ? Number(args[showAt + 1]) || 300 : 0

if (!root) {
  console.error('Usage: npm run files -- <folder> [--show N]')
  process.exit(1)
}

// The HTML reader parses with `DOMParser` when there is one. The window has
// an address so a page's relative links resolve to something rather than
// throwing, and fetches nothing it finds in them.
globalThis.DOMParser = new Window({
  url: 'https://localhost/',
  settings: {
    disableJavaScriptFileLoading: true,
    disableJavaScriptEvaluation: true,
    disableCSSFileLoading: true,
    disableComputedStyleRendering: true,
  },
}).DOMParser

/**
 * Every file under a folder, in path order.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const found = []
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...(await filesUnder(path)))
    else found.push(path)
  }
  return found
}

const words = (/** @type {string} */ text) => text.split(/\s+/).filter(Boolean).length
const pad = (/** @type {string|number} */ value, /** @type {number} */ width) =>
  String(value).padStart(width)

const paths = (await stat(root)).isDirectory() ? await filesUnder(root) : [root]
const totals = { files: 0, words: 0, empty: 0, failed: 0, ms: 0 }

for (const path of paths) {
  const name = relative(root, path) || path
  const bytes = await readFile(path)
  const file = new File([bytes], path.split('/').pop() || path, { type: mimeOf(path, '') })
  const started = performance.now()
  try {
    const found = await inspectFile(file)
    const ms = Math.round(performance.now() - started)
    const count = words(found.text)
    totals.files++
    totals.words += count
    totals.ms += ms
    if (count === 0) totals.empty++
    const head = found.text.replace(/\s+/g, ' ').trim().slice(0, 60)
    console.log(
      `${pad(ms, 6)}ms ${pad(Math.round(found.size / 1024), 6)}K ${pad(found.pages ?? '-', 4)}p ${pad(count, 7)}w  ${found.mime.padEnd(28)} ${name}${head ? `\n${' '.repeat(29)}› ${head}` : ''}`
    )
    if (show && found.text) console.log(`\n${found.text.slice(0, show)}\n`)
  } catch (error) {
    totals.failed++
    console.log(`  FAILED ${name}: ${error instanceof Error ? error.message : error}`)
  }
}

console.log(
  `\n${totals.files} files, ${totals.words} words, ${totals.empty} with no text, ${totals.failed} failed, ${Math.round(totals.ms / 1000)}s`
)
