/**
 * The pictures the feature pages show: projects, the editor, chats, skills,
 * workflows, a code repository and an MCP server, taken in one profile in the
 * order below. Every text a reader sees here is made up for the pages; the
 * prologue is a draft by inksprite's author, and the codebase is inksprite's
 * own, as committed.
 *
 * The model is Anthropic's stand-in, with replies written for the pages. The
 * MCP server is the real DeepWiki, the one the MCP page has readers try: the
 * page reaches it and nothing else outside, and the model's call to it is
 * denied, so nothing is asked of it but its tools.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** A made-up key: the stand-in takes any. */
const ANTHROPIC_KEY = 'sk-ant-made-up-for-the-guide'

const PROJECT = 'Thief'

/** The repository this runs in, whose code the repository pages import. */
const REPOSITORY = fileURLToPath(new URL('../..', import.meta.url))

/** What the public repository leaves out, so no picture shows it. */
const PRIVATE = ['.llm', 'docs/capture/pg84-images-3.epub']

/** A first draft, faults and all: the review picks at them. */
const PROLOGUE = [
  '# Burglary',
  'The thief slipped quietly through the window, its broken latch dangling uselessly from the sash. She listened intently for a moment, then stepped lightly to the floor, her soft-soled boots making almost no sound on the boards. Satisfied that she was still undetected, she turned and pushed the shutters closed, being careful to avoid making any noise.',
  'She turned her attention to the shop itself, scanning the shadows of the cluttered room for any sign of movement. It took a few moments for her eyes to adjust to the darkness, the only light being thin slivers of moonlight that shone in between the slats of the shuttered window behind her.',
  'She could just make out the shape of the counter against the far wall, and she approached it slowly, maneuvering around cluttered shelves, display cases, and other miscellany that littered the floor of the shop. She cringed at the soft creak of a loose board and froze in place for a moment, holding her breath as she listened. Hearing nothing, she let out a soft sigh of relief, and resumed her slow, careful journey across the room.',
  'When she finally reached the counter, she hoisted herself up and climbed over it, lowering herself silently down onto the floor on the other side. She felt for the lock on the drawer below the counter and slid a thin metal pick into the mechanism. It was too dark to see, but her practiced fingers deftly worked the pick against the pins while she applied gentle tension to the lock with a small metal shim in her other hand. One by one, she felt the pins set into place, and finally the lock released and rotated with a soft click.',
  'She eased the drawer open slowly and reached inside, her fingers gliding over a small pile of copper and silver coins. Not as much as she had hoped for, but it would be enough to keep her fed for a few more weeks. Slowly and carefully, she extracted the coins from the drawer, wrapping each in a strip of cotton before placing it in the small bag slung over her shoulder.',
]

const CHAPTER_1 = [
  '# Fulke',
  'Fulke kept his shop behind the tannery, where nobody came by accident. He was at his table when she came in, walking a coin across his knuckles the way he did when he wanted to look busy.',
  'She tipped the bag out in front of him: the coppers, the silver, and the thing she had taken for a coin until she saw it by daylight. It was too heavy for its size, and there was no king on it, only a key on both sides.',
  'Fulke counted the coppers. He counted the silver. He did not touch the third thing, and when she pushed it towards him he took his hands off the table.',
  '“Take it back,” he said. “Tonight.”',
]

/** A list: the first line starts it, and Enter makes each next item. */
const OUTLINE = [
  '- Prologue: a thief robs a pawnshop in the Merchant’s Quarter. One of the coins isn’t a coin.',
  'Chapter 1: Yvette takes the token to Fulke, who won’t buy it or touch it.',
  'Chapter 2: the Watch comes to the pawnshop, and someone comes after the Watch.',
  'Chapter 3: Nicola finds Yvette in the cistern before they do.',
]

const SUMMARY =
  'A dark fantasy in a walled city around 1500. A thief robs a pawnshop to eat, and takes something that isn’t a coin. Draft one: the prologue and a chapter.'

