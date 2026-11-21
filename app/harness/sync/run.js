/**
 * Sync and sharing, gone through in a browser as writers go through them:
 * accounts made, friend codes passed, projects shared, whole or with only
 * some of their documents, accepted, rejected, left and taken back, people
 * blocked, devices signed out.
 *
 *   npm run sync-flows                    # from app/, every flow
 *   npm run sync-flows -- --only block    # the flows whose names have this in them
 *   npm run sync-flows -- --headed        # watch it work
 *   npm run sync-flows -- --keep          # leave the server, the app and the accounts up
 *
 * It starts a sync server of its own from `../server` (kept out of the
 * published repository, so there this says so and stops), on a free port and
 * with nothing in it, and the app beside it with the features for developing
 * (`config/dev.js`), which let a sign-in name its server. Each account is a
 * browser profile of its own, as a writer's browser is; a second device of
 * an account is another profile signed in to it. Nothing here reaches
 * `sync.inksprite.io`, and nothing is left behind.
 *
 * `--keep` is for trying something by hand: it makes the accounts the flows
 * use, says where the app and the server are and what the accounts'
 * passphrases are, and waits until it is stopped.
 *
 * The flows are in `flows.js`, and what they do in the page in `writer.js`.
 * The engine's own tests (`test/cloud/sharing.test.js`) say what each side
 * ends up holding; these say the app gets a writer there.
 */

import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { FLOWS } from './flows.js'
import { PASSPHRASE, SIGNUP_CODE, makeWriter } from './writer.js'

const APP = fileURLToPath(new URL('../..', import.meta.url))
const SERVER = join(APP, '..', 'server', 'src')
const DOCS = join(APP, '..', 'docs')
const RUNS = join(APP, 'harness', 'runs', 'sync')

/** @returns {Promise<number>} A port nothing listens on */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = /** @type {import('node:net').AddressInfo} */ (server.address())
      server.close(() => resolve(port))
    })
  })
}

/**
 * A sync server with nothing in it, which any number of accounts can be made
 * on with `SIGNUP_CODE`.
 * @returns {Promise<{url: string, close: () => Promise<void>}>}
 */
async function startSync() {
  const from = (/** @type {string} */ name) => import(pathToFileURL(join(SERVER, name)).href)
  const { openStore } = await from('store.js')
  const { openBlobs } = await from('blobs.js')
  const { startServer } = await from('app.js')
  const folder = await mkdtemp(join(tmpdir(), 'inksprite-sync-flows-'))
  const running = await startServer({
    port: 0,
    host: '127.0.0.1',
    store: openStore(':memory:'),
    blobs: openBlobs(folder),
    signupCode: SIGNUP_CODE,
  })
  const { port } = /** @type {import('node:net').AddressInfo} */ (running.server.address())
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      await running.close()
      await rm(folder, { recursive: true, force: true })
    },
  }
}

/**
 * The app, as a build for developing has it: nothing in preview, and the
 * sign-in naming its server.
 * @returns {Promise<{url: string, close: () => Promise<void>}>}
 */
async function startApp() {
  const vite = join(APP, 'node_modules', 'vite', 'dist', 'node', 'index.js')
  const { createServer: createVite } = await import(pathToFileURL(vite).href)
  // A value already in the environment wins over app/.env.local, an empty one too.
  process.env.VITE_PREVIEW = ''
  process.env.VITE_DEV_FEATURES = 'true'
  const port = await freePort()
  const server = await createVite({
    root: APP,
    configFile: join(APP, 'vite.config.js'),
    logLevel: 'warn',
    server: {
      port,
      host: '127.0.0.1',
      strictPort: true,
      fs: { allow: [APP, await realpath(join(APP, 'node_modules'))] },
    },
  })
  await server.listen()
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() }
}

