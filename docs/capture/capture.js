/**
 * Takes the guides' screenshots and videos from the app itself.
 *
 *   npm run capture                       # from docs/, with app/'s dependencies installed
 *   npm run capture -- --url <url>        # against an app already running
 *   npm run capture -- --headed           # watch it work
 *   npm run capture -- --videos           # record every video again
 *   npm run capture -- --theme dark       # one theme only
 *   npm run capture -- --guide roleplay   # one guide only
 *
 * It starts the app from `../app` on a free port and walks through each
 * guide in `GUIDES`, which says what to do and what to keep, in a new browser
 * profile (so the welcome dialog shows, as it does for a new reader).
 * OpenRouter, Anthropic, LM Studio and Kokoro are the stand-in in `stand-in.js`.
 * Screenshots go to `src/assets/guide/`, videos to `public/guide/`; the run
 * replaces them, and `git status` shows which ones the UI changed. It walks
 * through each guide twice, in the light theme and then the dark, and a dark
 * picture's name ends in `-dark`: the guide shows the one in the reader's
 * theme.
 *
 * OpenRouter's own pages are the exception, since they need an account: see
 * `openrouter.js`. This run leaves the media that one makes alone.
 */

import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { narration } from './narration.js'
import { roleplay } from './roleplay.js'
import { fetchShim, startStandIn } from './stand-in.js'
import { walkthrough } from './walkthrough.js'

const DOCS = fileURLToPath(new URL('..', import.meta.url))
const APP = join(DOCS, '..', 'app')
const IMAGES = join(DOCS, 'src', 'assets', 'guide')
const VIDEOS = join(DOCS, 'public', 'guide')

/** The window every picture is taken in: a laptop screen. */
const VIEWPORT = { width: 1280, height: 800 }

/**
 * Each guide's walkthrough, by the guide's page. Each starts from a new
 * profile, so none depends on another.
 */
const GUIDES = { 'getting-started': walkthrough, narration, roleplay }

/** @typedef {'light' | 'dark'} Theme */

/** The themes a run takes its pictures in, and what each adds to a picture's name. */
const THEMES = /** @type {const} */ ({ light: '', dark: '-dark' })

/**
 * The system font, pinned. The app uses the platform's own; on the Linux a
 * capture runs on that is DejaVu Sans, which no reader on a Mac or Windows
 * sees. Inter is close to both.
 */
