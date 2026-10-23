/**
 * The getting-started guide, done: what a new reader does, in the order the
 * guide tells it, with the pictures it shows kept along the way. Each step
 * starts where the one before left the app, as it would for the reader.
 *
 * A picture's name is the file the guide links (`welcome` is
 * `src/assets/guide/welcome.png`, a recording `public/guide/<name>.webm`), so
 * renaming one here means renaming it in the guide.
 *
 * Every text a reader sees here is made up for the guide.
 */

/** The project the guide writes. */
const PROJECT = 'Thief'

/** What the reader asks in their first chat, and what the model does with it. */
const FIRST_CHAT = {
  match: 'three ways it could go wrong for her',
  title: 'What goes wrong',
  steps: [
    { tool: 'read_document', args: { path: 'Prologue' } },
    {
      tool: 'create_document',
      args: {
        path: 'Ideas',
        content: [
          '## What goes wrong',
          '',
          '1. **Someone is awake.** The shopkeeper sleeps above the shop, and he heard the shutters close.',
          '2. **The drawer is a trap.** The lock was easy because someone wanted it opened.',
          '3. **One coin isn’t a coin.** It’s heavier than the rest, with a key on both sides, and someone will come for it.',
        ].join('\n'),
      },
    },
    {
      text:
        'I read the Prologue and put three ideas in **Ideas**:\n\n' +
        '1. **Someone is awake**: the shopkeeper heard the shutters.\n' +
        '2. **The drawer is a trap**: the lock was easy because someone wanted it opened.\n' +
        '3. **One coin isn’t a coin**: a token with a key on both sides, which someone will want back.\n\n' +
        'The third carries the story past tonight. Want me to sketch the scene where she finds it?',
    },
  ],
}

/**
 * @param {import('./capture.js').Helpers} ui
 * @param {{ standIn: Awaited<ReturnType<typeof import('./stand-in.js').startStandIn>>, context: import('playwright').BrowserContext }} session
 */
export async function walkthrough(ui, { standIn, context }) {
  const { page } = ui
  const button = (/** @type {string} */ name) => page.getByRole('button', { name, exact: true })
  const dialog = (/** @type {string} */ name) => page.getByRole('dialog', { name })

  standIn.script(FIRST_CHAT)

  // OpenRouter's sign-in, made up: its page sends the reader straight back
  // with a code, which the stand-in trades for a key.
  await context.route('https://openrouter.ai/auth?**', route => {
    const asked = new URL(route.request().url())
    const back = new URL(/** @type {string} */ (asked.searchParams.get('callback_url')))
    back.searchParams.set('code', 'guide')
    back.searchParams.set('state', /** @type {string} */ (asked.searchParams.get('state')))
    return route.fulfill({ status: 302, headers: { location: back.href } })
  })

  // First visit
  await ui.goto('/')
  await dialog('Welcome').waitFor()
  await ui.shot('welcome', { of: dialog('Welcome') })
  await ui.click(button('Start writing'))

  // A project, and its first document
  await ui.record('new-project', async () => {
    await ui.click(button('New project'))
    await ui.type(PROJECT)
    await ui.click(button('Create'))
    await page.getByRole('treeitem', { name: PROJECT }).waitFor()
    // The empty editor's, which says so; the outline's plus is named the same.
    await ui.click(button('New document').filter({ hasText: 'New document' }))
    await ui.type('Prologue')
    await ui.press('Enter')
    await ui.click(page.locator('.ProseMirror'))
    await ui.type('# Burglary\n')
    await ui.type('The thief slipped *quietly* through the window.')
  })
  await ui.type(
    ' Its broken latch dangled from the sash. ' +
      'She listened for a moment, then stepped down onto the boards ' +
      'and pulled the shutters closed behind her.'
  )
  await ui.click(page.getByRole('treeitem', { name: 'Prologue' }))
  await ui.shot('workspace')

  await ui.click(page.getByRole('treeitem', { name: PROJECT }).getByText(PROJECT), {
    button: 'right',
  })
  await page.getByRole('menuitem', { name: 'New folder' }).waitFor()
  await ui.shot('outline-menu', {
    of: [button('Projects'), page.getByRole('menubar')],
    pad: 12,
  })
  await ui.press('Escape')

  // Connecting OpenRouter
  await ui.click(button('Connect'))
  await dialog('Connect an AI provider').waitFor()
  await ui.shot('connect-provider', { of: dialog('Connect an AI provider') })
  await ui.record('connect-openrouter', async () => {
    const tab = page.waitForEvent('popup')
    await ui.click(button('Connect to OpenRouter'))
    await (await tab).waitForEvent('close')
    await page.getByText('Connected to your OpenRouter account').waitFor()
  })

  // The model
  await ui.click(button('Settings'))
  await ui.click(button('AI'))
  await page.getByRole('combobox', { name: 'Model' }).waitFor()
  await ui.shot('ai-settings', { of: dialog('Settings'), pad: 0 })
  await ui.click(page.getByRole('combobox', { name: 'Model' }))
  await page.getByRole('option', { name: 'Z.ai: GLM 5.2' }).waitFor()
  await ui.shot('choose-model', { of: dialog('Settings'), pad: 0 })
  await ui.press('Escape')
  await ui.click(dialog('Settings').getByRole('button', { name: 'Close' }))
  await dialog('Settings').waitFor({ state: 'hidden' })

  // A first chat, at a time that reads the same on every run
  await context.clock.setSystemTime(new Date('2026-10-01T09:41:00Z'))
  const message = page.getByRole('textbox', { name: "Let's brainstorm…" })
  await ui.record('first-chat', async () => {
    await ui.click(message)
    await ui.type(
      'Read the Prologue and give me three ways it could go wrong for her. Put them in a new document called Ideas.'
    )
    await ui.press('Enter')
    await page.getByRole('treeitem', { name: 'Ideas' }).waitFor()
    await page.getByText('Want me to sketch the scene').waitFor()
  })
  await ui.click(page.getByRole('treeitem', { name: 'Ideas' }))
  await ui.shot('first-chat')

  // Backing up
  await ui.click(button('Settings'))
  await ui.click(button('System'))
  await ui.click(button('Data'))
  await ui.click(button('Export'))
  await dialog('Export').waitFor()
  await ui.shot('backup', { of: dialog('Settings'), pad: 0 })
  const download = page.waitForEvent('download')
  await ui.click(dialog('Export').getByRole('button', { name: 'Export', exact: true }))
  if (!(await download).suggestedFilename().endsWith('.zip'))
    throw new Error('The backup is not a .zip file')

  // LM Studio instead of OpenRouter
  await ui.click(button('AI'))
  await ui.record('connect-lmstudio', async () => {
    await ui.click(page.getByRole('combobox', { name: 'Provider', exact: true }))
    await ui.click(page.getByRole('option', { name: 'LM Studio' }))
    await ui.click(page.getByRole('combobox', { name: 'Model' }))
    await ui.click(page.getByRole('option', { name: 'qwen/qwen3-14b' }))
  })
  await ui.shot('lmstudio-settings', { of: dialog('Settings'), pad: 0 })
}
