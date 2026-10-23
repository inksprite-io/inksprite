// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApi } from '@/cloud/api.js'
import { changePassphrase, recover, remakeRecovery, signIn, signUp } from '@/cloud/account.js'
import { hashName } from '@/cloud/crypto.js'

const FAST = { name: 'PBKDF2', hash: 'SHA-256', iterations: 1000 }

// The sync server is kept in the development repository only, and these run
// against it; without it they are skipped.
const SERVER_SOURCE = fileURLToPath(new URL('../../../server/src/', import.meta.url))
const HAVE_SERVER = existsSync(SERVER_SOURCE)

/** @param {string} name */
const serverModule = name => import(/* @vite-ignore */ join(SERVER_SOURCE, name))

/** @type {string} */
let server
/** @type {() => Promise<void>} */
let close
/** @type {string} */
let folder
let accounts = 0

beforeAll(async () => {
  if (!HAVE_SERVER) return
  const { openStore } = await serverModule('store.js')
  const { openBlobs } = await serverModule('blobs.js')
  const { startServer } = await serverModule('app.js')
  folder = await mkdtemp(join(tmpdir(), 'inksprite-account-'))
  const running = await startServer({
    port: 0,
    host: '127.0.0.1',
    store: openStore(':memory:'),
    blobs: openBlobs(folder),
    signupCode: 'code',
  })
  const address = /** @type {import('node:net').AddressInfo} */ (running.server.address())
  server = `http://127.0.0.1:${address.port}`
  close = running.close
})

afterAll(async () => {
  if (!HAVE_SERVER) return
  await close()
  await rm(folder, { recursive: true, force: true })
})

/** Whether two sets of account keys are the same account's: they name a project alike. */
const sameAccount = async (/** @type {any} */ a, /** @type {any} */ b) =>
  (await hashName(a.ids, 'project:story_1')) === (await hashName(b.ids, 'project:story_1'))

/** A new account, signed up on a device. */
async function account() {
  const name = `writer${++accounts}`
  const made = await signUp(createApi(server), {
    name,
    passphrase: 'first passphrase',
    code: 'code',
    device: 'Chrome on macOS',
    kdf: FAST,
  })
  return { name, ...made, api: createApi(server, made.token) }
}

describe.skipIf(!HAVE_SERVER)('a sync account', () => {
  it('is made with a recovery code, shown once, in groups of five', async () => {
    const { api, recoveryCode } = await account()
    expect(recoveryCode).toMatch(/^([0-9A-HJKMNP-TV-Z]{5}-){4}[0-9A-HJKMNP-TV-Z]{5}$/)
    expect((await api.account()).recovery).toBe(true)
  })

  it('gets back in with its recovery code, under a new passphrase, and the code is used up', async () => {
    const made = await account()

    const recovered = await recover(
      createApi(server),
      {
        name: made.name,
        code: made.recoveryCode.toLowerCase().replace(/-/g, ' '),
        passphrase: 'second passphrase',
        device: 'Safari on iPhone',
        kdf: FAST,
      },
      token => createApi(server, token)
    )

    expect(await sameAccount(recovered.keys, made.keys)).toBe(true)
    expect(recovered.recoveryCode).not.toBe(made.recoveryCode)
    await expect(
      signIn(createApi(server), {
        name: made.name,
        passphrase: 'first passphrase',
        device: 'x',
      })
    ).rejects.toThrow('wrong')
    const again = await signIn(createApi(server), {
      name: made.name,
      passphrase: 'second passphrase',
      device: 'x',
    })
    expect(await sameAccount(again.keys, made.keys)).toBe(true)
    await expect(
      recover(
        createApi(server),
        {
          name: made.name,
          code: made.recoveryCode,
          passphrase: 'third passphrase',
          device: 'x',
          kdf: FAST,
        },
        token => createApi(server, token)
      )
    ).rejects.toThrow('recovery code is wrong')
  })

  it('refuses a name the server would refuse before asking it', async () => {
    await expect(
      signUp(createApi(server), {
        name: 'colin_h',
        passphrase: 'a long passphrase',
        code: 'code',
        device: 'x',
        kdf: FAST,
      })
    ).rejects.toThrow('Use only the letters a to z, digits and hyphens in a name.')
  })

  it('refuses what is not a recovery code before asking the server', async () => {
    const made = await account()
    await expect(
      recover(
        createApi(server),
        { name: made.name, code: 'not a code', passphrase: 'x', device: 'x' },
        token => createApi(server, token)
      )
    ).rejects.toThrow("isn't a recovery code")
  })

  it('makes a new recovery code with the passphrase, and the old one stops working', async () => {
    const made = await account()
    await expect(remakeRecovery(made.api, 'wrong passphrase')).rejects.toThrow(
      'The passphrase is wrong.'
    )
    const code = await remakeRecovery(made.api, 'first passphrase')
    expect(code).not.toBe(made.recoveryCode)
    await expect(
      recover(
        createApi(server),
        {
          name: made.name,
          code: made.recoveryCode,
          passphrase: 'a third passphrase',
          device: 'x',
          kdf: FAST,
        },
        token => createApi(server, token)
      )
    ).rejects.toThrow()
  })

  it('changes the passphrase, and the devices signed in stay so', async () => {
    const made = await account()
    await expect(
      changePassphrase(made.api, { current: 'wrong', next: 'a new passphrase', kdf: FAST })
    ).rejects.toThrow('The passphrase is wrong.')
    await expect(
      changePassphrase(made.api, { current: 'first passphrase', next: 'too short', kdf: FAST })
    ).rejects.toThrow('at least 12 characters')
    await changePassphrase(made.api, {
      current: 'first passphrase',
      next: 'a new passphrase',
      kdf: FAST,
    })

    const again = await signIn(createApi(server), {
      name: made.name,
      passphrase: 'a new passphrase',
      device: 'x',
    })
    expect(await sameAccount(again.keys, made.keys)).toBe(true)
    expect((await made.api.account()).name).toBe(made.name)
  })

  it('lists the devices by name, and signs one out from another', async () => {
    const made = await account()
    const phone = await signIn(createApi(server), {
      name: made.name,
      passphrase: 'first passphrase',
      device: 'Safari on iPhone',
    })

    const listed = await made.api.devices()
    expect(listed.map(device => [device.device, device.current]).sort()).toEqual([
      ['Chrome on macOS', true],
      ['Safari on iPhone', false],
    ])
    const other = /** @type {any} */ (listed.find(device => !device.current))
    await made.api.signOutDevice(other.id)
    await expect(createApi(server, phone.token).account()).rejects.toMatchObject({ status: 401 })
  })
})
