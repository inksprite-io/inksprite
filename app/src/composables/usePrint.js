/**
 * @module composables/usePrint
 * @description A document printed, or saved as a PDF. Its page
 * (`files/printPage.js`) is put in the app's, and takes the app's place
 * while it prints.
 *
 * Command-P prints the document open through the system's print dialog,
 * which saves a PDF too. Export as PDF… on a document's menu opens the same
 * dialog in a browser, and in the desktop app saves the PDF where the writer
 * says, without it.
 *
 * The page stays until the print is done with it, so a browser that prints
 * after `print()` has returned, as Safari on a phone does, still has it. The
 * window's title is the document's meanwhile: the dialog names the PDF by it.
 */

import { onBeforeUnmount, onMounted, toValue } from 'vue'
import { givePictureUrl, takePictureUrl } from '@/editor/pictures.js'
import { printPage } from '@/files/printPage.js'
import { canSavePdf, savePdf } from '@/platform/printing.js'
import { safeName } from '@/storage/names.js'
import { useDocuments } from './useDocuments.js'
import { usePictures } from './usePictures.js'
import { useToast } from './useToast.js'

/**
 * The page being printed, the title it took the place of, and the keys of
 * the pictures it shows, each given back when it goes.
 *
 * @type {{page: HTMLElement, title: string, keys: string[]}|null}
 */
let printing = null

/** How many prints have begun, so that one begun since wins. */
let begun = 0

/** Take the page being printed away, and put the app back as it was. */
function finish() {
  window.removeEventListener('afterprint', finish)
  if (!printing) return
  const { page, title, keys } = printing
  printing = null
  page.remove()
  document.documentElement.classList.remove('printing')
  document.title = title
  keys.forEach(givePictureUrl)
}

/**
 * Put a document's page in the app's, ready to print, with its pictures
 * loaded.
 *
 * @param {string} storyId
 * @param {string} documentId
 * @param {string} content
 * @param {string} title - What the window is called while it prints
 * @returns {Promise<boolean>} Whether it is ready; false when another print
 *   has begun since
 */
async function begin(storyId, documentId, content, title) {
  const run = ++begun
  const { describe } = usePictures(storyId)
  /** @type {string[]} */
  const keys = []
  const page = await printPage(content, src => {
    const source = describe(src, documentId)
    if (source.kind !== 'picture') return Promise.resolve(null)
    keys.push(source.key)
    return takePictureUrl(source.key, source.load)
  })
  if (run !== begun) {
    keys.forEach(givePictureUrl)
    return false
  }
  finish()
  printing = { page, title: document.title, keys }
  document.body.append(page)
  document.documentElement.classList.add('printing')
  document.title = title
  await Promise.all(
    [...page.querySelectorAll('img')].map(image =>
      Promise.resolve(image.decode?.()).catch(() => {})
    )
  )
  return run === begun
}

/**
 * Whether a key is the print's: Command-P on a Mac, Control-P elsewhere.
 *
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
export function isPrintKey(event) {
  if (event.altKey || event.shiftKey || event.key?.toLowerCase() !== 'p') return false
  const isMac = /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '')
  return isMac ? !!event.metaKey && !event.ctrlKey : !!event.ctrlKey && !event.metaKey
}

/**
 * @param {import('vue').MaybeRefOrGetter<string>} storyId - The project printed from
 */
export function usePrint(storyId) {
  const toast = useToast()

  /**
   * The document to print, if it is one that prints: a text laid out, not a
   * plain one, a file or a folder.
   *
   * @param {string} documentId
   */
  const printable = documentId => {
    const found = useDocuments(toValue(storyId)).get(documentId)
    return found?.type === 'text' && !found.plain ? found : null
  }

  /**
   * Put a document's page in the app's, or say why it couldn't be.
   *
   * @param {string} documentId
   * @param {string} failed - What didn't happen, for the writer
   * @returns {Promise<{name: string}|null>} What it is called, once it is
   *   ready; null for a document that doesn't print, or a page not made
   */
  const ready = async (documentId, failed) => {
    const found = printable(documentId)
    if (!found) return null
    const api = useDocuments(toValue(storyId))
    const name = api.displayTitle(found)
    try {
      const content = api.currentContent(documentId)
      return (await begin(toValue(storyId), documentId, content, name)) ? { name } : null
    } catch (error) {
      console.error('Making the page to print failed:', error)
      toast.error(`${failed} ${error.message}`)
      finish()
      return null
    }
  }

  /**
   * Print a document through the system's print dialog.
   *
   * @param {string} documentId
   * @returns {Promise<void>}
   */
  async function printDocument(documentId) {
    if (!(await ready(documentId, "The document couldn't be printed."))) return
    window.addEventListener('afterprint', finish)
    window.print()
  }

  /**
   * Save a document as a PDF: where the writer says in the desktop app, and
   * through the print dialog in a browser.
   *
   * @param {string} documentId
   * @returns {Promise<void>}
   */
  async function exportPdf(documentId) {
    if (!canSavePdf()) return printDocument(documentId)
    const failed = "The document couldn't be saved as a PDF."
    const made = await ready(documentId, failed)
    if (!made) return
    try {
      await savePdf(safeName(made.name))
    } catch (error) {
      console.error('Saving a PDF failed:', error)
      toast.error(`${failed} ${error.message}`)
    } finally {
      finish()
    }
  }

  return { printable, printDocument, exportPdf }
}

/**
 * Take Command-P anywhere in the writer, for as long as the component
 * calling this is mounted: the writer's frame. It prints the document open;
 * with none that prints, it does nothing, rather than print the app.
 *
 * @param {() => string|null|undefined} storyId - The project open
 */
export function usePrintKey(storyId) {
  const { printDocument } = usePrint(() => storyId() || '')

  /** @param {KeyboardEvent} event */
  const onKeyDown = event => {
    if (event.defaultPrevented || !isPrintKey(event)) return
    event.preventDefault()
    const id = storyId()
    if (id) printDocument(useDocuments(id).activeDocumentId.value)
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown))
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeyDown))
}
