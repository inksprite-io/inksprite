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
const PROJECT = 'The Lighthouse'

/** What the reader asks in their first chat, and what the model does with it. */
const FIRST_CHAT = {
  match: 'three reasons the lamp might flicker',
  title: 'Why the lamp flickers',
  steps: [
    { tool: 'read_document', args: { path: 'Chapter 1' } },
    {
      tool: 'create_document',
      args: {
        path: 'Ideas',
        content: [
          '## Why the lamp flickers',
          '',
          '1. **Someone is signalling.** The flicker is a pattern, and Mara is the only one awake to read it.',
          '2. **The oil is wrong.** The last supply boat brought a barrel nobody ordered.',
          '3. **The lamp is tired.** Forty years without a night off, and it has started to keep its own hours.',
        ].join('\n'),
      },
    },
    {
      text:
        'I read Chapter 1 and put three ideas in **Ideas**:\n\n' +
        '1. **Someone is signalling**: the flicker is a message, and only Mara is awake to read it.\n' +
        '2. **The oil is wrong**: a barrel nobody ordered came on the last boat.\n' +
        '3. **The lamp is tired**: after forty years it keeps its own hours.\n\n' +
        'The first gives Mara something to do tonight. Want me to sketch the scene where she answers?',
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
    await ui.click(button('New document'))
    await ui.type('Chapter 1')
    await ui.press('Enter')
    await ui.click(page.locator('.ProseMirror'))
    await ui.type('# The lamp\n')
    await ui.type('The lamp had not gone out in forty years. Tonight it **flickered**.')
  })
  await ui.type(
    '\nMara counted the beats between the flashes the way her father had taught her: ' +
      'one for the rocks, two for the shoals, three for come home. ' +
      'It was none of those. It was four, and then nothing, and then four again.'
  )
  await ui.click(page.getByRole('treeitem', { name: 'Chapter 1' }))
  await ui.shot('workspace')

  await ui.click(page.getByRole('treeitem', { name: PROJECT }).getByText(PROJECT), {
    button: 'right',
  })
  await page.getByRole('menuitem', { name: 'New folder' }).waitFor()
  await ui.shot('outline-menu', {
    of: [page.getByRole('heading', { name: 'Outline' }), page.getByRole('menubar')],
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
      'Read Chapter 1 and give me three reasons the lamp might flicker. Put them in a new document called Ideas.'
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
  await ui.click(button('Export backup'))
  await dialog('Export backup').waitFor()
  await ui.shot('backup', { of: dialog('Settings'), pad: 0 })
  const download = page.waitForEvent('download')
  await ui.click(dialog('Export backup').getByRole('button', { name: 'Export' }))
  if (!(await download).suggestedFilename().endsWith('.json'))
    throw new Error('The backup is not a .json file')

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
