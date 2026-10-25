/**
 * Fetch the Python packages the sandbox offers (`src/sandbox.js`), and the
 * packages they need, into `python/`: the wheels of the Pyodide release the
 * `pyodide` package is, from its CDN, each checked against the sha256 in that
 * release's lock file. A wheel already there and matching is kept.
 *
 *   node scripts/fetch-python.mjs
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** What the sandbox offers beside the standard library. */
const PACKAGES = ['numpy', 'pandas']

const require = createRequire(import.meta.url)
const { version } = require('pyodide/package.json')
const lock = require('pyodide/pyodide-lock.json')
const folder = fileURLToPath(new URL('../python', import.meta.url))
const base = `https://cdn.jsdelivr.net/pyodide/v${version}/full/`

/**
 * `names` and every package they need, each once.
 *
 * @param {string[]} names
 * @returns {string[]}
 */
function withDependencies(names) {
  const found = new Set()
  const visit = (/** @type {string} */ name) => {
    if (found.has(name)) return
    if (!lock.packages[name]) throw new Error(`Pyodide ${version} has no package ${name}.`)
    found.add(name)
    lock.packages[name].depends.forEach(visit)
  }
  names.forEach(visit)
  return [...found]
}

/** @param {Uint8Array} bytes */
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

await mkdir(folder, { recursive: true })
for (const name of withDependencies(PACKAGES)) {
  const { file_name: file, sha256: expected } = lock.packages[name]
  const target = path.join(folder, file)
  const kept = await readFile(target).catch(() => null)
  if (kept && sha256(kept) === expected) continue
  const response = await fetch(base + file)
  if (!response.ok) throw new Error(`${file}: ${response.status} from ${base}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (sha256(bytes) !== expected) throw new Error(`${file} doesn't match Pyodide's lock file.`)
  await writeFile(target, bytes)
  console.log(`${file} (${Math.round(bytes.length / 1024)} KB)`)
}
