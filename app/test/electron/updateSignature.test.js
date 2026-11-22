// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHash, createPublicKey, generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hashOf, signUpdate, signatureProblem } from '../../electron/src/updateSignature.js'
import { signUpdates } from '../../electron/scripts/sign-updates.js'
import { UPDATE_KEYS } from '../../electron/src/updateKeys.js'

/** A key pair, in PEM, as openssl writes one. */
const pair = (type, options = {}) => {
  const { privateKey, publicKey } = generateKeyPairSync(type, options)
  return {
    private: privateKey.export({ type: type === 'ec' ? 'sec1' : 'pkcs8', format: 'pem' }),
    public: publicKey.export({ type: 'spki', format: 'pem' }),
  }
}

const inUse = pair('ec', { namedCurve: 'prime256v1' })
const spare = pair('ed25519')
const stranger = pair('ed25519')

const update = { version: '0.1.0-dev.30', file: 'inksprite-0.1.0-dev.30-linux-x86_64.AppImage' }
const sha512 = createHash('sha512').update('the update').digest('base64')
const written = (key = inUse.private, of = { ...update, sha512 }) =>
  JSON.stringify(signUpdate(of, key))

describe('an update’s signature', () => {
  const expected = { version: update.version, sha512, keys: [inUse.public, spare.public] }

  it('is taken from either key the app was built with, of either kind', () => {
    expect(signatureProblem(written(inUse.private), expected)).toBeNull()
    expect(signatureProblem(written(spare.private), expected)).toBeNull()
  })

  it('is refused from a key the app doesn’t have', () => {
    expect(signatureProblem(written(stranger.private), expected)).toMatch(/no key/)
    expect(signatureProblem(written(), { ...expected, keys: [] })).toMatch(/no key/)
  })

  it('is refused for another version, so an old update can’t pass for a new one', () => {
    const old = written(inUse.private, { ...update, version: '0.1.0-dev.20', sha512 })
    expect(signatureProblem(old, expected)).toBe('it is for 0.1.0-dev.20, not 0.1.0-dev.30')
  })

  it('is refused for a file that isn’t the one it was made for', () => {
    const other = createHash('sha512').update('another file').digest('base64')
    expect(signatureProblem(written(), { ...expected, sha512: other })).toBe(
      'it is for another file'
    )
  })

  it('is refused once anything it says is changed', () => {
    const changes = [
      { version: '0.1.0-dev.31' },
      { file: 'another.AppImage' },
      { sha512: createHash('sha512').update('x').digest('base64') },
    ]
    for (const change of changes) {
      const changed = { ...JSON.parse(written()), ...change }
      // Asked about as what it now says it is, so only the signature is in the way.
      const claimed = { ...expected, version: changed.version, sha512: changed.sha512 }
      expect(signatureProblem(JSON.stringify(changed), claimed), JSON.stringify(change)).toMatch(
        /no key/
      )
    }
  })

  it('is refused when it is no signature at all, or a key is no key', () => {
    expect(signatureProblem('<html>Not Found</html>', expected)).toBe('it is not a signature')
    expect(signatureProblem('{"version":"0.1.0-dev.30"}', expected)).toBe('it is not a signature')
    expect(signatureProblem('null', expected)).toBe('it is not a signature')
    expect(signatureProblem(written(), { ...expected, keys: ['not a key'] })).toMatch(/no key/)
  })
})

describe('the keys the app is built with', () => {
  it('are two public keys, one in use and a spare, each one a key', () => {
    expect(UPDATE_KEYS).toHaveLength(2)
    expect(new Set(UPDATE_KEYS).size).toBe(2)
    for (const pem of UPDATE_KEYS) {
      expect(createPublicKey(pem).type).toBe('public')
      expect(pem).not.toMatch(/PRIVATE/)
    }
  })
})

describe('signing a build’s updates', () => {
  let folder
  const version = '0.1.0-dev.30'
  const keys = [inUse.public, spare.public]

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'inksprite-sign-'))
    await writeFile(join(folder, 'inksprite-0.1.0-dev.30-linux-x86_64.AppImage'), 'an AppImage')
    await writeFile(join(folder, 'inksprite-0.1.0-dev.30-linux-amd64.deb'), 'a deb')
    await writeFile(join(folder, 'inksprite-0.1.0-dev.30-linux-arm64.AppImage'), 'an ARM AppImage')
    await writeFile(join(folder, 'inksprite-0.1.0-dev.30-linux-arm64.deb'), 'an ARM deb')
    await writeFile(join(folder, 'latest-linux.yml'), 'version: 0.1.0-dev.30')
    await writeFile(join(folder, 'latest-linux-arm64.yml'), 'version: 0.1.0-dev.30')
  })

  afterAll(() => rm(folder, { recursive: true, force: true }))

  const signatures = async () => (await readdir(folder)).filter(name => name.endsWith('.sig'))

  it('signs nothing, and minds nothing, while the app has no keys', async () => {
    expect(await signUpdates(folder, { key: undefined, keys: [], version })).toEqual([])
    expect(await signatures()).toEqual([])
  })

  it('stops a release it can’t sign for an app that looks for a signature', async () => {
    await expect(signUpdates(folder, { key: undefined, keys, version })).rejects.toThrow(
      'UPDATE_SIGNING_KEY is not set'
    )
    await expect(signUpdates(folder, { key: inUse.private, keys: [], version })).rejects.toThrow(
      'lists no public key'
    )
  })

  it('stops a release signed with a key the app wasn’t built with, leaving nothing behind', async () => {
    await expect(signUpdates(folder, { key: stranger.private, keys, version })).rejects.toThrow(
      'private half of a key in src/updateKeys.js'
    )
    expect(await signatures()).toEqual([])
  })

  it('stops a release with nothing in it to sign', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'inksprite-sign-'))
    try {
      await expect(signUpdates(empty, { key: inUse.private, keys, version })).rejects.toThrow(
        'no update to sign'
      )
    } finally {
      await rm(empty, { recursive: true, force: true })
    }
  })

  it('puts beside each update a signature the app takes for it', async () => {
    const signed = await signUpdates(folder, { key: inUse.private, keys, version })

    expect(signed).toEqual([
      'inksprite-0.1.0-dev.30-linux-amd64.deb',
      'inksprite-0.1.0-dev.30-linux-arm64.AppImage',
      'inksprite-0.1.0-dev.30-linux-arm64.deb',
      'inksprite-0.1.0-dev.30-linux-x86_64.AppImage',
    ])
    expect(await signatures()).toEqual(signed.map(name => `${name}.sig`))
    for (const name of signed) {
      const said = await readFile(join(folder, `${name}.sig`), 'utf8')
      expect(JSON.parse(said)).toMatchObject({ version, file: name })
      expect(
        signatureProblem(said, { version, sha512: await hashOf(join(folder, name)), keys })
      ).toBeNull()
    }
  })

  it('hashes a file as the release’s own list does', async () => {
    expect(await hashOf(join(folder, 'latest-linux.yml'))).toBe(
      createHash('sha512').update('version: 0.1.0-dev.30').digest('base64')
    )
  })
})
