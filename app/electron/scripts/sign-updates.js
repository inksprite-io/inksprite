/**
 * Signs the updates a build made, for the app to check before it installs
 * one (`src/updateSignature.js`). Run by the release workflow on Windows and
 * Linux, after electron-builder:
 *
 *   UPDATE_SIGNING_KEY=<the private key, in PEM> node scripts/sign-updates.js [dist]
 *
 * Each update gets a `<file>.sig` beside it, which goes into the release with
 * it. Every signature is checked as the app will check it, with the public
 * keys the app is built with, so a key that doesn't belong to one of them
 * stops the release here rather than leaving every app unable to update.
 *
 * With no key given and none in `src/updateKeys.js`, nothing is signed and
 * nothing is wrong: the app doesn't look for a signature yet.
 */

import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { UPDATE_KEYS } from '../src/updateKeys.js'
import { hashOf, signUpdate, signatureProblem } from '../src/updateSignature.js'

/** The files the updater installs: the Windows installer, the AppImage and the .deb. */
const UPDATES = /\.(exe|AppImage|deb)$/

/**
 * Sign every update in a folder.
 *
 * @param {string} folder - Where electron-builder left them
 * @param {object} with_
 * @param {string|undefined} with_.key - The private key, in PEM
 * @param {string[]} with_.keys - The public keys the app is built with
 * @param {string} with_.version - The app's
 * @returns {Promise<string[]>} The files signed, by name
 * @throws {Error} When the app looks for a signature and none can be made
 *   that it would take
 */
export async function signUpdates(folder, { key, keys, version }) {
  if (!key && keys.length === 0) return []
  if (!key) {
    throw new Error(
      'This app checks its updates against a signature, and UPDATE_SIGNING_KEY is not set.'
    )
  }
  if (keys.length === 0) {
    throw new Error('UPDATE_SIGNING_KEY is set, but src/updateKeys.js lists no public key.')
  }
  const files = (await readdir(folder)).filter(name => UPDATES.test(name)).sort()
  if (files.length === 0) throw new Error(`There is no update to sign in ${folder}.`)

  for (const file of files) {
    const sha512 = await hashOf(join(folder, file))
    const written = `${JSON.stringify(signUpdate({ version, file, sha512 }, key), null, 2)}\n`
    const problem = signatureProblem(written, { version, sha512, keys })
    if (problem) {
      throw new Error(
        `The app would not take ${file}: ${problem}. UPDATE_SIGNING_KEY has to be the private half of a key in src/updateKeys.js.`
      )
    }
    await writeFile(join(folder, `${file}.sig`), written)
  }
  return files
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = fileURLToPath(new URL('../package.json', import.meta.url))
  const { version } = JSON.parse(await readFile(manifest, 'utf8'))
  try {
    const signed = await signUpdates(process.argv[2] ?? 'dist', {
      key: process.env.UPDATE_SIGNING_KEY || undefined,
      keys: UPDATE_KEYS,
      version,
    })
    console.log(
      signed.length > 0 ? `Signed ${signed.join(', ')}` : 'No update keys yet: nothing signed.'
    )
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