/** Playwright, which the guides' capture installs in docs/. */
async function loadChromium() {
  const entry = join(DOCS, 'node_modules', 'playwright', 'index.mjs')
  if (!existsSync(entry)) {
    throw new Error(`Playwright isn't installed. Run npm install in ${DOCS} first.`)
  }
  const { chromium } = await import(pathToFileURL(entry).href)
  return chromium
}

async function main() {
  const { values } = parseArgs({
    options: {
      only: { type: 'string' },
      headed: { type: 'boolean' },
      keep: { type: 'boolean' },
    },
  })
  if (!existsSync(join(SERVER, 'app.js'))) {
    console.error('The sync server is not in this checkout, so there is nothing to sync with.')
    process.exit(1)
  }

  const chromium = await loadChromium()
  const sync = await startSync()
  const app = await startApp()
  const browser = await chromium.launch({ headless: !values.headed })
  await rm(RUNS, { recursive: true, force: true })
  await mkdir(RUNS, { recursive: true })

  /** Every profile opened, to close them all. @type {import('playwright').BrowserContext[]} */
  const opened = []
  let made = 0
  /**
   * A flow's own people: each call is a writer in a profile of their own,
   * under a name no other flow has.
   * @param {string} flow
   */
  const cast = flow => ({
    /** @param {string} name */
    writer: async name => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
      opened.push(context)
      return makeWriter(context, {
        app: app.url,
        server: sync.url,
        name: `${name}-${++made}`,
        shots: join(RUNS, flow),
      })
    },
    /**
     * Another device of a writer's: a profile of its own, signed in to their account.
     * @param {Awaited<ReturnType<typeof makeWriter>>} writer
     */
    device: async writer => {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
      opened.push(context)
      const device = await makeWriter(context, {
        app: app.url,
        server: sync.url,
        name: writer.name,
        shots: join(RUNS, flow),
        label: `${writer.name}-2`,
      })
      await device.signIn()
      return device
    },
  })

  let failed = 0
  try {
    if (values.keep) {
      const people = cast('kept')
      const names = []
      for (const name of ['ada', 'ben', 'cy', 'dee']) {
        const writer = await people.writer(name)
        await writer.signUp()
        names.push(`${writer.name} (friend code ${await writer.friendCode()})`)
      }
      console.log(`The app:      ${app.url}`)
      console.log(`The server:   ${sync.url}`)
      console.log(`Passphrase:   ${PASSPHRASE}`)
      console.log(`Sign-up code: ${SIGNUP_CODE}`)
      console.log(`Accounts:\n  ${names.join('\n  ')}`)
      console.log('Stop it with Control-C.')
      await new Promise(resolve => process.once('SIGINT', resolve))
      return
    }

    const flows = FLOWS.filter(flow => !values.only || flow.name.includes(values.only))
    for (const flow of flows) {
      const started = Date.now()
      const people = cast(flow.name.replace(/\W+/g, '-'))
      const before = opened.length
      try {
        await flow.run(people)
        console.log(`✓ ${flow.name} (${Math.round((Date.now() - started) / 1000)}s)`)
      } catch (error) {
        failed++
        console.log(`✗ ${flow.name}`)
        console.log(
          `  ${String(error?.message || error)
            .split('\n')
            .join('\n  ')}`
        )
        for (const context of opened.slice(before)) {
          for (const page of context.pages()) {
            const shot = join(
              RUNS,
              `${flow.name.replace(/\W+/g, '-')}-${opened.indexOf(context)}.png`
            )
            await page.screenshot({ path: shot }).catch(() => {})
          }
        }
        console.log(`  What each page showed is in ${RUNS}`)
      }
      for (const context of opened.splice(before)) await context.close()
    }
    console.log(`\n${flows.length - failed} of ${flows.length} flows passed.`)
  } finally {
    for (const context of opened) await context.close().catch(() => {})
    await browser.close()
    await app.close()
    await sync.close()
  }
  process.exit(failed ? 1 : 0)
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
