// Writes latest.json, which the desktop app's updater reads from the latest
// release (app/src-tauri/src/update.rs): for each platform, where its update
// is and the update's signature.
//
//   node .github/scripts/latest-json.mjs <dir> <version> <download-url> <pubkey>
//
// <dir> holds the release's files, each update beside its .sig. Each
// signature is checked against <pubkey>, the key the app trusts
// (tauri.conf.json), and has to be for <version>: Tauri's CLI only warns when
// it signs with another key, and an app refuses an update signed with one.
// Written to <dir>/latest.json.

import { createHash, createPublicKey, verify } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

if (process.argv.length !== 6) fail('usage: latest-json.mjs <dir> <version> <download-url> <pubkey>')
const [dir, version, downloadUrl, pubkey] = process.argv.slice(2)

// The updater looks for its platform with the kind of install it is, then
// without. A Linux app is updated by its own kind, never the other.
const PLATFORMS = [
  { suffix: '_universal.app.tar.gz', keys: ['darwin-aarch64', 'darwin-x86_64'] },
  { suffix: '.AppImage', keys: ['linux-x86_64-appimage'] },
  { suffix: '.deb', keys: ['linux-x86_64-deb'] },
  { suffix: '-setup.exe', keys: ['windows-x86_64'] },
]

// What comes before an Ed25519 key in the DER form Node reads it in.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

const key = publicKey(pubkey)
const files = readdirSync(dir)
const platforms = {}
for (const { suffix, keys } of PLATFORMS) {
  for (const file of files.filter(name => name.endsWith(suffix))) {
    const signature = readFileSync(join(dir, `${file}.sig`), 'utf8').trim()
    check(readFileSync(join(dir, file)), signature, file)
    for (const platform of keys) {
      if (platforms[platform]) fail(`two updates for ${platform}`)
      platforms[platform] = { url: `${downloadUrl}/${encodeURIComponent(file)}`, signature }
    }
  }
}
if (!Object.keys(platforms).length) fail(`no updates in ${dir}`)

const manifest = { version, pub_date: new Date().toISOString(), platforms }
writeFileSync(join(dir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
console.log(`latest.json: ${version} for ${Object.keys(platforms).join(', ')}`)

/**
 * The key from a minisign public key, which Tauri keeps in base64: a comment
 * line, then "Ed", the key's id and the key, in base64 again.
 */
function publicKey(base64) {
  const raw = Buffer.from(lines(base64)[1] || '', 'base64')
  if (raw.length !== 42) fail('the pubkey in tauri.conf.json is not a minisign public key')
  return {
    id: raw.subarray(2, 10),
    key: createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, raw.subarray(10)]),
      format: 'der',
      type: 'spki',
    }),
  }
}

/**
 * Check a minisign signature, in Tauri's base64, of the BLAKE2b hash of the
 * file ("ED"), and the trusted comment signed after it, which names the
 * version.
 */
function check(data, base64, file) {
  const [, line, trusted, global] = lines(base64)
  const raw = Buffer.from(line || '', 'base64')
  if (raw.length !== 74 || raw.subarray(0, 2).toString() !== 'ED') {
    fail(`${file}.sig is not a minisign signature of a hash`)
  }
  if (!raw.subarray(2, 10).equals(key.id)) {
    fail(`${file} is signed with another key than the one in tauri.conf.json`)
  }
  const signature = raw.subarray(10)
  const hash = createHash('blake2b512').update(data).digest()
  if (!verify(null, hash, key.key, signature)) fail(`${file} does not match its signature`)

  const comment = (trusted || '').replace(/^trusted comment: /, '')
  const signed = Buffer.concat([signature, Buffer.from(comment)])
  if (!verify(null, signed, key.key, Buffer.from(global || '', 'base64'))) {
    fail(`${file}'s trusted comment does not match its signature`)
  }
  if (!comment.split('\t').includes(`version:${version}`)) {
    fail(`${file} is signed for another version than ${version}: ${comment}`)
  }
}

function lines(base64) {
  return Buffer.from(base64, 'base64').toString('utf8').split('\n')
}

function fail(message) {
  console.error(`latest-json: ${message}`)
  process.exit(1)
}
