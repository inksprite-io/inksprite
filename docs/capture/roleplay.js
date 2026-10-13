/**
 * The roleplay guide, done: a character card and its lorebook imported, a
 * persona pinned, and a few turns of the game played and compacted, in the
 * order the guide tells it.
 *
 * The card is Pif, by bipbop on Chub, and the lorebook its page links to. They
 * are someone else's work, so neither is kept in the repository: both are
 * downloaded the first time and kept beside this file, out of git.
 *
 * The game is one played on Claude Sonnet 5.5 through Anthropic's API, on
 * 12 Oct 2026, replayed: what the writer said is in `roleplay-game.json`
 * with each reply the model made, the calls it made on the way, and what the
 * dice and the oracle drew in that turn. Anthropic is the stand-in, which
 * gives back those replies, and the draws are handed to the app's tools again
 * (see `toolRandom` in capture.js), so the rolls come out as they did. The
 * tools run for real, on the imported lorebook.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const FILES = {
  card: {
    url: 'https://avatars.charhub.io/avatars/bipbop/pif-2b066033/chara_card_v2.png',
    path: fileURLToPath(new URL('pif.png', import.meta.url)),
  },
  // Its name is the one the lorebook's folder takes, until the guide renames it.
  lorebook: {
    url: 'https://files.catbox.moe/sohhf2.json',
    path: fileURLToPath(new URL('sohhf2.json', import.meta.url)),
  },
}

/** The game, as played: see the comment at the top. */
const GAME = fileURLToPath(new URL('roleplay-game.json', import.meta.url))

/** The project, and the persona the writer plays. */
const PROJECT = 'Pif'
const PERSONA = 'Tal'
const PERSONA_TEXT =
  'A tall, lean man who looks to be in his late 30s. He speaks little and wears a pair of revolvers at his hip.'
const LOREBOOK = 'Divided Skies'

/** A made-up key: the stand-in takes any. */
const ANTHROPIC_KEY = 'sk-ant-made-up-for-the-guide'

/**
 * @typedef {{
 *   say: string[],
 *   randoms?: number[],
 *   steps?: import('./stand-in.js').Step[],
 *   summary?: string,
 * }} Turn
 */

/** The card and the lorebook, downloaded where they aren't here yet. */
async function files() {
  for (const { url, path } of Object.values(FILES)) {
    if (existsSync(path)) continue
    console.log(`  downloading ${url}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`)
    await writeFile(path, Buffer.from(await response.arrayBuffer()))
  }
}

/**
 * What the writer types for a turn: each line of it, broken with Shift-Enter
 * rather than sent.
 *
 * @param {Turn} turn
 */
function linesOf(turn) {
  return turn.say.flatMap(said => said.split('\n'))
}

/**
 * The words of a writer's turn the stand-in knows it by: its last line, which
 * is theirs whatever command came before it.
 *
 * @param {Turn} turn
 */
function matchOf(turn) {
  return linesOf(turn).filter(Boolean).at(-1) || ''
}

/**
 * @param {import('./capture.js').Helpers} ui
 * @param {{ standIn: Awaited<ReturnType<typeof import('./stand-in.js').startStandIn>>, context: import('playwright').BrowserContext }} session
 */
