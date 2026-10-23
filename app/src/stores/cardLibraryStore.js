/* global File */
/**
 * @module stores/cardLibraryStore
 * @description The writer's character cards, app-wide and outside any project.
 *
 * Two tables. `cards` holds a lean row for each card, what the grid, the
 * search and the hover need, read whole when the library is first wanted and
 * saved through the sync store. `cardFiles` holds, by the same id, the card as
 * it arrived, the PNG it came in and a thumbnail: Blobs, so written straight
 * to storage as `filesStore` writes a file's bytes, and read one at a time.
 *
 * The cards are counted as the app opens, without being read, so the rail can
 * show the library's button when there is anything in it.
 *
 * A card can come from a link as well as a file: a botbooru or Chub page, or
 * a PNG or JSON card's own address, downloaded through the platform's fetch,
 * which in the desktop app no site can refuse.
 *
 * Design: `.llm/card_library_design.md`.
 */

import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { nanoid } from 'nanoid'
import { useSyncStore } from './syncStore.js'
import { storage } from '@/storage/index.js'
import { onTablesWritten } from '@/platform/windows.js'
import { describeCard, readCardFile } from '@/cards/library.js'
import { cardLink } from '@/cards/sources.js'
import { makeThumbnail } from '@/cards/thumbnail.js'
import { fetch } from '@/platform/fetch.js'
import { isDesktop } from '@/platform/desktop.js'

/** @typedef {import('../types/models.js').LibraryCard} LibraryCard */
/** @typedef {import('../types/models.js').CardFile} CardFile */

/**
 * What adding some files came to.
 *
 * @typedef {Object} Added
 * @property {LibraryCard[]} added - The cards that came in
 * @property {LibraryCard[]} duplicates - Those already here, which the files held again
 * @property {string[]} skipped - The names of the files with no character card in them
 */

/** Every PNG opens with these bytes. */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47]

/**
 * What a download turned out to be, from its first bytes rather than what
 * the site called it: a PNG, JSON, or neither.
 *
 * @param {Blob} blob
 * @returns {Promise<'png'|'json'|null>}
 */
async function kindOf(blob) {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer())
  if (PNG_SIGNATURE.every((byte, at) => head[at] === byte)) return 'png'
  const text = new TextDecoder().decode(head).trimStart()
  return text.startsWith('{') ? 'json' : null
}

/** @returns {string} */
function generateCardId() {
  return `libcard_${nanoid()}`
}

