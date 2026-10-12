/**
 * Takes the guide's pictures of OpenRouter's own pages: where the writer
 * signs in, and the page that asks them to authorize inksprite.
 *
 *   npm run capture:openrouter
 *
 * These need an OpenRouter account, so they are not part of `npm run
 * capture`, and only need taking again when OpenRouter changes its pages.
 * Use an account made for the docs, never your own: its name shows on the
 * authorize page, and the session kept here can spend its credits.
 *
 * The first run signs in with the email and password on the two lines of
 * `.claude/openrouter-docs-key` at the repository root (gitignored), and keeps
 * the session in `capture/.openrouter-session.json` (gitignored) for the runs
 * after it. If OpenRouter emails a code to confirm the sign-in, the run waits
 * for it in `capture/.openrouter-code`. With neither, it takes the sign-up
 * page alone.
 *
 * Like `npm run capture`, it takes each picture in the light theme and the
 * dark (`--theme` for one), the dark one's name ending in `-dark`.
 *
 * The click on Authorize is real; the key it would be traded for is not
 * asked for (the stand-in answers instead), so no key is made.
 */

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { helpers, openBrowser, startApp } from './capture.js'

const HERE = fileURLToPath(new URL('.', import.meta.url))
/** The main checkout's root, from a worktree too: the key stays in one place. */
const REPOSITORY = dirname(
  execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd: HERE,
    encoding: 'utf8',
  }).trim()
)
const LOGIN = join(REPOSITORY, '.claude', 'openrouter-docs-key')
const SESSION = join(HERE, '.openrouter-session.json')
const CODE = join(HERE, '.openrouter-code')

/** How long to wait for a code OpenRouter emails. */
const CODE_WAIT_MS = 10 * 60 * 1000

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      headed: { type: 'boolean', default: false },
      theme: { type: 'string' },
    },
  })
  const themes = /** @type {Array<'light' | 'dark'>} */ (
    values.theme ? [values.theme] : ['light', 'dark']
  )

  const app = values.url ? { url: values.url, stop: async () => {} } : await startApp()
  try {
    for (const theme of themes) {
      // Signed out, which is how a new reader finds it.
      await inTab({ url: app.url, headed: values.headed, theme }, ({ there }) =>
        there.shot('openrouter-sign-up')
      )
      if (!existsSync(SESSION) && !existsSync(LOGIN)) {
        console.log(`No docs account in ${LOGIN}: the authorize page waits for one.`)
        continue
      }
      await inTab(
        { url: app.url, headed: values.headed, theme, storageState: SESSION },
        async ({ tab, there, page, context }) => {
          if (/\/sign-(in|up)/.test(new URL(tab.url()).pathname)) await signIn(tab)
          const authorize = tab.getByRole('button', { name: 'Authorize' })
          await authorize.waitFor({ timeout: 60_000 })
          await there.shot('openrouter-authorize')
          await there.record('openrouter-authorize', async () => {
            await there.click(authorize)
            await tab.waitForEvent('close')
          })
          await page.getByText('Connected to your OpenRouter account').waitFor()
          await context.storageState({ path: SESSION })
        }
      )
    }
  } finally {
    await app.stop()
  }
}

/**
 * Get to OpenRouter's tab the way a new reader does, and do `then` there.
 *
 * @param {{ url: string, headed: boolean, theme: 'light' | 'dark', storageState?: string }} options
 *   `storageState` is used when the file is there
 * @param {(opened: { tab: import('playwright').Page, there: import('./capture.js').Helpers, page: import('playwright').Page, context: import('playwright').BrowserContext }) => Promise<void>} then
 */
async function inTab({ url, headed, theme, storageState }, then) {
  const session = await openBrowser({
    url,
    headed,
    theme,
    outside: true,
    storageState: storageState && existsSync(storageState) ? storageState : undefined,
  })
  const { page, context, ui } = session
  const button = (/** @type {string} */ name) => page.getByRole('button', { name, exact: true })

  try {
    await ui.goto('/')
    await ui.click(button('Start writing'))
    await ui.click(button('New project'))
    await ui.type('The Lighthouse')
    await ui.click(button('Create'))
    await ui.click(button('Connect'))

    const opening = page.waitForEvent('popup')
    await ui.click(button('Connect to OpenRouter'))
    const tab = await opening
    // Settled, as far as can be told: a site that keeps a connection open
    // never goes quiet.
    await tab.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {})
    await then({ tab, there: helpers(tab, url, { theme }), page, context })
  } catch (error) {
    await page.screenshot({ path: join(HERE, '..', 'capture-failed.png') }).catch(() => {})
    for (const [i, other] of context.pages().entries()) {
      if (other !== page)
        await other
          .screenshot({ path: join(HERE, '..', `capture-failed-tab${i}.png`) })
          .catch(() => {})
    }
    console.error('Stopped. What the pages showed is in capture-failed*.png.')
    throw error
  } finally {
    await session.close()
  }
}

/**
 * Sign in to OpenRouter in its tab: email, password, and the emailed code
 * when it asks for one.
 *
 * @param {import('playwright').Page} tab
 */
async function signIn(tab) {
  if (!existsSync(LOGIN)) {
    throw new Error(
      `Signing in needs the docs account's email and password, one a line, in ${LOGIN}.`
    )
  }
  const [email, password] = (await readFile(LOGIN, 'utf8')).split('\n').map(line => line.trim())

  const signInLink = tab.getByRole('link', { name: 'Sign in' })
  if (await signInLink.isVisible()) await signInLink.click()
  await tab.getByLabel('Email address').fill(email)
  await tab.getByRole('button', { name: 'Continue', exact: true }).click()
  await tab.getByLabel('Password').fill(password)
  await tab.getByRole('button', { name: 'Continue', exact: true }).click()

  // A sign-in from a browser OpenRouter hasn't seen may be confirmed by email.
  const asked = await Promise.race([
    tab
      .getByRole('button', { name: 'Authorize' })
      .waitFor({ timeout: 30_000 })
      .then(() => false),
    tab
      .getByText(/check your email|verification code|enter the code/i)
      .first()
      .waitFor({ timeout: 30_000 })
      .then(() => true),
  ])
  if (!asked) return

  console.log(`OpenRouter emailed a code. Put it in ${CODE} to go on.`)
  const deadline = Date.now() + CODE_WAIT_MS
  while (!existsSync(CODE)) {
    if (Date.now() > deadline) throw new Error('No code came.')
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  const code = (await readFile(CODE, 'utf8')).trim()
  await rm(CODE)
  await tab.keyboard.type(code, { delay: 80 })
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
