/**
 * @module harness/disk
 * @description A codebase on disk as the repository importer takes one.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

/**
 * Every file under a folder, as the browser's folder chooser hands them
 * over: `.git` and `node_modules` included, since the importer's rules are
 * what leave them out.
 *
 * @param {string} root
 * @returns {Promise<import('../src/source/gather.js').SourceEntry[]>}
 */
export async function entriesOnDisk(root) {
  /** @type {import('../src/source/gather.js').SourceEntry[]} */
  const entries = []
  const walk = async (/** @type {string} */ folder) => {
    for (const found of await readdir(folder, { withFileTypes: true })) {
      const full = join(folder, found.name)
      if (found.isDirectory()) await walk(full)
      else if (found.isFile()) {
        entries.push({
          path: relative(root, full).split('\\').join('/'),
          size: (await stat(full)).size,
          read: async () => new Uint8Array(await readFile(full)),
        })
      }
    }
  }
  await walk(root)
  return entries
}
