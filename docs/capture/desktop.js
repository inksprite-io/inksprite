/**
 * Takes the guide's pictures of what only the desktop app has: a terminal,
 * and a connected app's card.
 *
 *   npm run capture:desktop                  # from docs/, in the container
 *   npm run capture:desktop -- --theme dark  # one theme only
 *   npm run capture:desktop -- --url <url>   # against an app already running
 *
 * `npm run capture` runs in a browser, which has neither. This runs the
 * desktop app from `../app/electron` on the app's dev server, on a display
 * of Xvfb's it starts, with data of its own in a folder it removes after.
 * Like the capture, it takes each picture in the light theme and the dark,
 * at twice the size it is shown, in the same font. The terminal runs bash in
 * a home of its own, with a plain prompt, so nothing of the machine it runs
 * on shows.
 *
 * It needs the app's and the desktop app's dependencies installed, and Xvfb.
 * Connected apps listen on port 4657: run it with no other desktop app on
 * this machine listening there.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { _electron as electron } from 'playwright'
import { CURSOR_CSS, fontCss, helpers, noSpelling, pageSetup, startApp } from './capture.js'

const DOCS = fileURLToPath(new URL('..', import.meta.url))
const DESKTOP = join(DOCS, '..', 'app', 'electron')

/** The display the app is drawn on. */
const DISPLAY = ':97'

/** The window's size, the capture's own. */
const WINDOW = { width: 1280, height: 800 }

/** What the terminal's home holds: the project's chapters, as a writer might keep them. */
const CHAPTERS = {
  'Chapter 1.md': 'The vault door opened on the third try. '.repeat(212),
  'Chapter 2.md': 'Nobody in the guild believed the map. '.repeat(305),
  'Chapter 3.md': 'She counted the guards twice and left. '.repeat(187),
}

async function main() {
  const { values } = parseArgs({
    options: { url: { type: 'string' }, theme: { type: 'string' } },
  })
  const themes = /** @type {Array<'light' | 'dark'>} */ (
    values.theme ? [values.theme] : ['light', 'dark']
  )

  const scratch = await mkdtemp(join(tmpdir(), 'inksprite-desktop-capture-'))
  const display = spawn('Xvfb', [DISPLAY, '-screen', '0', '1920x1200x24'], { stdio: 'ignore' })
  const app = values.url ? { url: values.url, stop: async () => {} } : await startApp()
  try {
    const home = await makeHome(scratch)
    const desktop = await electron.launch({
      executablePath: createRequire(join(DESKTOP, 'package.json'))('electron'),
      args: [DESKTOP, '--force-device-scale-factor=2'],
      cwd: DESKTOP,
      env: {
        ...process.env,
        DISPLAY,
        XDG_CONFIG_HOME: join(scratch, 'config'),
        INKSPRITE_PAGE_URL: `${app.url}/`,
        HOME: home,
        SHELL: '/bin/bash',
      },
    })
    try {
      const origin = new URL(app.url).origin
      await desktop.context().addInitScript(pageSetup, {
        app: origin,
        font: await fontCss(),
        cursor: CURSOR_CSS,
      })
      await desktop.context().addInitScript(noSpelling, { app: origin })
      const page = await desktop.firstWindow()
      await desktop.evaluate(({ BrowserWindow }, { width, height }) => {
        BrowserWindow.getAllWindows()[0].setContentSize(width, height)
      }, WINDOW)
      await page.reload()
      await walk(page, app.url, themes)
    } finally {
      await desktop.close()
    }
  } finally {
    await app.stop()
    display.kill()
    await rm(scratch, { recursive: true, force: true })
  }
}

/**
 * A home for the terminal's shell: the chapters, and a plain prompt.
 *
 * @param {string} scratch
 * @returns {Promise<string>}
 */
async function makeHome(scratch) {
  const home = join(scratch, 'home')
  const project = join(home, 'Thief')
  await mkdir(project, { recursive: true })
  for (const [name, text] of Object.entries(CHAPTERS)) await writeFile(join(project, name), text)
  await writeFile(join(home, '.bashrc'), "PS1='\\W $ '\n")
  await writeFile(join(home, '.bash_profile'), '. ~/.bashrc\n')
  return home
}

/**
 * Set the project up once, then take each picture in each theme.
 *
 * @param {import('playwright').Page} page
 * @param {string} url
 * @param {Array<'light' | 'dark'>} themes
 */
async function walk(page, url, themes) {
  const ui = helpers(page, url)
  const button = (/** @type {string} */ name) => page.getByRole('button', { name, exact: true })
  const menu = (/** @type {string} */ name) => page.getByRole('menuitem', { name })
  const row = (/** @type {string} */ name) => page.getByRole('treeitem', { name, exact: true })
  const editor = page.locator('.ProseMirror').first()

  await ui.click(button('Start writing'))
  await ui.click(button('Projects'))
  await ui.click(menu('New project…'))
  await ui.type('Thief')
  await ui.click(button('Create'))

  // The chapters the terminal lists, the last open in the editor.
  for (const [name, line] of [
    ['Chapter 1', 'The vault door opened on the third try.'],
    ['Chapter 2', 'Nobody in the guild believed the map.'],
    ['Chapter 3', 'She counted the guards twice and left before the bell.'],
  ]) {
    await ui.click(row('Thief'), { button: 'right' })
    await ui.click(menu('New document'))
    await ui.type(name)
    await ui.press('Enter')
    await row(name).waitFor()
    await ui.click(editor)
    await ui.type(line)
  }

  await page.evaluate(async () => {
    const { useApplicationState } = await import('/src/composables/useApplicationState.js')
    useApplicationState().setExtension('terminal', true)
  })
  await ui.click(page.locator('[data-action="new-terminal"]'))
  const terminal = page.locator('[data-terminal-frame] iframe')
  await terminal.waitFor()
  await ui.pause(1500)
  await ui.type('cd Thief')
  await ui.press('Enter')
  await ui.type('wc -w *.md')
  await ui.press('Enter')
  await ui.pause(800)

  for (const theme of themes) {
    await page.evaluate(async theme => {
      const { useApplicationState } = await import('/src/composables/useApplicationState.js')
      useApplicationState().setTheme(theme)
    }, theme)
    await ui.pause(800)
    const there = helpers(page, url, { theme })
    await there.shot('terminal')

    await page.evaluate(async () => {
      const { useSettingsPanel } = await import('/src/composables/useSettingsPanel.js')
      useSettingsPanel().open()
    })
    await ui.click(page.getByText('Connections', { exact: true }).first())
    await ui.click(page.getByText('Connected apps', { exact: true }).first())
    // The app the guide connects, Claude Code, with the project ticked, its
    // card open as it is while it is set up.
    if ((await page.locator('[data-app]').count()) === 0) {
      await ui.click(page.locator('[data-action="add-app"]'))
      await ui.click(page.locator('[data-app-project]').filter({ hasText: 'Thief' }))
    } else if (!(await page.locator('[data-app] [data-card-body]').isVisible())) {
      await ui.click(page.locator('[data-app] [data-card-toggle]').first())
    }
    await ui.pause(500)
    // A token is new each run: shown the same each time, the picture changes
    // only when the card does.
    await page.locator('[data-setup="token"] code').evaluate(code => {
      code.textContent = 'k3Yq…'
    })
    await there.shot('connected-apps', {
      of: [
        page.getByRole('heading', { name: 'Connected apps' }),
        page.locator('[data-apps-server]'),
        page.locator('[data-list="apps"]'),
      ],
      pad: 16,
    })
    await ui.press('Escape')
    await ui.pause(400)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}
