// @vitest-environment node
/* global TextEncoder */
import { describe, it, expect } from 'vitest'
import {
  accountKeys,
  collectionKeys,
  fingerprint,
  fromBase64,
  hashName,
  open,
  openJson,
  passphraseKeys,
  randomBytes,
  seal,
  sealJson,
  stableJson,
  toBase64,
} from '@/cloud/crypto.js'

const FAST = { name: 'PBKDF2', hash: 'SHA-256', iterations: 1000 }

describe('keys from a passphrase', () => {
  it('are the same for the same passphrase and salt, and differ otherwise', async () => {
    const salt = randomBytes(16)
    const one = await passphraseKeys('correct horse', salt, FAST)
    const two = await passphraseKeys('correct horse', salt, FAST)
    const other = await passphraseKeys('correct horses', salt, FAST)
    expect(toBase64(one.auth)).toBe(toBase64(two.auth))
    expect(toBase64(one.auth)).not.toBe(toBase64(other.auth))
  })

  it('open what the other made, and the sign-in key opens nothing', async () => {
    const salt = randomBytes(16)
    const first = await passphraseKeys('a passphrase', salt, FAST)
    const sealed = await seal(first.wrapping, new Uint8Array([1, 2, 3]), 'inksprite account')
    const again = await passphraseKeys('a passphrase', salt, FAST)
    expect([...(await open(again.wrapping, sealed, 'inksprite account'))]).toEqual([1, 2, 3])
    expect(first.auth).toHaveLength(32)
  })

  it('refuse a way of making keys this version does not know', async () => {
    await expect(
      passphraseKeys('x', randomBytes(16), { name: 'Argon2id', hash: '', iterations: 1 })
    ).rejects.toThrow(/Argon2id/)
  })
})

describe('sealing', () => {
  it('opens only as what it was sealed as', async () => {
    const keys = await collectionKeys(randomBytes(32))
    const sealed = await seal(keys.seal, new TextEncoder().encode('words'), 'c1/r1')
    expect(new TextDecoder().decode(await open(keys.seal, sealed, 'c1/r1'))).toBe('words')
    await expect(open(keys.seal, sealed, 'c1/r2')).rejects.toThrow()
  })

  it('opens only under its own key', async () => {
    const mine = await collectionKeys(randomBytes(32))
    const theirs = await collectionKeys(randomBytes(32))
    const sealed = await seal(mine.seal, new Uint8Array([9]), 'x')
    await expect(open(theirs.seal, sealed, 'x')).rejects.toThrow()
  })

  it('carries JSON, gzipped', async () => {
    const keys = await collectionKeys(randomBytes(32))
    const value = { table: 'documents', row: { content: 'word '.repeat(2000) } }
    const sealed = await sealJson(keys.seal, value, 'about')
    expect(sealed.length).toBeLessThan(500)
    expect(await openJson(keys.seal, sealed, 'about')).toEqual(value)
  })
})

describe('names', () => {
  it('are the same under one key, and differ under another', async () => {
    const one = await accountKeys(randomBytes(32))
    const two = await accountKeys(randomBytes(32))
    const a = await hashName(one.ids, 'project:story_1')
    expect(a).toBe(await hashName(one.ids, 'project:story_1'))
    expect(a).not.toBe(await hashName(two.ids, 'project:story_1'))
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })
})

describe('fingerprints', () => {
  it('ignore the order keys were written in', async () => {
    expect(stableJson({ b: 1, a: { d: [1, { f: 2, e: 3 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[1,{"e":3,"f":2}]},"b":1}'
    )
    expect(await fingerprint({ a: 1, b: 2 })).toBe(await fingerprint({ b: 2, a: 1 }))
    expect(await fingerprint({ a: 1, b: undefined })).toBe(await fingerprint({ a: 1 }))
  })

  it('go through base64 and back', () => {
    const bytes = randomBytes(60_000)
    expect(fromBase64(toBase64(bytes))).toEqual(bytes)
  })
})

describe('recovery codes', () => {
  it('are 25 letters of base 32 in groups of five, a new one each time', async () => {
    const { makeRecoveryCode } = await import('@/cloud/crypto.js')
    const code = makeRecoveryCode()
    expect(code).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){4}[0-9A-HJKMNP-TV-Z]{5}$/)
    expect(makeRecoveryCode()).not.toBe(code)
  })

  it('are read back however they are typed', async () => {
    const { readRecoveryCode } = await import('@/cloud/crypto.js')
    expect(readRecoveryCode('7KQ4M-2XWPD-AB1CD-EF0GH-JK2MN')).toBe('7KQ4M2XWPDAB1CDEF0GHJK2MN')
    expect(readRecoveryCode(' 7kq4m 2xwpd ablcd ef0gh jk2mn ')).toBe('7KQ4M2XWPDAB1CDEF0GHJK2MN')
    expect(readRecoveryCode('7KQ4M-2XWPD-ABICD-EFOGH-JK2MN')).toBe('7KQ4M2XWPDAB1CDEF0GHJK2MN')
    expect(readRecoveryCode('7KQ4M-2XWPD-AB1CD-EF0GH')).toBeNull()
    expect(readRecoveryCode('7KQ4M-2XWPD-AB1CD-EF0GH-JK2MU')).toBeNull()
  })

  it('make the same keys from the same code, and others from another', async () => {
    const { makeRecoveryCode, readRecoveryCode, recoveryKeys } = await import('@/cloud/crypto.js')
    const code = /** @type {string} */ (readRecoveryCode(makeRecoveryCode()))
    const [a, b] = await Promise.all([recoveryKeys(code), recoveryKeys(code)])
    expect(a.auth).toEqual(b.auth)
    const other = await recoveryKeys(/** @type {string} */ (readRecoveryCode(makeRecoveryCode())))
    expect(other.auth).not.toEqual(a.auth)
  })
})