/** A question in the chat, and the answer the pages show. */
const HOW_IT_ENDS = {
  match: 'How could the book end',
  title: 'Endings',
  steps: [
    { tool: 'read_document', args: { path: 'Notes/Plot Outline' } },
    {
      text:
        'Three ways it could end, from the outline:\n\n' +
        '1. **Yvette takes the token back.** The pawnbroker was keeping it for someone, and she meets them on her way out.\n' +
        '2. **She spends it.** It opens a door under the city, and the last chapter is what she owes for going through.\n' +
        '3. **It was Nicola’s all along.** Nicola hid it in the drawer to be stolen, and Yvette did her a favour she never meant to.\n\n' +
        'The third pays off the prologue best.',
    },
  ],
}

/** The review skill the skills page makes, as its SKILL.md. */
const REVIEW_SKILL = `---
name: review
description: >-
  Critique a draft the way an editor would: what works, where it drags or loses
  the reader, and the one change that would help most.
disable-model-invocation: true
context: fork
arguments: document
argument-hint: the document to review
allowed-tools: read_document list_documents
---

You are an editor reading a draft for its writer. Read $document with
read_document, all of it, before you say anything.

Then write a short critique:

- What works, in two or three sentences.
- Where the pace drags or the reader could get lost, quoting the lines you mean.
- The one change that would help most.

Don't rewrite the draft, and don't praise what doesn't earn it.
`

/** What the review skill says, run on its own. */
const REVIEW = {
  system: 'You are an editor reading a draft for its writer',
  steps: [
    { tool: 'read_document', args: { path: 'Manuscript/Prologue' } },
    {
      text:
        '**What works.** The order is always clear, and the creaking board is the best moment: something happens, she freezes, and we hold our breath with her. Wrapping each coin in cotton says more about her than any adverb.\n\n' +
        '**Where it drags.** It keeps telling us she is quiet: “slipped quietly”, “stepped lightly”, “almost no sound”, “being careful to avoid making any noise”. After the second the reader has it, and the rest drains the tension.\n\n' +
        '**The one change.** Give it a turn. She gets in, takes the coins and nothing goes wrong. One thing in the drawer she didn’t expect would earn the prologue its place.',
    },
  ],
}

/**
 * inksprite's own code as committed, in a folder named `inksprite` in a new
 * temporary one: the files git tracks at HEAD, without the private ones. The
 * checkout itself also holds node_modules and the rest, which the browser
 * would be handed whole.
 *
 * @returns {{ folder: string, remove: () => void }}
 */
function copyOfInksprite() {
  const parent = mkdtempSync(join(tmpdir(), 'inksprite-capture-'))
  const folder = join(parent, 'inksprite')
  mkdirSync(folder)
  const tar = execFileSync(
    'git',
    ['-C', REPOSITORY, 'archive', '--format=tar', 'HEAD', '--', '.'].concat(
      PRIVATE.map(path => `:(exclude)${path}`)
    ),
    { maxBuffer: 1 << 30 }
  )
  execFileSync('tar', ['-x', '-C', folder], { input: tar })
  return { folder, remove: () => rmSync(parent, { recursive: true, force: true }) }
}

/**
 * A question about inksprite's code, and the answer the page shows. Its line
 * numbers are looked up in the copy, so they follow the code; a change that
 * makes the answer wrong stops the run, for it to be written again.
 *
 * @param {string} folder - The copy
 */
