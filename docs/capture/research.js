/**
 * The research guide, done: two papers imported, summarized, the web
 * searched, a design doc written, commented on, revised and reviewed, in the
 * order the guide tells it.
 *
 * The papers are Ink & Switch's, so neither is kept in the repository: both
 * are downloaded the first time and kept beside this file, out of git.
 *
 * The research is a session on Claude Opus 5.5 through Anthropic's API, on
 * 12 Oct 2026, replayed: what the writer said is in `research-game.json` with
 * each reply the model made and the calls it made on the way (reworded where
 * a reply repeated its sources). Anthropic is the stand-in, which gives back
 * those replies, and the document tools run for real on the imported papers.
 * The web searches went to Exa; here Exa is answered from the game too, with
 * the titles and addresses it found and none of the pages' words, which are
 * other people's. The comments' ids are drawn as they were, so the model's
 * calls name the same comments.
 */

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const FILES = [
  {
    url: 'https://www.inkandswitch.com/local-first/static/local-first.pdf',
    path: fileURLToPath(new URL('Local-first software.pdf', import.meta.url)),
  },
  {
    url: 'https://www.inkandswitch.com/peritext/static/cscw-publication.pdf',
    path: fileURLToPath(new URL('Peritext.pdf', import.meta.url)),
  },
]

/** The session, as it went: see the comment at the top. */
const GAME = fileURLToPath(new URL('research-game.json', import.meta.url))

const PROJECT = 'Collaborative editing'
const DESIGN = 'Real-time collaboration — design doc'

/** A made-up key: the stand-in takes any. */
const ANTHROPIC_KEY = 'sk-ant-made-up-for-the-guide'

/** What Exa's answers say in place of a page's words. */
const LEFT_OUT = "(The page's words are left out of the guide's recording.)"

/** What Exa said when its free searches ran out, as it said it. */
const EXA_LIMITED =
  "You've hit Exa's free MCP rate limit. To continue using without limits, create your own Exa API key.\n\n" +
  'Fix: Create API key at https://dashboard.exa.ai/api-keys , and then update Exa MCP URL to this https://mcp.exa.ai/mcp?exaApiKey=YOUR_EXA_API_KEY'

/**
 * @typedef {{ say: string[], randoms?: number[], steps: import('./stand-in.js').Step[] }} Turn
 * @typedef {{ passage: string, comment: string, randoms: number[] }} Comment
 * @typedef {{
 *   model: string,
 *   title: string,
 *   turns: Turn[],
 *   comments: { before: number, on: Comment[] },
 *   web: {
 *     searches: Record<string, { results?: Array<{ title: string, url: string, published?: string }>, limited?: boolean }>,
 *     pages: Record<string, { title?: string, published?: string }>,
 *   },
 * }} Game
 */

