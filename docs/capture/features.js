/**
 * The pictures the feature pages show: projects, the editor, chats, skills,
 * workflows, a code repository and an MCP server, taken in one profile in the
 * order below. Every text a reader sees here is made up for the pages, and so
 * is the codebase in `fixtures/tide-clock`.
 *
 * The model is Anthropic's stand-in, with replies written for the pages. The
 * MCP server is the real DeepWiki, the one the MCP page has readers try: the
 * page reaches it and nothing else outside, and the model's call to it is
 * denied, so nothing is asked of it but its tools.
 */

import { fileURLToPath } from 'node:url'

/** A made-up key: the stand-in takes any. */
const ANTHROPIC_KEY = 'sk-ant-made-up-for-the-guide'

const PROJECT = 'The Lighthouse'

/** The codebase the repository pages import. */
const CODEBASE = fileURLToPath(new URL('fixtures/tide-clock', import.meta.url))

const CHAPTER_1 = [
  '# The lamp',
  'The lamp had not gone out in forty years. Tonight it flickered.',
  'Mara counted the beats between the flashes the way her father had taught her: one for the rocks, two for the shoals, three for come home. It was none of those.',
  'She climbed the stairs with the lantern in one hand. At the top, Mara found the logbook open at a page she had never seen, in a hand that was not her father’s.',
  'Read the tide tables, it said, and nothing else. Mara read them twice.',
]

const CHAPTER_3 = [
  '# The boat',
  'The supply boat came a day early, which it had never done. Mara watched it from the gallery until she could read the name on its bow, and then she went down to meet it.',
  'The man at the oars did not tie up. He held the boat off the rocks with one oar and called up to her that he had a barrel for the lighthouse, and that nobody had paid for it.',
  'She told him to take it back. He said he could not, and rolled it onto the landing, and was gone before the tide turned.',
]

const OUTLINE = [
  '- Chapter 1: the lamp flickers, and Mara finds the logbook.',
  '- Chapter 2: the tide tables are wrong by an hour.',
  '- Chapter 3: a barrel nobody ordered.',
  '- Chapter 4: Mara answers the light.',
]

const SUMMARY =
  'A novel about a lighthouse keeper’s daughter who finds a message in the flicker of the lamp. Draft one: three chapters of six.'

