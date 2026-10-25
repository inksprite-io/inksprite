/**
 * The narration guide, done: the first letter of Frankenstein, from Project
 * Gutenberg's EPUB to a track ready to download, in the order the guide tells
 * it. Kokoro is the stand-in, which speaks silence as long as the words would
 * take, so the player shows a track of the right length.
 *
 * The book is Project Gutenberg's EPUB, downloaded the first time and kept
 * beside this file under the name its download has, so the book it imports
 * as is the one a reader gets. The novel is in the public domain.
 */

import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const BOOK_URL = 'https://www.gutenberg.org/cache/epub/84/pg84-images-3.epub'
const BOOK = fileURLToPath(new URL('pg84-images-3.epub', import.meta.url))
/** What the book is called in the outline: its file's name. */
const TITLE = 'pg84-images-3'

/** The project the book goes in. */
const PROJECT = 'Frankenstein'

/** How the letter's dateline is read: the month said in full, the year left out. */
const HINTS = 'Dec.:December'
const FILTERS = ', 17—.'

/** The book, downloaded from Project Gutenberg if it isn't here yet. */
async function book() {
  if (!existsSync(BOOK)) {
    console.log(`  downloading ${BOOK_URL}`)
    const response = await fetch(BOOK_URL)
    if (!response.ok) throw new Error(`Could not download the book: HTTP ${response.status}`)
    await writeFile(BOOK, Buffer.from(await response.arrayBuffer()))
  }
  return BOOK
}

/** @param {import('./capture.js').Helpers} ui */
export async function narration(ui) {
  const { page } = ui
  const file = await book()
  const button = (/** @type {string} */ name) => page.getByRole('button', { name, exact: true })
  const dialog = (/** @type {string} */ name) => page.getByRole('dialog', { name })

  await ui.goto('/')
  await dialog('Welcome').waitFor()
  await ui.click(button('Start writing'))

  // The book
  await ui.click(button('New project'))
  await ui.type(PROJECT)
  await ui.click(button('Create'))
  const project = page.getByRole('treeitem', { name: PROJECT })
  await project.waitFor()
  await ui.record('import-book', async () => {
    await ui.click(project.getByText(PROJECT), { button: 'right' })
    await ui.hover(page.getByRole('menuitem', { name: 'Import' }))
    const chooser = page.waitForEvent('filechooser')
    await ui.click(page.getByRole('menuitem', { name: 'Files…' }))
    await (await chooser).setFiles(file)
    // The book comes in shut, holding its letters and chapters.
    const opened = page.getByRole('treeitem', { name: TITLE, exact: true })
    await ui.click(opened.getByRole('button', { name: 'Expand', exact: true }))
    await page.getByRole('treeitem', { name: 'Letter 1' }).waitFor()
  })

  // The narration panel
  await ui.click(page.getByRole('treeitem', { name: 'Letter 1' }))
  await ui.click(button('Narration'))
  await page.getByText('13 segments').waitFor()
  await page.getByText(/^Imported /).waitFor({ state: 'hidden' })
  await ui.shot('narration-panel')

  // What it is read through, the built-in Kokoro with its one model, and the voice
  await ui.click(button('Voices'))
  const voice = page.getByRole('textbox', { name: 'Voice' })
  await voice.waitFor()
  await page.getByRole('combobox', { name: 'Model' }).getByText('kokoro').waitFor()
  await ui.shot('narration-voices', {
    of: [button('Voices'), button('Preview')],
    pad: 12,
  })
  await ui.click(button('Voices'))
  await voice.waitFor({ state: 'hidden' })

  // What it says, and what it leaves out
  await ui.click(button('Pronunciation'))
  await ui.paste(page.getByRole('textbox', { name: 'Pronunciation hints' }), HINTS)
  await ui.click(button('Filters'))
  await ui.paste(page.getByRole('textbox', { name: 'Filters' }), FILTERS)
  await ui.shot('narration-fixes')

  // The whole letter
  await ui.record('narration-generate', async () => {
    await ui.click(page.getByRole('button', { name: 'Generate', exact: true }))
    await page.getByText('13 of 13 segments generated').waitFor({ timeout: 60_000 })
    await page.getByRole('button', { name: 'Download as WAV' }).waitFor()
    // Off the button, so its tooltip leaves the count in sight.
    await ui.hover(page.locator('.ProseMirror'))
  })
}