/** The papers, downloaded where they aren't here yet. */
async function files() {
  for (const { url, path } of FILES) {
    if (existsSync(path)) continue
    console.log(`  downloading ${url}`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Could not download ${url}: HTTP ${response.status}`)
    await writeFile(path, Buffer.from(await response.arrayBuffer()))
  }
}

/**
 * Answer Exa's MCP server from the game: its tools listed, a search with the
 * results it found, a page with its title. A search it found nothing for, or
 * a page it never read, is said to be missing, which shows in the replay.
 *
 * @param {import('playwright').BrowserContext} context
 * @param {Game['web']} web
 */
async function exaFromGame(context, web) {
  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
    'access-control-expose-headers': 'mcp-session-id',
  }
  /** @param {any} args */
  const search = args => {
    const found = web.searches[args?.query]
    if (!found) throw new Error(`The game has no search for “${args?.query}”`)
    if (found.limited) return EXA_LIMITED
    return (found.results || [])
      .map(r =>
        [
          `Title: ${r.title}`,
          `URL: ${r.url}`,
          ...(r.published ? [`Published: ${r.published}`] : []),
          'Highlights:',
          LEFT_OUT,
        ].join('\n')
      )
      .join('\n\n---\n\n')
  }
  /** @param {any} args */
  const page = args => {
    const url = args?.urls?.[0]
    const read = web.pages[url]
    if (!read) throw new Error(`The game never read ${url}`)
    return [
      ...(read.title ? [`# ${read.title}`] : []),
      `URL: ${url}`,
      ...(read.published ? [`Published: ${read.published}`] : []),
      '',
      LEFT_OUT,
    ].join('\n')
  }

  await context.route('https://mcp.exa.ai/**', async route => {
    const request = route.request()
    const method = request.method()
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (method === 'GET') return route.fulfill({ status: 405, headers: cors })
    if (method !== 'POST') return route.fulfill({ status: 200, headers: cors })
    const body = request.postDataJSON()
    if (!('id' in body)) return route.fulfill({ status: 202, headers: cors })
    const reply = (/** @type {object} */ result) =>
      route.fulfill({
        status: 200,
        headers: {
          ...cors,
          'content-type': 'application/json',
          'mcp-session-id': 'replay',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: body.id, result }),
      })
    if (body.method === 'initialize') {
      return reply({
        protocolVersion: body.params?.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'exa', version: 'replay' },
      })
    }
    if (body.method === 'tools/list') {
      const schema = { type: 'object', properties: {} }
      return reply({
        tools: [
          { name: 'web_search_exa', inputSchema: schema },
          { name: 'web_fetch_exa', inputSchema: schema },
        ],
      })
    }
    if (body.method === 'tools/call') {
      const { name, arguments: args } = body.params
      const text = name === 'web_search_exa' ? search(args) : page(args)
      return reply({ content: [{ type: 'text', text }] })
    }
    return reply({})
  })
}

/**
 * The words of a writer's turn the stand-in knows it by: its last line.
 *
 * @param {Turn} turn
 */
function matchOf(turn) {
  return (
    turn.say
      .flatMap(said => said.split('\n'))
      .filter(Boolean)
      .at(-1) || ''
  )
}

/**
 * @param {import('./capture.js').Helpers} ui
 * @param {{ standIn: Awaited<ReturnType<typeof import('./stand-in.js').startStandIn>>, context: import('playwright').BrowserContext }} session
 */