async function fontCss() {
  const font = await readFile(
    join(DOCS, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')
  )
  return `
    @font-face {
      font-family: 'Inter Capture';
      font-weight: 100 900;
      src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');
    }
    :root { --font-sans: 'Inter Capture', ui-sans-serif, system-ui, sans-serif !important; }
    html { font-family: var(--font-sans) !important; }
  `
}

/** The pointer a recording shows: drawn only while one runs. */
const CURSOR_CSS = `
  #capture-cursor { display: none; position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none; }
  .capture-recording #capture-cursor { display: block; }
`

/**
 * Runs in every page before anything else: a pointer that follows the mouse
 * while a video records (a headless browser draws none), and in the app's
 * pages the font.
 *
 * A tab the app opens starts as about:blank and keeps its window when it
 * lands on the app, with a new document: so the listeners go on the window,
 * and what goes in the document goes in when it is ready, each time.
 *
 * @param {{ app: string, font: string, cursor: string }} setup - The app's
 *   origin, and the CSS for each
 */
function pageSetup({ app, font, cursor }) {
  const add = () => {
    if (document.getElementById('capture-cursor')) return
    const style = document.createElement('style')
    style.textContent = cursor + (location.origin === app ? font : '')
    document.head.append(style)
    const pointer = document.createElement('div')
    pointer.id = 'capture-cursor'
    pointer.innerHTML =
      '<svg width="22" height="28" viewBox="0 0 22 28"><path d="M1 1 L1 22 L6.5 16.5 L10.5 26 L14 24.5 L10 15.5 L18 15.5 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>'
    pointer.style.transform = 'translate(-100px, -100px)'
    document.body.append(pointer)
  }
  window.addEventListener('DOMContentLoaded', add)
  if (document.body) add()
  window.addEventListener(
    'mousemove',
    event => {
      const pointer = document.getElementById('capture-cursor')
      if (pointer)
        pointer.style.transform = `translate(${event.clientX - 1}px, ${event.clientY - 1}px)`
    },
    true
  )
}

/**
 * Runs in every page before anything else: the chance the app's tools draw on
 * (dice, the oracle, cards), kept and handed back. What they draw goes in
 * `window.__toolRandomLog`; while `window.__toolRandomQueue` has values left,
 * they draw those instead, so a game played once can be played again to the
 * same rolls. Everything else in the page draws as it always does.
 */
function toolRandom() {
  const draw = Math.random
  const page = /** @type {any} */ (window)
  page.__toolRandomQueue = []
  page.__toolRandomLog = []
  Math.random = () => {
    if (!(new Error().stack || '').includes('/src/ai/tools/')) return draw()
    const value = page.__toolRandomQueue.length > 0 ? page.__toolRandomQueue.shift() : draw()
    page.__toolRandomLog.push(value)
    return value
  }
}

/** @returns {Promise<number>} */
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
 * The app's dev server, on a port of its own.
 *
 * Its files may be reached through a link, as in a worktree whose
 * `node_modules` is the main checkout's: Vite serves only what is under the
 * app, so it is told where the link goes, or the icon font is refused.
 *
 * @returns {Promise<{ url: string, stop: () => Promise<void> }>}
 */
export async function startApp() {
  const vite = join(APP, 'node_modules', 'vite', 'dist', 'node', 'index.js')
  if (!existsSync(vite))
    throw new Error(`Install the app's dependencies first (npm install in ${APP}).`)
  const { createServer: createVite } = await import(pathToFileURL(vite).href)
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
  return { url: `http://127.0.0.1:${port}`, stop: () => server.close() }
}

/**
 * A browser on the app, set up to take the guide's pictures, and the helpers
 * a walkthrough uses. Shared with `openrouter.js`.
 *
 * @param {{ url: string, headed?: boolean, storageState?: string, outside?: boolean, videos?: boolean, theme?: Theme }} options
 *   `outside` lets the page reach the internet; otherwise anything that is
 *   neither the app nor the stand-in is refused, so nothing real is asked.
 *   `videos` records every video again (see `record`). `theme` is the one
 *   the system asks for, which the app follows.
 */
export async function openBrowser({
  url,
  headed = false,
  storageState,
  outside = false,
  videos = false,
  theme = 'light',
}) {
  const standIn = await startStandIn({ log: line => console.warn(line) })
  // The whole Chromium rather than its headless shell: sites with a bot check
  // (OpenRouter's sign-in) take it for what it is less often.
  const browser = await chromium.launch({ headless: !headed, channel: 'chromium' })
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: theme,
    locale: 'en-US',
    timezoneId: 'UTC',
    storageState,
  })
  // The clock runs, from a morning of our choosing; a walkthrough sets it
  // again before a step whose time shows, so it reads the same on every run.
  await context.clock.install({ time: new Date('2026-10-01T09:30:00Z') })
  await context.addInitScript(pageSetup, {
    app: new URL(url).origin,
    font: await fontCss(),
    cursor: CURSOR_CSS,
  })
  await context.addInitScript(fetchShim, { app: new URL(url).origin, origin: standIn.origin })
  await context.addInitScript(toolRandom)

  const local = [new URL(url).origin, standIn.origin]
  if (!outside) {
    await context.route(
      request =>
        !local.some(origin => request.href.startsWith(origin)) && !request.href.startsWith('data:'),
      route => {
        console.warn(`refused: ${route.request().method()} ${route.request().url()}`)
        return route.abort('blockedbyclient')
      }
    )
  }

  const page = await context.newPage()
  const ui = helpers(page, url, { videos, theme })
  return {
    browser,
    context,
    page,
    standIn,
    ui,
    close: async () => {
      await browser.close()
      await standIn.close()
    },
  }
}

/** Each video's fingerprint, by name: see `record`. */
const FINGERPRINTS = join(VIDEOS, 'fingerprints.json')

/**
 * What a walkthrough does things with.
 *
 * @param {import('playwright').Page} page
 * @param {string} url - The app's origin
 * @param {{ videos?: boolean, theme?: Theme }} [options] - `videos` records
 *   every video again, fingerprint or not; `theme` is the one the pictures
 *   are in, whose suffix their names take.
 */