export async function roleplay(ui, { standIn, context }) {
  const { page } = ui
  await files()
  const { turns } = /** @type {{ turns: Turn[] }} */ (JSON.parse(await readFile(GAME, 'utf8')))

  for (const turn of turns) {
    if (turn.summary) {
      standIn.script({ system: 'Summarize this roleplay chat', steps: [{ text: turn.summary }] })
    } else if (turn.steps) {
      standIn.script({ match: matchOf(turn), steps: turn.steps })
    }
  }

  const button = (/** @type {string} */ name) => page.getByRole('button', { name, exact: true })
  const dialog = (/** @type {string} */ name) => page.getByRole('dialog', { name })
  const row = (/** @type {string} */ name, level = 0) =>
    level
      ? page.locator(`[role="treeitem"][aria-level="${level}"][aria-label="${name}"]`)
      : page.getByRole('treeitem', { name, exact: true })
  const menu = (/** @type {string} */ name) => page.getByRole('menuitem', { name })
  const message = page.getByRole('textbox', { name: "Let's brainstorm…" })
  const settings = dialog('Settings')

  /**
   * Take a turn: the tools' draws set out first, the lines typed, and the
   * reply waited for.
   *
   * @param {Turn} turn
   * @param {number} minute - Past nine in the evening, for the time it shows
   */
  async function take(turn, minute) {
    await context.clock.setSystemTime(new Date(Date.UTC(2026, 9, 1, 21, minute)))
    const draws = turn.randoms || []
    await page.evaluate(values => {
      const shared = /** @type {any} */ (window)
      shared.__toolRandomQueue = [...values]
      shared.__toolRandomLog = []
    }, draws)
    await ui.click(message)
    const lines = linesOf(turn)
    for (const [at, line] of lines.entries()) {
      if (line) await ui.type(line)
      if (at < lines.length - 1) await ui.press('Shift+Enter')
    }
    await ui.press('Enter')
    await button('Stop generating').waitFor()
    await button('Send message').waitFor({ timeout: 60_000 })
    await ui.pause(500)
    const drawn = await page.evaluate(() => /** @type {any} */ (window).__toolRandomLog.length)
    if (drawn !== draws.length) {
      throw new Error(`The turn drew ${drawn} times, and ${draws.length} when it was played`)
    }
  }

  /**
   * Show a turn from its top: the writer's line and the start of the reply.
   *
   * @param {string} words - Some of the first thing in the writer's turn
   * @param {number} [above] - How far above them to start, for what heads it
   */
  async function scrollTo(words, above = 60) {
    const said = page.getByText(words).first()
    await said.evaluate(element => element.scrollIntoView({ block: 'start' }))
    await page.mouse.move(640, 400)
    await page.mouse.wheel(0, -above)
    await ui.pause(400)
  }

  // A provider first, as the guide assumes one: Anthropic, made up.
  await ui.goto('/')
  await dialog('Welcome').waitFor()
  await ui.click(button('Start writing'))
  await ui.click(button('Settings'))
  await ui.click(settings.getByRole('button', { name: 'AI', exact: true }))
  await ui.click(page.getByRole('combobox', { name: 'Provider', exact: true }))
  await ui.click(page.getByRole('option', { name: 'Anthropic' }))
  await ui.click(settings.getByRole('button', { name: 'Connect', exact: true }))
  const provider = dialog('Provider configuration')
  await ui.paste(provider.getByRole('textbox', { name: 'API key' }), ANTHROPIC_KEY)
  await ui.click(provider.getByRole('button', { name: 'Connect' }))
  await settings.getByText('Ready').waitFor()
  await ui.click(provider.getByRole('button', { name: 'Close' }))
  await provider.waitFor({ state: 'hidden' })
  await ui.click(page.getByRole('combobox', { name: 'Model' }))
  await ui.click(page.getByRole('option', { name: 'Claude Sonnet 5.5' }))
  await ui.click(settings.getByRole('button', { name: 'Close' }))
  await settings.waitFor({ state: 'hidden' })

  // The project, the card and its lorebook
  await ui.click(button('New project'))
  await ui.type(PROJECT)
  await ui.click(button('Create'))
  const project = row(PROJECT, 1)
  await project.waitFor()

  /** @param {string} path */
  async function importFile(path) {
    await ui.click(project.getByText(PROJECT).first(), { button: 'right' })
    await ui.hover(menu('Import'))
    const chooser = page.waitForEvent('filechooser')
    await ui.click(menu('Files…'))
    await (await chooser).setFiles(path)
  }

  await importFile(FILES.card.path)
  await dialog('Import a character card')
    .getByRole('button', { name: /^Import / })
    .waitFor()
  await ui.shot('roleplay-import-card', { of: dialog('Import a character card') })
  await ui.click(dialog('Import a character card').getByRole('button', { name: /^Import / }))
  await row(PROJECT, 4).waitFor()

  await importFile(FILES.lorebook.path)
  await ui.click(dialog('Import a lorebook').getByRole('button', { name: /^Import / }))
  await row('sohhf2').waitFor()

  await ui.click(row('sohhf2').getByText('sohhf2'), { button: 'right' })
  await ui.click(menu('Rename'))
  await ui.press('ControlOrMeta+a')
  await ui.type(LOREBOOK)
  await ui.press('Enter')
  await row(LOREBOOK).waitFor()
  await ui.click(row(LOREBOOK).getByRole('button', { name: 'Collapse' }))
  await ui.shot('roleplay-outline', {
    of: [button('Projects'), row(LOREBOOK)],
    pad: 12,
  })

  // The persona
  await ui.record('roleplay-persona', async () => {
    await ui.click(project.getByText(PROJECT).first(), { button: 'right' })
    await ui.click(menu('New folder'))
    await ui.type('Personas')
    await ui.press('Enter')
    await row('Personas').waitFor()
    await ui.click(row('Personas').getByText('Personas'), { button: 'right' })
    await ui.click(menu('New document'))
    await ui.type(PERSONA)
    await ui.press('Enter')
    await row(PERSONA).waitFor()
    await ui.click(page.locator('.ProseMirror'))
    await ui.type(PERSONA_TEXT)
  })

  // The chat, as Tal
  await context.clock.setSystemTime(new Date(Date.UTC(2026, 9, 1, 21, 0)))
  await ui.click(row(PROJECT, 4).getByText(PROJECT), { button: 'right' })
  await ui.click(menu(`Chat with ${PROJECT}…`))
  const start = dialog(`Chat with ${PROJECT}`)
  await start.waitFor()
  await ui.type(PERSONA)
  await ui.shot('roleplay-start-chat', { of: start })
  await ui.click(start.getByRole('button', { name: 'Start chat' }))
  await start.waitFor({ state: 'hidden' })

  await row(PERSONA).hover()
  await ui.click(row(PERSONA).getByRole('button', { name: 'Pin to this chat' }))
  await row(PERSONA).getByRole('button', { name: 'Pinned to this chat' }).waitFor()
  // The greeting from its start.
  await page.mouse.move(1100, 400)
  await page.mouse.wheel(0, -4000)
  await ui.pause(400)
  await ui.shot('roleplay-pinned')

  // Who is who, and what the card asks of every turn
  await ui.click(button('Chat settings'))
  await ui.click(button('Roleplay'))
  const instructions = page.getByRole('textbox', { name: 'Post-history instructions' })
  // At the top of the pane, so the section fits under it whole.
  await button('Roleplay').evaluate(header => header.scrollIntoView({ block: 'start' }))
  await ui.pause(400)
  await ui.shot('roleplay-settings', { of: [button('Roleplay'), instructions], pad: 12 })
  await ui.click(button('Roleplay'))

  // What the model may do
  await ui.click(button('Tools'))
  await ui.click(page.getByRole('switch', { name: 'RPG Tools', exact: true }))
  await ui.shot('roleplay-tools', {
    of: [button('Tools'), page.getByRole('switch', { name: 'RPG Tools', exact: true })],
    pad: 12,
  })
  await ui.click(button('Back to chat'))

  // The game, wide
  await ui.click(button('Hide editor'))
  const [explore, job, fire, oracle, steer, ...rest] = turns
  await ui.record('roleplay-explore', async () => {
    await take(explore, 2)
  })
  await take(job, 4)
  await take(fire, 5)
  await scrollTo('I draw my revolver and fire.')
  await ui.click(page.getByText('1 tool call').last())
  await ui.shot('roleplay-dice')
  await take(oracle, 7)
  await scrollTo('Is the boiler vent open', 150)
  await ui.shot('roleplay-oracle')
  await take(steer, 8)
  await scrollTo('I step in close')
  await ui.shot('roleplay-ooc')

  let minute = 10
  for (const turn of rest) {
    await take(turn, minute)
    minute += 2
    if (turn.summary) {
      await scrollTo('Session Summary')
      await ui.shot('roleplay-summary')
    }
  }
  await ui.shot('roleplay-after-summary')
}
