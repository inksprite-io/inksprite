/* global File */
/**
 * @module composables/useCardImport
 * @description A file chosen, looked at, and then written.
 *
 * Four kinds — a character card in a PNG, a card or a lorebook as JSON, a
 * markdown document, and a file kept as it is: a PDF, an image, anything —
 * told apart by what is in them rather than by what they are called. Cards
 * travel as `.json` as readily as books do, and a PNG is a card only when it
 * has one in it, so an extension is a hint and not an answer.
 *
 * Two steps, for the ones that need it. A card is somebody else's work and
 * arrives with more in it than its name — a book of several hundred entries, a
 * dozen greetings, a prompt override — so what it holds is shown before any of
 * it lands in the writer's tree, and the two questions that cannot be asked
 * afterwards are asked there: what `{{user}}` becomes, and whether to take the
 * system prompt. A markdown file has nothing to decide and no surprises in it,
 * so it is written straight away, and so is a file: its text is read out of it
 * and it goes where it was asked for.
 *
 * A card already in the tree can be read back out of its sidecar and written
 * again over its own folder, with the questions asked afresh — `inspectCard`,
 * and then `write` as for anything else.
 */

import { cardFromPng } from '@/cards/png.js'
import { shapeOf, readCard, readLorebook } from '@/cards/card.js'
import { reimportCard, shelfFor, writeCard, writeLorebook, writeMarkdown } from '@/cards/write.js'
import { inspectFile, isStructured } from '@/files/inspect.js'
import { writeFile } from '@/files/write.js'
import { useJobsToast } from '@/composables/useJobsToast.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { useDocuments } from '@/composables/useDocuments'
import { startConversion } from '@/jobs/index.js'
import { useFilesStore } from '@/stores/filesStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'

/**
 * What a file turned out to hold: enough to describe it, and the read value to
 * write when the writer says so.
 *
 * Counts rather than the text itself — this is what a dialog renders, and a
 * card's description is not something to put in one.
 *
 * @typedef {Object} Found
 * @property {'card'|'lorebook'|'markdown'|'file'} shape
 * @property {string} title - What the folder, or the document, will be called
 * @property {string} name - The character's own name; the same as `title` as often as not
 * @property {string} creator
 * @property {boolean} description
 * @property {boolean} personality
 * @property {boolean} scenario
 * @property {boolean} examples
 * @property {boolean} rules
 * @property {boolean} systemPrompt
 * @property {number} greetings
 * @property {number} lore
 * @property {number} documents - How many this will write, sidecar included
 * @property {boolean} asks - Whether there is anything to decide before writing
 * @property {string} [mime] - A file: what it is
 * @property {number} [pages] - A file: how many pages, for a format that has them
 * @property {boolean} [text] - A file: whether any text could be read out of it
 * @property {File|null} [portrait] - A card that came in a PNG: the PNG, kept
 *   in the card's folder as its picture
 * @property {string} [replaces] - A card read back out of its own folder, to
 *   be written there again over what is in it
 * @property {any} value - The card, the book, the text, or the inspected file
 */

/** Markdown, which is a document and nothing more. */
const MARKDOWN = /\.(md|markdown|txt)$/i

/** A PNG might be a card. */
const PNG = /\.png$/i

/** JSON might be a card or a book. */
const JSON_FILE = /\.json$/i

/**
 * What a file with none of this in it gets told.
 */
export class NotACardError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message)
    this.name = 'NotACardError'
  }
}

/** The fields a card's dialog reads, at their defaults for anything that is not a card. */
const NOTHING = {
  name: '',
  creator: '',
  description: false,
  personality: false,
  scenario: false,
  examples: false,
  rules: false,
  systemPrompt: false,
  greetings: 0,
  lore: 0,
}

/**
 * @param {string} storyId
 */