export function helpers(page, url, { videos = false, theme = 'light' } = {}) {
  const suffix = THEMES[theme]
  /** The video being recorded, and what its fingerprint is made of so far. */
  let recording = /** @type {{ trail: string[] } | null} */ (null)
  let mouse = { x: 600, y: VIEWPORT.height - 20 }

  /** @param {number} ms */
  const pause = ms => page.waitForTimeout(ms)

  /** @param {number} x @param {number} y */
  async function moveTo(x, y) {
    await page.mouse.move(x, y, { steps: recording ? 18 : 1 })
    mouse = { x, y }
  }

  /**
   * Move the pointer to the middle of `target` the way a hand would, so a
   * video shows where the next click lands. While recording, what the page
   * holds at that moment goes into the fingerprint: it has settled from the
   * step before, and is what this one acts on.
   *
   * @param {import('playwright').Locator} target
   * @param {string} doing
   */
  async function pointAt(target, doing) {
    await target.scrollIntoViewIfNeeded()
    const box = await target.boundingBox()
    if (!box) throw new Error(`Nothing to point at: ${target}`)
    if (recording) recording.trail.push(doing, await page.locator('body').ariaSnapshot())
    await moveTo(box.x + box.width / 2, box.y + box.height / 2)
    if (recording) await pause(250)
  }

  return {
    page,
    pause,

    /** @param {string} path */
    goto: path => page.goto(new URL(path, url).href),

    /**
     * @param {import('playwright').Locator} target
     * @param {{ button?: 'left' | 'right' }} [options]
     */
    async click(target, options = {}) {
      await pointAt(target, `click ${target} ${options.button || ''}`)
      await target.click(options)
      // ProseMirror reads the new selection a moment after a click.
      await pause(recording ? 500 : 120)
    },

    /**
     * Type into whatever has the focus, a key at a time while recording.
     *
     * @param {string} text
     */
    async type(text) {
      recording?.trail.push(`type ${text}`)
      await page.keyboard.type(text, { delay: recording ? 45 : 0 })
      await pause(recording ? 400 : 60)
    },

    /**
     * Put `text` in a field at once, as a paste would.
     *
     * @param {import('playwright').Locator} field
     * @param {string} text
     */
    async paste(field, text) {
      await pointAt(field, `paste ${text} into ${field}`)
      await field.fill(text)
      await pause(recording ? 600 : 120)
    },

    /**
     * Rest the pointer on `target`, for what opens on a hover (a submenu).
     *
     * @param {import('playwright').Locator} target
     */
    async hover(target) {
      await pointAt(target, `hover ${target}`)
      await target.hover()
      await pause(recording ? 500 : 120)
    },

    /** @param {string} key */
    async press(key) {
      recording?.trail.push(`press ${key}`)
      await page.keyboard.press(key)
      await pause(recording ? 400 : 120)
    },

    /**
     * Keep what the window shows, or `of` the part of it that holds these
     * with `pad` pixels around, as `src/assets/guide/<name>.png` (or
     * `<name>-dark.png`).
     *
     * @param {string} name
     * @param {{ of?: import('playwright').Locator | import('playwright').Locator[], pad?: number }} [options]
     */
    async shot(name, { of, pad = 24 } = {}) {
      // Out of the way, so nothing shows the controls it would on a hover.
      await moveTo(600, VIEWPORT.height - 20)
      await pause(300)
      let clip
      if (of) {
        const boxes = await Promise.all([of].flat().map(part => part.boundingBox()))
        if (boxes.some(box => !box)) throw new Error(`Nothing to take a picture of for ${name}`)
        const all = /** @type {Array<{ x: number, y: number, width: number, height: number }>} */ (
          boxes
        )
        const x = Math.max(0, Math.min(...all.map(box => box.x)) - pad)
        const y = Math.max(0, Math.min(...all.map(box => box.y)) - pad)
        clip = {
          x,
          y,
          width: Math.min(VIEWPORT.width, Math.max(...all.map(box => box.x + box.width)) + pad) - x,
          height:
            Math.min(VIEWPORT.height, Math.max(...all.map(box => box.y + box.height)) + pad) - y,
        }
      }
      const png = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' })
      await mkdir(IMAGES, { recursive: true })
      // A palette keeps a screenshot of flat UI a quarter of the size, unchanged to the eye.
      await writeFile(
        join(IMAGES, `${name}${suffix}.png`),
        await sharp(png).png({ palette: true, effort: 10 }).toBuffer()
      )
      console.log(`  ${name}${suffix}.png`)
    },

    /**
     * Record what `steps` do as `public/guide/<name>.webm` (or
     * `<name>-dark.webm`).
     *
     * No two recordings of the same steps come out the same to the byte, so
     * a video is only replaced when its fingerprint changes: the steps it
     * takes, the page's accessibility tree before each click, and a picture
     * of where it ends (toasts left out, since they come and go on a timer).
     * A change that only restyles a step in between shows in the guide's
     * screenshots first; `--videos` records them all again.
     *
     * @param {string} name
     * @param {() => Promise<void>} steps
     */
    async record(name, steps) {
      name += suffix
      await mkdir(VIDEOS, { recursive: true })
      const video = join(VIDEOS, `${name}.webm`)
      const fresh = join(VIDEOS, `.${name}.recording.webm`)
      await page.evaluate(() => document.documentElement.classList.add('capture-recording'))
      await page.screencast.start({ path: fresh, size: VIEWPORT, quality: 90 })
      recording = { trail: [] }
      const { trail } = recording
      try {
        await page.mouse.move(mouse.x, mouse.y) // shows the pointer where it is
        await pause(600)
        await steps()
        await pause(2000)
      } finally {
        recording = null
        await page.screencast.stop()
        await page.evaluate(() => document.documentElement.classList.remove('capture-recording'))
      }

      const end = await page.screenshot({
        animations: 'disabled',
        caret: 'hide',
        style: '.p-toast { display: none !important; }',
      })
      const fingerprint = createHash('sha256').update(trail.join('\n')).update(end).digest('hex')
      const fingerprints = JSON.parse(await readFile(FINGERPRINTS, 'utf8').catch(() => '{}'))
      if (!videos && fingerprints[name] === fingerprint && existsSync(video)) {
        await rm(fresh)
        console.log(`  ${name}.webm (unchanged)`)
        return
      }
      await rename(fresh, video)
      fingerprints[name] = fingerprint
      await writeFile(FINGERPRINTS, `${JSON.stringify(fingerprints, null, 2)}\n`)
      console.log(`  ${name}.webm`)
    },
  }
}