export async function research(ui, { standIn, context }) {
  const { page } = ui
  await files()
  const game = /** @type {Game} */ (JSON.parse(await readFile(GAME, 'utf8')))
  for (const [at, turn] of game.turns.entries()) {
    standIn.script({
      match: matchOf(turn),
      steps: turn.steps,
      ...(at === 0 ? { title: game.title } : {}),
    })
  }
  await exaFromGame(context, game.web)

  const button = (/** @type {string} */ name) => page.getByRole('button', { name, exact: true })
  const dialog = (/** @type {string} */ name) => page.getByRole('dialog', { name })
  const row = (/** @type {string} */ name) => page.getByRole('treeitem', { name, exact: true })
  const menu = (/** @type {string} */ name) => page.getByRole('menuitem', { name })
  const message = page.getByRole('textbox', { name: "Let's brainstorm…" })
  const settings = dialog('Settings')

  /** The draws the next tool calls or comments make, set out. */
  const setDraws = (/** @type {number[]} */ draws) =>
    page.evaluate(values => {
      const shared = /** @type {any} */ (window)
      shared.__toolRandomQueue = [...values]
      shared.__toolRandomLog = []
    }, draws)

  /**
   * The calls of the latest reply that came back with an error: none, when
   * the replay matches the session.
   */
  const failedCalls = () =>
    page.evaluate(async () => {
      const opened = indexedDB.open('inksprite')
      const db = /** @type {IDBDatabase} */ (
        await new Promise((resolve, reject) => {
          opened.onsuccess = () => resolve(opened.result)
          opened.onerror = reject
        })
      )
      const all = /** @type {any[]} */ (
        await new Promise((resolve, reject) => {
          const asked = db.transaction('messages').objectStore('messages').getAll()
          asked.onsuccess = () => resolve(asked.result)
          asked.onerror = reject
        })
      )
      const last = all
        .filter(m => m.role === 'assistant')
        .sort((a, b) => a.created - b.created)
        .at(-1)
      // A search the recording has as limited ends in the app's own word that
      // the free searches ran out, as it did in the session.
      return (last?.metadata?.apiTrajectory || [])
        .filter((/** @type {any} */ e) => e.role === 'tool' && /^\{"error"/.test(e.content || ''))
        .filter((/** @type {any} */ e) => !/free searches have run out/.test(e.content))
        .map((/** @type {any} */ e) => e.content.slice(0, 200))
    })

  /**
   * Take a turn: the lines typed, the reply waited for, and the calls checked.
   *
   * @param {Turn} turn
   * @param {number} minute - Past two in the afternoon, for the time it shows
   */
  async function take(turn, minute) {
    await context.clock.setSystemTime(new Date(Date.UTC(2026, 9, 1, 14, minute)))
    await setDraws(turn.randoms || [])
    await ui.click(message)
    const lines = turn.say.flatMap(said => said.split('\n'))
    for (const [at, line] of lines.entries()) {
      if (line) await ui.type(line)
      if (at < lines.length - 1) await ui.press('Shift+Enter')
    }
    await ui.press('Enter')
    await button('Stop generating').waitFor()
    await button('Send message').waitFor({ timeout: 120_000 })
    await ui.pause(500)
    const failed = await failedCalls()
    if (failed.length > 0) {
      throw new Error(`The replay went another way than the session:\n${failed.join('\n')}`)
    }
  }

  /**
   * Select a passage of the open document by dragging over it, as a hand
   * would.
   *
   * @param {string} passage
   */
  async function select(passage) {
    const box = await page.evaluate(text => {
      const root = /** @type {HTMLElement} */ (document.querySelector('.ProseMirror'))
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let node
      while ((node = /** @type {Text|null} */ (walker.nextNode()))) {
        const at = node.data.indexOf(text)
        if (at < 0) continue
        node.parentElement?.scrollIntoView({ block: 'center' })
        const range = document.createRange()
        range.setStart(node, at)
        range.setEnd(node, at + 1)
        const first = range.getBoundingClientRect()
        range.setStart(node, at + text.length - 1)
        range.setEnd(node, at + text.length)
        const last = range.getBoundingClientRect()
        return {
          from: { x: first.left + 1, y: first.top + first.height / 2 },
          to: { x: last.right - 1, y: last.top + last.height / 2 },
        }
      }
      throw new Error(`Nothing in the document says “${text}”`)
    }, passage)
    await ui.pause(300)
    await page.mouse.move(box.from.x, box.from.y, { steps: 8 })
    await page.mouse.down()
    await page.mouse.move(box.to.x, box.to.y, { steps: 24 })
    await page.mouse.up()
    await ui.pause(400)
  }

  /** @param {Comment} comment */
  async function leave(comment) {
    await setDraws(comment.randoms)
    await select(comment.passage)
    await ui.click(page.locator('[data-comment-button]'))
    // A card for it in the Comments tab, beside the text.
    await page.locator('[data-draft-field]').waitFor()
    await ui.type(comment.comment)
    await ui.press('Enter')
    await page.locator('[data-draft-field]').waitFor({ state: 'hidden' })
  }

  /** No toast over what a picture shows. */
  const quiet = () =>
    page
      .locator('.p-toast-message')
      .first()
      .waitFor({ state: 'detached', timeout: 15_000 })
      .catch(() => {})

  /** The outline in the sidebar, whatever was there. */
  const outline = async () => {
    if (!(await page.getByRole('heading', { name: 'Outline' }).isVisible()))
      await ui.click(button('Outline'))
    await page.getByRole('heading', { name: 'Outline' }).waitFor()
  }

  /**
   * Scroll the open document to a heading.
   *
   * @param {string} heading - Some of its words
   */
  const scrollDoc = async heading => {
    await page.evaluate(words => {
      const found = [
        ...document.querySelectorAll('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3'),
      ].find(h => (h.textContent || '').includes(words))
      if (!found) throw new Error(`No heading says “${words}”`)
      found.scrollIntoView({ block: 'start' })
    }, heading)
    await ui.pause(400)
  }

  /** Show a document in the editor, or a file in its viewer. */
  const show = async (/** @type {string} */ name, { file = false } = {}) => {
    await ui.click(row(name))
    await page
      .locator(file ? 'canvas' : '.ProseMirror')
      .first()
      .waitFor()
    await ui.pause(file ? 1500 : 400)
  }

  // Claude, made up, and Exa for the web
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
  await ui.click(page.getByRole('option', { name: game.model }))

  await ui.click(settings.getByRole('button', { name: 'Connections', exact: true }))
  await ui.click(page.getByRole('combobox', { name: 'Web search service' }))
  await ui.click(page.getByRole('option', { name: 'Exa' }))
  await settings.locator('[data-web-check]').waitFor()
  const searching = page.getByRole('switch', {
    name: 'Search the web in chats on Default',
  })
  // Default starts on, as a new install's does; this makes sure.
  for (let tries = 0; tries < 3 && !(await searching.isChecked()); tries++) {
    await ui.click(searching)
    await ui.pause(800)
  }
  if (!(await searching.isChecked())) throw new Error('Web search is not on for Default')
  await quiet()
  await ui.shot('research-web-search', { of: settings, pad: 0 })
  await ui.click(settings.getByRole('button', { name: 'Close' }))
  await settings.waitFor({ state: 'hidden' })

  // The project and its papers
  await ui.click(button('New project'))
  await ui.type(PROJECT)
  await ui.click(button('Create'))
  const project = page.locator(`[role="treeitem"][aria-level="1"][aria-label="${PROJECT}"]`)
  await project.waitFor()
  await ui.click(project.getByText(PROJECT).first(), { button: 'right' })
  await ui.click(menu('New folder'))
  await ui.type('Sources')
  await ui.press('Enter')
  await row('Sources').waitFor()
  await ui.click(row('Sources').getByText('Sources'), { button: 'right' })
  await ui.hover(menu('Import'))
  const chooser = page.waitForEvent('filechooser')
  await ui.click(menu('Files…'))
  await (await chooser).setFiles(FILES.map(file => file.path))
  await row('Local-first software').waitFor({ timeout: 120_000 })
  await row('Peritext').waitFor({ timeout: 120_000 })
  await quiet()
  await show('Peritext', { file: true })
  // The top of the paper: its title, and not its authors' addresses below.
  await ui.shot('research-sources', {
    region: { x: 0, y: 0, width: 1280, height: 560 },
  })

  // The research, as it went
  const [summarize, search, write, revise, review, fix] = game.turns
  await take(summarize, 2)
  await show('Peritext — summary')
  await ui.shot('research-summaries')

  await take(search, 6)
  await show('Yjs vs Automerge for rich text — current state')
  await ui.shot('research-web-calls')

  await take(write, 12)
  await show(DESIGN)
  await ui.shot('research-design-doc')

  // The writer's comments, the first one recorded
  const [first, ...others] = game.comments.on
  await ui.record('research-comment', async () => {
    await leave(first)
  })
  for (const comment of others) await leave(comment)
  // Commenting opened the Comments tab.
  await page.getByRole('heading', { name: 'Comments' }).waitFor()
  await page.getByText(first.comment).first().waitFor()
  await ui.shot('research-comments')
  await outline()

  await take(revise, 20)
  await show(DESIGN)
  await scrollDoc('Network topology')
  await ui.shot('research-revised')

  await ui.click(button('Hide editor'))
  await take(review, 24)
  // The writer's request at the top, and the review under it.
  await page
    .getByText('Now review the design doc')
    .first()
    .evaluate(element => element.scrollIntoView({ block: 'start' }))
  await page.mouse.move(900, 400)
  await page.mouse.wheel(0, -60)
  await ui.pause(400)
  await ui.shot('research-review')
  await ui.click(button('Show editor'))
  await outline()

  await take(fix, 30)
  await show(DESIGN)
  await scrollDoc('Recommendation')
  await ui.shot('research-fixed')
}