/** A question in the chat, and the answer the pages show. */
const HOW_IT_ENDS = {
  match: 'How could the book end',
  title: 'Endings',
  steps: [
    { tool: 'read_document', args: { path: 'Notes/Outline' } },
    {
      text:
        'Three ways it could end, from the outline:\n\n' +
        '1. **Mara answers the light** and the ship that has been signalling turns for home.\n' +
        '2. **Nobody is signalling.** The flicker is the lamp failing, and the last chapter is her keeping it lit by hand.\n' +
        '3. **The message was for her father.** She answers it in his place.\n\n' +
        'The third pays off the logbook best.',
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
    { tool: 'read_document', args: { path: 'Drafts/Chapter 3' } },
    {
      text:
        '**What works.** The boat arriving a day early is a good jolt: the rhythm of the island breaks, and we feel it before Mara says anything.\n\n' +
        '**Where it drags.** “She told him to take it back. He said he could not” reports an argument we would rather hear. Two lines of dialogue would do more.\n\n' +
        '**The one change.** End on the barrel, not the tide. Cut the last clause and the chapter closes on the thing nobody paid for.',
    },
  ],
}

/** A question about the codebase. */
const TIDES = {
  match: 'How does the clock work out the next high tide',
  title: 'Next high tide',
  steps: [
    { tool: 'search_documents', args: { query: 'nextHighTide' } },
    { tool: 'read_document', args: { path: 'tide-clock/src/tides.js' } },
    {
      text:
        '`nextHighTide` in **tide-clock/src/tides.js:13** does it. It takes the hours since 1 January, counts how many tides of `TIDE_HOURS` (12.42 hours, line 4) have passed since the station’s first high tide, and rounds up to the next one.\n\n' +
        'The station’s first high tide comes from **src/stations.js:2**, and **src/clock.js:6** asks for the next one once a minute.',
    },
  ],
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
  for (const script of [HOW_IT_ENDS, REVIEW, TIDES, DEEPWIKI]) standIn.script(script)
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

  /** @param {string} name */
  async function folder(parent, name) {
    await ui.click(parent, { button: 'right' })
    await ui.click(menu('New folder'))
    await ui.type(name)
    await ui.press('Enter')
    await row(name).waitFor()
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
    await ui.click(button('New project'))
    await ui.type(/** @type {string} */ (name))
    await ui.click(button('Create'))
    await page.getByRole('treeitem', { name: /** @type {string} */ (name) }).waitFor()
  }

  // The project the pages use
  await at(40)
  await ui.click(button('New project'))
  await ui.type(PROJECT)
  await ui.click(button('Create'))
  const project = page.locator(`[role="treeitem"][aria-level="1"][aria-label="${PROJECT}"]`)
  await project.waitFor()
  const top = project.getByText(PROJECT).first()
  await folder(top, 'Drafts')
  await write(row('Drafts').getByText('Drafts'), 'Chapter 1', CHAPTER_1)
  await write(row('Drafts').getByText('Drafts'), 'Chapter 3', CHAPTER_3)
  await folder(top, 'Notes')
  await write(row('Notes').getByText('Notes'), 'Outline', OUTLINE)

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
  await page.getByRole('menuitem', { name: /Field notes/ }).waitFor()
  await ui.shot('projects-switcher', { region: { x: 0, y: 0, width: 640, height: 400 } })
  await ui.press('Escape')

  // Find and replace
  await ui.click(row('Chapter 1'))
  await ui.click(editor)
  await ui.press('ControlOrMeta+f')
  await page.getByRole('textbox', { name: 'Find' }).waitFor()
  await ui.type('Mara')
  await ui.click(page.getByRole('button', { name: 'Show replace' }))
  await ui.click(page.getByRole('textbox', { name: 'Replace with' }))
  await ui.type('Ilse')
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
      const at = node.data.indexOf('tide tables')
      if (at < 0) continue
      const range = document.createRange()
      range.setStart(node, at)
      range.setEnd(node, at + 'tide tables'.length)
      const selection = getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }
  })
  await ui.pause(300)
  await ui.press('ControlOrMeta+k')
  await ui.type('https://example.com/tide-tables')
  await ui.press('Enter')
  await ui.pause(300)
  await ui.click(page.locator('.ProseMirror a').first())
  await page.getByRole('button', { name: 'Remove' }).waitFor()
  await ui.shot('editor-link', {
    of: [page.locator('.ProseMirror a').first(), button('Remove')],
    pad: 120,
  })
  await ui.press('Escape')

  // A table
  await write(row('Notes').getByText('Notes'), 'Characters', ['| Name | Role | First seen |'])
  await page.keyboard.press('Enter')
  for (const cell of [
    'Mara',
    'Keeper’s daughter',
    'Chapter 1',
    'The boatman',
    'Brings the barrel',
    'Chapter 3',
  ]) {
    await page.keyboard.insertText(cell)
    await page.keyboard.press('Tab')
  }
  await page.keyboard.press('Backspace')
  await ui.click(page.locator('.ProseMirror td').filter({ hasText: 'Brings the barrel' }), {
    button: 'right',
  })
  await ui.hover(menu('Align column'))
  await ui.pause(300)
  await ui.shot('editor-table-menu')
  await ui.press('Escape')
  await ui.press('Escape')

  // A pin, and what a row offers
  await ui.click(row('Outline'))
  await row('Outline').hover()
  await ui.click(row('Outline').getByRole('button', { name: 'Pin to this chat' }))
  await row('Outline').getByRole('button', { name: 'Pinned to this chat' }).waitFor()
  await ui.shot('chat-pinned', {
    of: [page.getByRole('heading', { name: 'Outline' }), row('Outline')],
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
  const reply = page.getByText('The third pays off the logbook best.').last()
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
  await ui.type('/review Drafts/Chapter 3')
  await ui.press('Enter')
  await page.getByText('The one change.').waitFor({ timeout: 60_000 })
  await button('Send message').waitFor()
  await ui.pause(500)
  await ui.shot('skill-review-turn')
  await ui.click(button('Show editor'))
  await outline()

  // A codebase
  await ui.click(top, { button: 'right' })
  await ui.hover(menu('Import'))
  const chooser = page.waitForEvent('filechooser')
  await ui.click(menu('Folder…'))
  await (await chooser).setFiles(CODEBASE)
  await ui.click(page.getByRole('button', { name: 'Import as repository' }))
  await row('tide-clock').waitFor({ timeout: 60_000 })
  await quiet()
  await ui.click(row('src'))
  await ui.click(row('tides.js'))
  await page.locator('.cm-content').first().waitFor()
  await ui.pause(600)
  await ui.shot('repository-code-view')

  await at(50)
  await ui.click(button('New chat').last())
  await send('How does the clock work out the next high tide?')
  await ui.shot('repository-chat')

  // An MCP server: DeepWiki, as the page adds it
  await openSettings('Connections')
  await ui.click(settings.getByRole('button', { name: 'Add a server' }))
  await ui.paste(settings.getByRole('textbox', { name: 'Address' }), 'https://mcp.deepwiki.com/mcp')
  await ui.paste(settings.locator('[data-field="name"]'), 'DeepWiki')
  await ui.click(settings.getByRole('button', { name: 'Connect', exact: true }))
  await settings.getByText('ask_wiki_question').first().waitFor({ timeout: 30_000 })
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