/** @typedef {ReturnType<typeof helpers>} Helpers */

async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      headed: { type: 'boolean', default: false },
      videos: { type: 'boolean', default: false },
      theme: { type: 'string' },
      guide: { type: 'string' },
    },
  })
  if (values.theme && !(values.theme in THEMES))
    throw new Error(`--theme is one of ${Object.keys(THEMES).join(', ')}`)
  if (values.guide && !(values.guide in GUIDES))
    throw new Error(`--guide is one of ${Object.keys(GUIDES).join(', ')}`)
  const themes = /** @type {Theme[]} */ (values.theme ? [values.theme] : Object.keys(THEMES))
  const guides = /** @type {Array<keyof typeof GUIDES>} */ (
    values.guide ? [values.guide] : Object.keys(GUIDES)
  )

  const app = values.url ? { url: values.url, stop: async () => {} } : await startApp()
  try {
    for (const guide of guides) {
      for (const theme of themes) {
        console.log(`Capturing ${guide} from ${app.url}, ${theme}`)
        const session = await openBrowser({
          url: app.url,
          headed: values.headed,
          videos: values.videos,
          theme,
        })
        try {
          await GUIDES[guide](session.ui, session)
        } catch (error) {
          await session.page.screenshot({ path: join(DOCS, 'capture-failed.png') }).catch(() => {})
          await writeFile(
            join(DOCS, 'capture-requests.json'),
            JSON.stringify(session.standIn.requests, null, 2)
          )
          console.error(
            'Stopped. What the page showed is in capture-failed.png, what it asked the stand-in in capture-requests.json.'
          )
          throw error
        } finally {
          await session.close()
        }
      }
    }
  } finally {
    await app.stop()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