export const useCardLibraryStore = defineStore('cardLibrary', () => {
  /** @type {import('vue').Ref<Map<string, LibraryCard>>} */
  const cards = ref(new Map())

  /** Whether the rows have been read in. */
  const loaded = ref(false)

  /** How many there were as the app opened, before any were read. */
  const counted = ref(0)

  const syncStore = useSyncStore()

  /** @type {Promise<void>|null} */
  let loading = null

  /**
   * Thumbnails are made one at a time, so a grid of cards restored from a
   * backup does not decode every picture in it at once.
   * @type {Promise<unknown>}
   */
  let making = Promise.resolve()

  /** Whether there is anything in the library, read or only counted. */
  const hasCards = computed(() => cards.value.size > 0 || (!loaded.value && counted.value > 0))

  /** Every card, in no order. */
  const allCards = computed(() => [...cards.value.values()])

  /**
   * Count the cards kept from before, without reading them.
   *
   * @returns {Promise<void>}
   */
  async function countCards() {
    if (loaded.value) return
    try {
      counted.value = await storage.count('cards')
    } catch (error) {
      console.error('Failed to count library cards:', error)
    }
  }

  // Another window changed the library: read it again, or count it again
  // while it is not read in.
  onTablesWritten(['cards'], async () => {
    if (!loaded.value) {
      counted.value = await storage.count('cards')
      return
    }
    const rows = await storage.all('cards')
    cards.value = new Map(rows.map(card => [card.id, card]))
  })

  /** @returns {Promise<void>} */
  function ensureLoaded() {
    if (!loading) {
      loading = (async () => {
        try {
          const stored = await storage.all('cards')
          for (const card of stored) cards.value.set(card.id, card)
        } catch (error) {
          console.error('Failed to load library cards:', error)
        }
        loaded.value = true
      })()
    }
    return loading
  }

  /**
   * Add what files hold to the library. A file with no character card in it
   * is skipped, and so is a card already here.
   *
   * @param {File[]} files
   * @returns {Promise<Added>}
   */
  async function addFiles(files) {
    await ensureLoaded()
    /** @type {Map<string, LibraryCard>} */
    const byHash = new Map([...cards.value.values()].map(card => [card.hash, card]))
    /** @type {Added} */
    const result = { added: [], duplicates: [], skipped: [] }

    for (const file of files) {
      const read = await readCardFile(file)
      if (!read) {
        result.skipped.push(file.name)
        continue
      }
      const described = describeCard(read.card)
      const already = byHash.get(described.hash)
      if (already) {
        result.duplicates.push(already)
        continue
      }

      /** @type {LibraryCard} */
      const card = { id: generateCardId(), ...described, added: Date.now() }
      const thumbnail = read.image ? await makeThumbnail(read.image) : null
      await storage.put('cardFiles', { id: card.id, card: read.card, image: read.image, thumbnail })
      cards.value.set(card.id, card)
      syncStore.trackChange('cards', card.id, card)
      byHash.set(card.hash, card)
      result.added.push(card)
    }
    return result
  }

  /**
   * Add cards a file of Export carried, under new ids: their rows, and their
   * data back as the database holds it. A card already here is skipped, as
   * for one added from its file; the thumbnail is made when the grid wants it.
   *
   * @param {LibraryCard[]} rows
   * @param {CardFile[]} files - Their data, by the same ids
   * @returns {Promise<Added>}
   */
  async function addRows(rows, files) {
    await ensureLoaded()
    const byHash = new Map([...cards.value.values()].map(card => [card.hash, card]))
    const fileOf = new Map(files.map(file => [file.id, file]))
    /** @type {Added} */
    const result = { added: [], duplicates: [], skipped: [] }

    for (const row of rows) {
      const file = fileOf.get(row.id)
      if (!file) {
        result.skipped.push(row.title)
        continue
      }
      const already = byHash.get(row.hash)
      if (already) {
        result.duplicates.push(already)
        continue
      }
      /** @type {LibraryCard} */
      const card = { ...row, id: generateCardId() }
      await storage.put('cardFiles', { ...file, id: card.id, thumbnail: null })
      cards.value.set(card.id, card)
      syncStore.trackChange('cards', card.id, card)
      byHash.set(card.hash, card)
      result.added.push(card)
    }
    return result
  }

  /**
   * Add the card a link leads to, downloaded. Says what went wrong in a
   * sentence fit to show, when something did.
   *
   * @param {string} input - A card's page, a download link, or Chub's `creator/name`
   * @returns {Promise<Added>}
   * @throws {Error} When the link leads to no card, or could not be followed
   */
  async function addLink(input) {
    const link = cardLink(input)
    if (!link) throw new Error("That isn't a link.")

    /** @type {Response} */
    let response
    try {
      response = await fetch(link.url)
    } catch {
      // A browser refuses a site that does not let pages download from it,
      // and says nothing more about why than it does for a site that is down.
      throw new Error(
        isDesktop()
          ? `Couldn't reach ${link.site}.`
          : `Web imports from ${link.site} only work in the desktop app.`
      )
    }
    if (!response.ok) throw new Error(`The site answered with an error (${response.status}).`)

    const blob = await response.blob()
    const kind = await kindOf(blob)
    if (!kind) throw new Error("That link isn't to a character card.")
    const type = kind === 'png' ? 'image/png' : 'application/json'
    return addFiles([new File([blob], `${link.name}.${kind}`, { type })])
  }

  /**
   * @param {string} id
   * @returns {LibraryCard|null}
   */
  function getCard(id) {
    return cards.value.get(id) || null
  }

  /**
   * A card's own data: the card as it arrived and its picture.
   *
   * @param {string} id
   * @returns {Promise<CardFile|null>}
   */
  async function cardFile(id) {
    try {
      return (await storage.get('cardFiles', id)) || null
    } catch (error) {
      console.error(`Failed to read library card ${id}:`, error)
      return null
    }
  }

  /**
   * A card's small picture, made from its PNG and kept when it has none yet,
   * as after a restore. Null for a card with no picture.
   *
   * @param {string} id
   * @returns {Promise<Blob|null>}
   */
  async function thumbnail(id) {
    const file = await cardFile(id)
    if (!file?.image) return null
    if (file.thumbnail) return file.thumbnail
    const made = making.then(async () => {
      const thumbnail = await makeThumbnail(/** @type {Blob} */ (file.image))
      // Nothing to keep where it cannot be made; the grid shows the PNG.
      if (!thumbnail) return file.image
      // Kept only if the card is still here: it may have gone while waiting.
      if (cards.value.has(id)) await storage.put('cardFiles', { ...file, thumbnail })
      return thumbnail
    })
    making = made.catch(() => {})
    return made
  }

  /**
   * Note that a card went into a project: when, for sorting by what was used
   * last, and where, for finding the project again.
   *
   * @param {string} id
   * @param {Omit<import('../types/models.js').CardUse, 'at'>} [use] - The
   *   project and the folder it went into
   */
  function markUsed(id, use) {
    const card = cards.value.get(id)
    if (!card) return
    const at = Date.now()
    const updated = {
      ...card,
      used: at,
      ...(use ? { projects: [...(card.projects || []), { ...use, at }] } : {}),
    }
    cards.value.set(id, updated)
    syncStore.trackChange('cards', id, updated)
  }

  /**
   * Take a card out of the library. Projects it went into keep their copy.
   *
   * @param {string} id
   * @returns {Promise<void>}
   */
  async function removeCard(id) {
    if (!cards.value.has(id)) return
    cards.value.delete(id)
    syncStore.trackDelete('cards', id)
    await storage.remove('cardFiles', [id])
  }

  /**
   * Empty the library. Projects the cards went into keep their copies.
   *
   * @returns {Promise<void>}
   */
  async function removeAll() {
    await ensureLoaded()
    const ids = [...cards.value.keys()]
    for (const id of ids) {
      cards.value.delete(id)
      syncStore.trackDelete('cards', id)
    }
    await storage.remove('cardFiles', ids)
    counted.value = 0
  }

  return {
    cards,
    loaded,
    hasCards,
    allCards,
    countCards,
    ensureLoaded,
    addFiles,
    addLink,
    addRows,
    getCard,
    cardFile,
    thumbnail,
    markUsed,
    removeCard,
    removeAll,
  }
})
