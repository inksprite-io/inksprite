/* global performance */
/**
 * @module harness/source
 * @description Run the repository importer's reading over a codebase and say
 * what would come in, without writing anything.
 *
 * A folder on disk is listed the way the browser's folder chooser lists one,
 * every file under it, and goes through the same rules: the lists, the
 * `.gitignore` files, the binary check, the caps. A GitHub address is
 * downloaded as the desktop app downloads it, which Node can do because it
 * has no page origin for GitHub to refuse.
 *
 *   npm run source -- ..
 *   npm run source -- https://github.com/owner/repo
 *   npm run source -- https://github.com/owner/repo/tree/main/packages/core --token "$TOKEN"
 *   npm run source -- .. --left
 *
 * `--left` lists every file left out as binary or too large, by name.
 */

import { basename, resolve } from 'node:path'
import { entriesOnDisk } from './disk.js'
import { gatherSource } from '../src/source/gather.js'
import { downloadArchive, parseGitHubUrl, readArchive } from '../src/source/github.js'
import { languageOf } from '../src/source/language.js'
import { lineCount } from '../src/source/text.js'

const args = process.argv.slice(2)
const target = args.find(arg => !arg.startsWith('--') && args[args.indexOf(arg) - 1] !== '--token')
const tokenAt = args.indexOf('--token')
const token = tokenAt >= 0 ? args[tokenAt + 1] : undefined
const showLeft = args.includes('--left')

if (!target) {
  console.error('Usage: npm run source -- <folder | GitHub URL> [--token T] [--left]')
  process.exit(1)
}

const started = performance.now()
let name
let gathered
let listedCount = 0
let commit = ''

const address = /github\.com|^[\w.-]+\/[\w.-]+$/.test(target) ? parseGitHubUrl(target) : null
if (address) {
  name = `${address.owner}/${address.repo}`
  const download = await downloadArchive(address, { token })
  const downloaded = performance.now()
  console.log(
    `Downloaded ${(download.bytes.length / (1024 * 1024)).toFixed(1)} MB` +
      `${download.ref ? ` at ${download.ref}` : ''}${download.subpath ? `, folder ${download.subpath}` : ''}` +
      ` in ${((downloaded - started) / 1000).toFixed(1)} s`
  )
  const read = await readArchive(download.bytes, { subpath: download.subpath })
  commit = read.commit
  gathered = read.gathered
} else {
  const root = resolve(target)
  name = basename(root)
  const entries = await entriesOnDisk(root)
  listedCount = entries.length
  gathered = await gatherSource(entries)
}

const seconds = ((performance.now() - started) / 1000).toFixed(1)
const { files, left, bytes } = gathered

/** @type {Map<string, {files: number, lines: number}>} */
const byLanguage = new Map()
let lines = 0
for (const file of files) {
  const language = languageOf(basename(file.path)).language
  const count = lineCount(file.text)
  lines += count
  const entry = byLanguage.get(language) || { files: 0, lines: 0 }
  entry.files++
  entry.lines += count
  byLanguage.set(language, entry)
}

console.log(`${name}${commit ? ` at ${commit}` : ''}: ${seconds} s`)
if (listedCount) console.log(`  listed      ${listedCount.toLocaleString('en-US')} files`)
console.log(
  `  in          ${files.length.toLocaleString('en-US')} files, ${lines.toLocaleString('en-US')} lines, ${(bytes / (1024 * 1024)).toFixed(2)} MB`
)
console.log(`  never       ${left.never.toLocaleString('en-US')}`)
console.log(`  ignored     ${left.ignored.toLocaleString('en-US')}`)
console.log(`  not text    ${left.binary.length.toLocaleString('en-US')}`)
console.log(`  too large   ${left.large.length.toLocaleString('en-US')}`)
console.log('')
for (const [language, entry] of [...byLanguage].sort((a, b) => b[1].lines - a[1].lines)) {
  console.log(
    `  ${language.padEnd(18)} ${String(entry.files).padStart(6)} files ${entry.lines.toLocaleString('en-US').padStart(10)} lines`
  )
}
if (showLeft) {
  console.log('')
  for (const path of left.binary) console.log(`  not text   ${path}`)
  for (const path of left.large) console.log(`  too large  ${path}`)
}