export function useCardImport(storyId) {
  /**
   * Read a file and say what is in it, writing nothing.
   *
   * @param {File} file
   * @returns {Promise<Found>}
   * @throws {NotACardError} If the file is a lorebook with nothing in it
   * @throws {Error} If the file cannot be read at all
   */
  async function inspect(file) {
    if (MARKDOWN.test(file.name) || file.type === 'text/markdown') {
      return {
        shape: 'markdown',
        title: file.name.replace(/\.[^.]+$/, ''),
        ...NOTHING,
        documents: 1,
        asks: false,
        value: await file.text(),
      }
    }

    const isPng = PNG.test(file.name) || file.type === 'image/png'
    const value = isPng
      ? cardInPng(await file.arrayBuffer())
      : JSON_FILE.test(file.name) || file.type === 'application/json'
        ? parseJson(await file.text())
        : null
    const shape = value === null ? null : shapeOf(value)

    if (shape === 'lorebook') {
      const book = readLorebook(value)
      if (book.entries.length === 0) {
        throw new NotACardError(`"${file.name}" is a lorebook with nothing in it.`)
      }
      return {
        shape,
        title: book.name || file.name.replace(/\.[^.]+$/, ''),
        ...NOTHING,
        name: book.name,
        lore: book.entries.length,
        // The folder, an entry each, and the sidecar.
        documents: 2 + book.entries.length,
        asks: true,
        value: book,
      }
    }

    if (shape === 'card') return foundCard(readCard(value), isPng ? file : null)

    // Anything else is a file to keep: the PNG with no card in it, the JSON
    // that is neither a card nor a book, and everything that is not one of
    // those at all.
    const found = await inspectFile(file)
    return {
      shape: 'file',
      title: found.title,
      ...NOTHING,
      documents: 1,
      asks: false,
      mime: found.mime,
      pages: found.pages ?? 0,
      text: found.text.length > 0,
      value: found,
    }
  }

  /**
   * Read a card back out of the folder it was written to, for writing it
   * there again. The sidecar holds the card as it arrived; the portrait, when
   * the card came in one, is beside it.
   *
   * @param {string} folderId - A card folder
   * @returns {Promise<Found>}
   * @throws {NotACardError} When the folder has no sidecar to read, or it no
   *   longer parses as a card
   */
  async function inspectCard(folderId) {
    const api = useDocuments(storyId)
    await api.init()
    const children = api.childrenOf(folderId)
    const sidecar = children.find(child => child.kind === 'sidecar')
    const value = sidecar ? parseJson(sidecar.content || '') : null
    if (shapeOf(value) !== 'card') {
      throw new NotACardError('This folder has no card in it to import again.')
    }

    const portraitDocument = children.find(child => child.kind === 'portrait')
    const blob = portraitDocument ? await useFilesStore().getFile(portraitDocument.id) : null
    const portrait = blob
      ? new File([blob], 'Portrait.png', { type: blob.type || 'image/png' })
      : null
    return { ...foundCard(readCard(value), portrait), replaces: folderId }
  }

  /**
   * Write what was found.
   *
   * A card or a lorebook asked for on the project itself goes on its shelf,
   * `Cards/Characters` or `Cards/Lorebooks`, which is what lets a chat on one
   * character hide the rest — see `shelfFor`. Asked for on a folder, it goes
   * in that folder: the writer said where. A document or a file goes where
   * it was asked for, and at the top of the project otherwise.
   *
   * A card read back out of its folder (`replaces`) goes back into that
   * folder, over what is there, wherever the folder is.
   *
   * @param {Found} found
   * @param {Object} [options]
   * @param {string} [options.parentId] - The folder it was asked for on
   * @param {string} [options.userName] - What `{{user}}` becomes
   * @param {boolean} [options.useSystemPrompt] - Keep the card's prompt override
   * @returns {Promise<import('@/cards/write.js').Written>}
   */
  async function write(found, { parentId, userName, useSystemPrompt } = {}) {
    if (found.replaces) {
      return reimportCard(storyId, found.replaces, found.value, {
        userName,
        useSystemPrompt,
        portrait: found.portrait || undefined,
      })
    }
    if (found.shape === 'markdown') {
      return writeMarkdown(storyId, found.title, found.value, { parentId })
    }
    if (found.shape === 'file') {
      const written = await writeFile(storyId, found.value, { parentId })
      // Converted as it lands, when the Convert role says so and there is
      // text to convert that lacks its structure. The job runs on its own;
      // the import does not wait.
      if (
        useApplicationState().workflows.value.convert?.onImport &&
        found.value.text &&
        !isStructured(found.value.mime)
      ) {
        startConversion(storyId, written.folderId)
          .then(() => useJobsToast().show())
          .catch(error => console.error('Conversion on import failed to start:', error))
      }
      return written
    }

    const onProject = !parentId || parentId === rootIdFor(storyId)
    if (found.shape === 'lorebook') {
      const into = onProject ? await shelfFor(storyId, 'lorebooks') : parentId
      return writeLorebook(storyId, found.value, { parentId: into, title: found.title })
    }
    const into = onProject ? await shelfFor(storyId, 'characters') : parentId
    return writeCard(storyId, found.value, {
      parentId: into,
      userName,
      useSystemPrompt,
      portrait: found.portrait || undefined,
    })
  }

  return { inspect, inspectCard, write }
}

/**
 * What a card is described as, before it is written.
 *
 * @param {import('@/cards/card.js').Card} card
 * @param {File|null} portrait - The PNG it came in, when it came in one
 * @returns {Found}
 */
function foundCard(card, portrait) {
  const fields = [card.description, card.personality, card.scenario, card.examples]
  return {
    shape: 'card',
    title: card.title,
    name: card.name,
    creator: card.creator,
    description: !!card.description,
    personality: !!card.personality,
    scenario: !!card.scenario,
    examples: !!card.examples,
    rules: !!card.rules,
    systemPrompt: !!card.systemPrompt,
    greetings: card.greetings.length,
    lore: card.lore.length,
    documents:
      2 + // the folder and the sidecar
      fields.filter(Boolean).length +
      card.greetings.length +
      (card.lore.length > 0 ? 1 + card.lore.length : 0) +
      (portrait ? 1 : 0),
    asks: true,
    portrait,
    value: card,
  }
}

/**
 * The card in a PNG, or null when there is none — or when the file is not a
 * PNG at all, whatever it is called, which is a picture to keep like any
 * other rather than a mistake to report.
 *
 * @param {ArrayBuffer} data
 * @returns {any|null}
 */
function cardInPng(data) {
  try {
    return cardFromPng(data)
  } catch {
    return null
  }
}

/**
 * @param {string} text
 * @returns {any|null} Null when it does not parse, or parses to nothing a card could be
 */
function parseJson(text) {
  try {
    const value = JSON.parse(text)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}