function countingWords(folder) {
  /** @param {string} path @param {RegExp} pattern */
  const lineOf = (path, pattern) => {
    const at = readFileSync(join(folder, path), 'utf8')
      .split('\n')
      .findIndex(line => pattern.test(line))
    if (at < 0) throw new Error(`${path} no longer matches ${pattern}: write the answer again`)
    return at + 1
  }
  const file = 'app/src/utils/wordCount.js'
  const counts = lineOf(file, /^export function countWords\(/)
  lineOf(file, /stripMarkdown\(withoutComments\(content\)\.replace\(PICTURE, ' '\)\)/)
  const keeps = lineOf(file, /\.filter\(word => \/\[\\p\{L\}\\p\{N\}\]\/u/)
  const strips = lineOf('app/src/utils/markdown.js', /^export function stripMarkdown\(/)
  const comments = lineOf('app/src/editor/comments.js', /^export function withoutComments\(/)
  return {
    match: 'How does inksprite count the words',
    title: 'Counting words',
    steps: [
      { tool: 'search_documents', args: { query: 'countWords' } },
      { tool: 'read_document', args: { path: `inksprite/${file}` } },
      {
        text:
          `\`countWords\` in **inksprite/${file}:${counts}** does it. It takes out your comments with \`withoutComments\` (**app/src/editor/comments.js:${comments}**), then any pictures, and the Markdown with \`stripMarkdown\` (**app/src/utils/markdown.js:${strips}**). It splits what is left on whitespace and keeps the runs with a letter or a digit in them (line ${keeps}).\n\n` +
          'So a rule, a bare dash or a stray `|` from a table isn’t a word, and nor is anything you wrote in a comment or a picture’s alt text.',
      },
    ],
  }
}

/** The model reaching for DeepWiki, which the page has the reader allow. */
const DEEPWIKI = {
  match: 'Using DeepWiki',
  title: 'React state updates',
  steps: [
    {
      tool: 'deepwiki__ask_wiki_question',
      args: { repoName: 'facebook/react', question: 'How does React batch state updates?' },
    },
    { text: 'DeepWiki wasn’t allowed to answer, so I can’t say from the source.' },
  ],
}

/**
 * @param {import('./capture.js').Helpers} ui
 * @param {{ standIn: Awaited<ReturnType<typeof import('./stand-in.js').startStandIn>>, context: import('playwright').BrowserContext }} session
 */
export async function features(ui, { standIn, context }) {
  const { page } = ui
  const code = copyOfInksprite()
  for (const script of [HOW_IT_ENDS, REVIEW, countingWords(code.folder), DEEPWIKI])
    standIn.script(script)
  // DeepWiki, for real: the one place outside the page may reach.
  await context.route('https://mcp.deepwiki.com/**', route => route.continue())

  const button = (/** @type {string} */ name) => page.getByRole('button', { name, exact: true })
  const dialog = (/** @type {string} */ name) => page.getByRole('dialog', { name })
  const row = (/** @type {string} */ name) => page.getByRole('treeitem', { name, exact: true })
  const menu = (/** @type {string} */ name) => page.getByRole('menuitem', { name })
  const message = page.getByRole('textbox', { name: "Let's brainstorm…" })
  const settings = dialog('Settings')
  const editor = page.locator('.ProseMirror').first()
  const at = (/** @type {number} */ minute) =>
    context.clock.setSystemTime(new Date(Date.UTC(2026, 9, 1, 10, minute)))

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

  /** A project of this name: from the invitation, or with one open, from the projects menu. */
  const newProject = async (/** @type {string} */ name) => {
    if (await button('Projects').isVisible()) {
      await ui.click(button('Projects'))
      await ui.click(menu('New project…'))
    } else await ui.click(button('New project'))
    await ui.type(name)
    await ui.click(button('Create'))
  }

  /**
   * A document with these lines, in the folder the row is, or the project.
   *
   * @param {import('playwright').Locator} parent
   * @param {string} name
   * @param {string[]} lines
   */
  async function write(parent, name, lines) {
    await ui.click(parent, { button: 'right' })
    await ui.click(menu('New document'))
    await ui.type(name)
    await ui.press('Enter')
    await row(name).waitFor()
    await ui.click(editor)
    for (const [index, line] of lines.entries()) {
      if (line) await ui.type(line)
      if (index < lines.length - 1) await page.keyboard.press('Enter')
    }
    await ui.pause(300)
  }

  /**
   * An empty document, a placeholder, with its tab closed again so the tabs
   * keep to what is written.
   *
   * @param {import('playwright').Locator} parent
   * @param {string} name
   */
  async function placeholder(parent, name) {
    await ui.click(parent, { button: 'right' })
    await ui.click(menu('New document'))
    await ui.type(name)
    await ui.press('Enter')
    await row(name).waitFor()
    await ui.click(button(`Close ${name}`))
  }

  /** @param {string} name */
  async function folder(parent, name) {
    await ui.click(parent, { button: 'right' })
    await ui.click(menu('New folder'))
    await ui.type(name)
    await ui.press('Enter')
    await row(name).waitFor()
  }

  /** Have a folder, or the project, keep its documents in the order they're put in. */
  async function keepInOrder(/** @type {import('playwright').Locator} */ parent) {
    await ui.click(parent, { button: 'right' })
    await ui.click(menu('Keep in order'))
  }

  /** Send a turn, and wait for its reply. */
  async function send(/** @type {string} */ text) {
    await ui.click(message)
    await ui.type(text)
    await ui.press('Enter')
    await button('Stop generating').waitFor()
    await button('Send message').waitFor({ timeout: 60_000 })
    await ui.pause(500)
  }

  /** Open the settings at a section. */
  async function openSettings(/** @type {string} */ section) {
    await ui.click(button('Settings'))
    await ui.click(settings.getByRole('button', { name: section, exact: true }))
  }

  async function closeSettings() {
    await ui.click(settings.getByRole('button', { name: 'Close' }))
    await settings.waitFor({ state: 'hidden' })
  }

  // A provider, made up
  await at(0)
  await ui.goto('/')
  await dialog('Welcome').waitFor()
  await ui.click(button('Start writing'))
  await openSettings('AI')
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

  // Workflows: the model a conversion runs on
  await ui.click(settings.getByRole('button', { name: 'Workflows', exact: true }))
  const convert = settings.locator('[data-workflow="convert"]')
  await ui.click(convert.getByRole('combobox', { name: 'Provider', exact: true }))
  await ui.click(page.getByRole('option', { name: 'Anthropic' }))
  await ui.click(convert.getByRole('combobox', { name: 'Model' }))
  await ui.click(page.getByRole('option', { name: 'Claude Haiku 5.5' }))
  await quiet()
  await ui.shot('files-workflows', { of: settings, pad: 0 })
  await closeSettings()

  // Two other projects, so the switcher has something to list
  for (const [minute, name] of [
    [5, 'Field notes'],
    [20, 'Letters home'],
  ]) {
    await at(/** @type {number} */ (minute))
    await newProject(/** @type {string} */ (name))
    await page.getByRole('treeitem', { name: /** @type {string} */ (name) }).waitFor()
  }

  // The project the pages use, laid out as a novel's might be
  await at(40)
  await newProject(PROJECT)
  const project = page.locator(`[role="treeitem"][aria-level="1"][aria-label="${PROJECT}"]`)
  await project.waitFor()
  const top = project.getByText(PROJECT).first()
  /** A folder's row, to right-click. */
  const inside = (/** @type {string} */ name) => row(name).getByText(name, { exact: true })
  await keepInOrder(top)
  await folder(top, 'Manuscript')
  await keepInOrder(inside('Manuscript'))
  await write(inside('Manuscript'), 'Prologue', PROLOGUE)
  await write(inside('Manuscript'), 'Chapter 1', CHAPTER_1)
  await folder(top, 'Characters')
  for (const name of ['Yvette', 'Nicola', 'Fulke']) await placeholder(inside('Characters'), name)
  await folder(top, 'Places')
  for (const name of ['Basilica Cistern', "Merchant's Quarter"])
    await placeholder(inside('Places'), name)
  await folder(top, 'World')
  await placeholder(inside('World'), 'Crime and Punishment')
  await folder(top, 'Notes')
  await write(inside('Notes'), 'Plot Outline', OUTLINE)

  // The project's settings
  await ui.click(top, { button: 'right' })
  await ui.click(menu('Project settings'))
  const projectSettings = dialog('Project settings')
  await projectSettings.waitFor()
  await ui.paste(projectSettings.locator('textarea'), SUMMARY)
  await ui.shot('projects-settings', { of: projectSettings })
  await ui.click(projectSettings.getByRole('button', { name: 'Save' }))
  await projectSettings.waitFor({ state: 'hidden' })

  // The switcher
  await at(55)
  await ui.click(button('Projects'))
  await ui.click(menu('Switch project'))
  await page.getByRole('menuitem', { name: /Field notes/ }).waitFor()
  await ui.shot('projects-switcher', { region: { x: 0, y: 0, width: 640, height: 400 } })
  await ui.press('Escape')

  // Find and replace
  await ui.click(row('Prologue'))
  await ui.click(editor)
  await ui.press('ControlOrMeta+f')
  await page.getByRole('textbox', { name: 'Find' }).waitFor()
  await ui.type('counter')
  await ui.click(page.getByRole('button', { name: 'Show replace' }))
  await ui.click(page.getByRole('textbox', { name: 'Replace with' }))
  await ui.type('counting table')
  await quiet()
  await ui.shot('editor-find')
  await ui.press('Escape')

  // A link
  await ui.click(editor)
  await page.evaluate(() => {
    const root = /** @type {HTMLElement} */ (document.querySelector('.ProseMirror'))
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node
    while ((node = /** @type {Text|null} */ (walker.nextNode()))) {
      const at = node.data.indexOf('thin metal pick')
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + 'thin metal pick'.length)
      const selection = getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
  })
  await ui.pause(300)
  await ui.press('ControlOrMeta+k')
  await ui.type('https://example.com/lock-picks')
  await ui.press('Enter')
  await ui.pause(300)
  await ui.click(page.locator('.ProseMirror a').first())
  await page.getByRole('button', { name: 'Remove' }).waitFor()
  await ui.shot('editor-link', {
    of: [page.locator('.ProseMirror a').first(), button('Remove')],
    pad: 120,
  })
  await ui.press('Escape')

  // A picture: a map drawn for the guide, pasted as a screenshot would be,
  // on a line of its own, and given its alt text, in the place it maps.
  await ui.click(row("Merchant's Quarter"))
  await ui.click(editor)
  await ui.type('Stalls from the north gate down to the cistern.')
  await page.keyboard.press('Enter')
  await ui.pause(300)
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 960
    canvas.height = 540
    const c = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'))
    c.fillStyle = '#efe4c8'
    c.fillRect(0, 0, 960, 540)
    c.fillStyle = '#b9d3e0'
    c.fillRect(0, 430, 960, 110)
    c.strokeStyle = '#8a7a5c'
    c.lineWidth = 14
    for (const [x1, y1, x2, y2] of [
      [480, 40, 480, 430],
      [120, 220, 840, 220],
      [220, 360, 760, 120],
    ]) {
      c.beginPath()
      c.moveTo(x1, y1)
      c.lineTo(x2, y2)
      c.stroke()
    }
    c.fillStyle = '#c9b27f'
    for (const [x, y, w, h] of [
      [300, 250, 120, 70],
      [540, 250, 140, 80],
      [560, 130, 110, 60],
    ])
      c.fillRect(x, y, w, h)
    c.fillStyle = '#9fc0d0'
    c.beginPath()
    c.arc(250, 330, 26, 0, Math.PI * 2)
    c.fill()
    c.fillStyle = '#4a3f2c'
    c.font = '600 28px Inter, sans-serif'
    c.fillText('North gate', 500, 70)
    c.fillText("Merchant's Quarter", 130, 190)
    c.fillText('Cistern', 140, 390)
    c.fillText('River', 820, 490)
    const blob = await new Promise(done => canvas.toBlob(done, 'image/png'))
    const clipboard = new DataTransfer()
    clipboard.items.add(new File([/** @type {Blob} */ (blob)], 'image.png', { type: 'image/png' }))
    document
      .querySelector('.ProseMirror')
      ?.dispatchEvent(new ClipboardEvent('paste', { clipboardData: clipboard, bubbles: true }))
  })
  const picture = page.locator('.ProseMirror .picture').first()
  await picture.locator('img').waitFor()
  await ui.click(picture)
  await ui.click(page.getByRole('textbox', { name: 'Alt text' }))
  await ui.type("A map of the Merchant's Quarter")
  await ui.press('Enter')
  await ui.click(picture)
  await page.locator('[data-picture-popover]').waitFor()
  await quiet()
  await ui.shot('editor-picture', {
    of: [
      page.locator('.ProseMirror p').filter({ hasText: 'Stalls from the north gate' }),
      picture,
      page.locator('[data-picture-popover]'),
    ],
  })
  await ui.press('Escape')
  // Its tab closed again, so the tabs keep to the ones the guide shows.
  await ui.click(button("Close Merchant's Quarter"))

  // A table
  await write(inside('World'), 'Coinage and Trade', ['| Coin | Metal | Worth |'])
  await page.keyboard.press('Enter')
  /** @param {string[]} cells */
  const fill = async cells => {
    for (const [i, cell] of cells.entries()) {
      if (i > 0) await page.keyboard.press('Tab')
      await page.keyboard.insertText(cell)
    }
  }
  await fill(['Crown', 'Gold', 'Five shillings'])
  // No key adds a row: the menu does, and leaves the caret in it.
  await ui.click(page.locator('.ProseMirror td').filter({ hasText: 'Crown' }), { button: 'right' })
  await ui.hover(page.getByRole('menuitem', { name: 'Table', exact: true }))
  await ui.pause(300)
  await ui.click(menu('Insert row below'))
  await fill(['Groat', 'Silver', 'Four pence'])
  await ui.click(page.locator('.ProseMirror td').filter({ hasText: 'Four pence' }), {
    button: 'right',
  })
  // Exactly, or Delete table in its submenu is a Table too.
  await ui.hover(page.getByRole('menuitem', { name: 'Table', exact: true }))
  await ui.pause(300)
  await ui.hover(menu('Align column'))
  await ui.pause(300)
  await ui.shot('editor-table-menu')
  await ui.press('Escape')
  await ui.press('Escape')

  // A pin, and what a row offers
  await ui.click(row('Plot Outline'))
  await row('Plot Outline').hover()
  await ui.click(row('Plot Outline').getByRole('button', { name: 'Pin to this chat' }))
  await row('Plot Outline').getByRole('button', { name: 'Pinned to this chat' }).waitFor()
  await ui.shot('chat-pinned', {
    of: [button('Projects'), row('Plot Outline')],
    pad: 12,
  })

  // A chat, its answers and a turn's menu, with the chat wide
  await ui.click(button('Hide editor'))
  await at(42)
  await send('How could the book end? Give me three ways.')
  await ui.click(button('Regenerate reply').last())
  await button('Stop generating').waitFor()
  await button('Send message').waitFor()
  await ui.pause(500)
  const reply = page.getByText('The third pays off the prologue best.').last()
  const turn = reply.locator('xpath=ancestor::*[.//button[@aria-label="More actions"]][1]')
  await turn.hover()
  const more = turn.getByRole('button', { name: 'More actions' }).first()
  await more.scrollIntoViewIfNeeded()
  await ui.pause(500)
  await ui.click(more)
  await menu('Fork from here').waitFor()
  await ui.shot('chat-turn-menu')
  await ui.press('Escape')

  // The commands
  await ui.click(message)
  await ui.type('/')
  await page.getByRole('listbox', { name: 'Commands' }).waitFor()
  await ui.shot('chat-command-menu')
  await ui.press('Escape')
  await page.keyboard.press('Backspace')

  // The chat's settings
  await ui.click(button('Chat settings'))
  await ui.click(button('Tools'))
  await ui.pause(400)
  await ui.shot('chat-settings')
  await ui.click(button('Back to chat'))

  // A skill of one's own
  await openSettings('Skills')
  await ui.click(settings.getByRole('button', { name: 'New skill' }))
  await ui.click(settings.locator('[data-mode="file"]'))
  await ui.paste(settings.getByRole('textbox', { name: 'SKILL.md' }), REVIEW_SKILL)
  await ui.click(settings.getByRole('button', { name: 'Save' }))
  await settings.getByText('/review').first().waitFor()
  await ui.shot('skills-library', { of: settings, pad: 0 })
  await closeSettings()

  await at(46)
  await ui.click(button('New chat').last())
  await ui.click(message)
  await ui.type('/review Manuscript/Prologue')
  await ui.press('Enter')
  await page.getByText('The one change.').waitFor({ timeout: 60_000 })
  await button('Send message').waitFor()
  await ui.pause(500)
  await ui.shot('skill-review-turn')
  await ui.click(button('Show editor'))
  await outline()

  // A codebase, inksprite's own, in a project for writing about it
  await at(48)
  await newProject('Release notes')
  const notes = page.locator('[role="treeitem"][aria-level="1"][aria-label="Release notes"]')
  await notes.waitFor()
  await ui.click(notes.getByText('Release notes').first(), { button: 'right' })
  await ui.hover(menu('Import'))
  const chooser = page.waitForEvent('filechooser')
  await ui.click(menu('Folder…'))
  await (await chooser).setFiles(code.folder)
  await ui.click(page.getByRole('button', { name: 'Import as repository' }))
  await page.getByText(/inksprite imported:/).waitFor({ timeout: 300_000 })
  code.remove()
  await quiet()
  for (const name of ['app', 'src', 'utils']) await ui.click(row(name))
  await ui.click(row('wordCount.js'))
  await page.locator('.cm-content').first().waitFor()
  await ui.pause(600)
  await ui.shot('repository-code-view')

  // The new project's chat, still empty
  await at(50)
  await send('How does inksprite count the words in a document?')
  await ui.shot('repository-chat')

  // An MCP server: DeepWiki, as the page adds it
  await openSettings('Connections')
  await ui.click(settings.getByRole('button', { name: 'Add a server' }))
  await ui.paste(settings.getByRole('textbox', { name: 'Address' }), 'https://mcp.deepwiki.com/mcp')
  await ui.paste(settings.locator('[data-field="name"]'), 'DeepWiki')
  await ui.click(settings.getByRole('button', { name: 'Connect', exact: true }))
  await settings.getByRole('button', { name: 'Keep it' }).waitFor({ timeout: 30_000 })
  await settings.getByRole('button', { name: 'Keep it' }).scrollIntoViewIfNeeded()
  await quiet()
  await ui.shot('mcp-add-server', { of: settings, pad: 0 })
  await ui.click(settings.getByRole('button', { name: 'Keep it' }))
  await ui.click(settings.getByText('DeepWiki').first())
  await settings.getByText('Always allow all of them').waitFor()
  await ui.shot('mcp-server-tools', { of: settings, pad: 0 })
  await closeSettings()

  await at(58)
  await ui.click(button('Hide editor'))
  await ui.click(button('New chat').last())
  await ui.click(message)
  await ui.type('Using DeepWiki, find out how the facebook/react repository batches state updates.')
  await ui.press('Enter')
  await page.getByText(/wants to run/).waitFor({ timeout: 60_000 })
  await ui.pause(400)
  await ui.shot('mcp-approval')
  await ui.click(button('Deny'))
  await button('Send message').waitFor()
}
