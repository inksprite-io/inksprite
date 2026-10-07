/**
 * @module composables/useChatFind
 * @description Finding in a chat, most of which is not in the page.
 *
 * A long chat keeps only the turns near the screen in the page (see
 * useNearTurns), so the browser's own find cannot see the rest. This finds in
 * the messages themselves instead: in their text as it reads, the markdown
 * rendered and its marks gone, so that what is counted is what the writer
 * would see. Going to a match keeps its turn in the page and scrolls the match
 * into view.
 *
 * The matches in the turns that are in the page are highlighted where they
 * are, with the CSS Custom Highlight API, which marks text without touching
 * the page: nothing a message renders is rewritten to show a match, and a
 * message re-rendered under the highlights is simply found in again. Where the
 * API is missing, a match is still gone to, just not marked.
 *
 * A message reads as its content, or a turn the writer took in pieces as the
 * prose of each piece, which is what the chat shows of it. The page has that
 * text in its `[data-find-text]` elements, inside the element marked with the
 * message's id. Where the text on screen is not quite the text counted, as in
 * a message shown raw, the nth match of a message is the nth on screen, or the
 * last there is.
 */

/* global CSS, Highlight, MutationObserver, NodeFilter, performance, cancelAnimationFrame */
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { renderMarkdown } from '@/utils/markdown.js'
import { segmentProse } from '@/ai/commands.js'

/** How long after going to a match it is kept in view while the turns around it come in. */
const SETTLE_MS = 600

/**
 * @typedef {Object} ChatMatch
 * @property {string} turn - The turn it is in
 * @property {string} message - The message it is in
 * @property {number} nth - Which match in the message it is, from 0
 */

/**
 * @typedef {Object} FindableMessage
 * @property {string} id
 * @property {string} [content]
 * @property {import('@/types/models.js').MessageSegment[]} [segments]
 *
 * @typedef {Object} FindableTurn
 * @property {string} id
 * @property {FindableMessage[]} messages
 */

/** @param {string} text */
const escapeRegExp = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** @param {string} query */
const patternFor = query => new RegExp(escapeRegExp(query), 'giu')

/** The page's highlight registry, where there is one. */
const registry = () =>
  typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight !== 'undefined'
    ? CSS.highlights
    : null

/**
 * Where the query is in an element's text, as ranges over the text nodes it
 * is in. A match can run across nodes, out of a bold word and on.
 *
 * @param {Element} element
 * @param {RegExp} pattern
 * @returns {Range[]}
 */
export function rangesIn(element, pattern) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  /** @type {{node: Text, start: number}[]} */
  const nodes = []
  let text = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const piece = /** @type {Text} */ (node)
    nodes.push({ node: piece, start: text.length })
    text += piece.data
  }

  let at = 0
  /** The node an offset into the text falls in, and how far into it. */
  /** @param {number} offset @returns {[Text, number]} */
  const locate = offset => {
    while (at < nodes.length - 1 && nodes[at + 1].start <= offset) at++
    return [nodes[at].node, offset - nodes[at].start]
  }

  /** @type {Range[]} */
  const ranges = []
  for (const found of text.matchAll(pattern)) {
    const start = found.index ?? 0
    const range = document.createRange()
    range.setStart(...locate(start))
    range.setEnd(...locate(start + found[0].length))
    ranges.push(range)
  }
  return ranges
}

/**
 * @param {import('vue').Ref<FindableTurn[]>} turns - The chat's turns, in order
 * @param {() => HTMLElement|null} scroller - The element that scrolls them
 */
export function useChatFind(turns, scroller) {
  const open = ref(false)
  const query = ref('')
  /** Which match the writer is on, or -1 for none. */
  const current = ref(-1)
  /** The turn the match the writer is on is in, kept in the page while the find is open. */
  /** @type {import('vue').ShallowRef<string|null>} */
  const holding = shallowRef(null)

  /** Each message's text as it reads, until what it says changes. */
  /** @type {Map<string, {source: string|object, text: string}>} */
  const texts = new Map()

  /** @param {string} markdown */
  const readable = markdown => {
    const template = document.createElement('template')
    template.innerHTML = renderMarkdown(markdown)
    return template.content.textContent || ''
  }

  /** @param {FindableMessage} message */
  const textOf = message => {
    const source = message.segments?.length ? message.segments : message.content || ''
    const known = texts.get(message.id)
    if (known?.source === source) return known.text
    const text =
      typeof source === 'string'
        ? readable(source)
        : source.map(segment => readable(segmentProse(segment))).join('\n')
    texts.set(message.id, { source, text })
    return text
  }

  /** @type {import('vue').ComputedRef<ChatMatch[]>} */
  const matches = computed(() => {
    if (!open.value || !query.value) return []
    const pattern = patternFor(query.value)
    /** @type {ChatMatch[]} */
    const found = []
    for (const turn of turns.value) {
      for (const message of turn.messages) {
        if (!message.content && !message.segments?.length) continue
        let nth = 0
        for (const _ of textOf(message).matchAll(pattern)) {
          found.push({ turn: turn.id, message: message.id, nth: nth++ })
        }
      }
    }
    return found
  })

  // A message changed or went: the writer stays on the match they were on,
  // or on the last there is now.
  watch(matches, list => {
    if (current.value >= list.length) current.value = list.length - 1
  })

  /**
   * The first turn on screen, by its place in the chat. Every turn has its
   * block in the page, in or out.
   */
  const firstOnScreen = () => {
    const root = scroller()
    if (!root) return 0
    const top = root.getBoundingClientRect().top
    const blocks = root.querySelectorAll('[data-turn]')
    const ids = new Map(turns.value.map((turn, index) => [turn.id, index]))
    for (const block of blocks) {
      if (block.getBoundingClientRect().bottom > top) {
        return ids.get(block.getAttribute('data-turn') || '') ?? 0
      }
    }
    return turns.value.length
  }

  /**
   * The match nearest where the writer is: the first in or after the turn the
   * last match was in, or with none the first turn on screen; failing that,
   * the last before it, which in a chat read from the bottom is the nearest.
   *
   * @param {ChatMatch|undefined} was
   */
  const nearest = was => {
    const list = matches.value
    if (list.length === 0) return -1
    const ids = new Map(turns.value.map((turn, index) => [turn.id, index]))
    const from = was ? (ids.get(was.turn) ?? 0) : firstOnScreen()
    const at = list.findIndex(match => (ids.get(match.turn) ?? 0) >= from)
    return at === -1 ? list.length - 1 : at
  }

  /** Where the writer last went to a match, for keeping it in view as the page settles. */
  let wentAt = 0
  /** Which going-to is the latest, so that one overtaken by another gives way. */
  let going = 0

  /**
   * The ranges of a message's matches on screen.
   * @param {Element} root
   * @param {string} id
   * @param {RegExp} pattern
   */
  const rangesOfMessage = (root, id, pattern) =>
    [...root.querySelectorAll(`[data-message-id="${CSS.escape(id)}"] [data-find-text]`)].flatMap(
      element => rangesIn(element, pattern)
    )

  /** The range of the match the writer is on, if its message is on the page. */
  const currentRange = () => {
    const root = scroller()
    const match = matches.value[current.value]
    if (!root || !match) return null
    const ranges = rangesOfMessage(root, match.message, patternFor(query.value))
    return ranges[Math.min(match.nth, ranges.length - 1)] ?? null
  }

  /**
   * Bring a range into view, a third of the way down, unless it is well in
   * view already.
   * @param {Range|Element} target
   */
  const reveal = target => {
    const root = scroller()
    if (!root) return
    const rect = target.getBoundingClientRect()
    const box = root.getBoundingClientRect()
    const margin = Math.min(48, box.height / 4)
    if (rect.top >= box.top + margin && rect.bottom <= box.bottom - margin) return
    root.scrollTop += rect.top - box.top - box.height / 3
  }

  /** Mark every match on the page, and the one the writer is on apart. */
  const paint = () => {
    const highlights = registry()
    const root = scroller()
    if (!open.value || !query.value || !root) {
      highlights?.delete('find-match')
      highlights?.delete('find-match-current')
      return
    }
    const range = currentRange()
    if (range && performance.now() - wentAt < SETTLE_MS) reveal(range)
    if (!highlights) return
    const pattern = patternFor(query.value)
    const all = [...root.querySelectorAll('[data-find-text]')].flatMap(element =>
      rangesIn(element, pattern)
    )
    highlights.set('find-match', new Highlight(...all))
    if (range) highlights.set('find-match-current', new Highlight(range))
    else highlights.delete('find-match-current')
  }

  /** Go to the match the writer is on: keep its turn in the page, and show it. */
  const go = async () => {
    const match = matches.value[current.value]
    holding.value = match?.turn ?? null
    const mine = ++going
    await nextTick()
    if (mine !== going) return
    wentAt = performance.now()
    const range = currentRange()
    const root = scroller()
    if (range) reveal(range)
    else if (match && root) {
      const block = root.querySelector(`[data-turn="${CSS.escape(match.turn)}"]`)
      if (block) reveal(block)
    }
    paint()
  }

  /** @type {number|undefined} */
  let frame
  const paintSoon = () => {
    if (frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      paint()
    })
  }

  // Turns come into the page and go, and a reply streams in: whatever the
  // page now has is found in again, once a frame.
  /** @type {MutationObserver|null} */
  let observer = null
  watch(
    () => open.value && !!query.value,
    on => {
      observer?.disconnect()
      observer = null
      const root = scroller()
      if (!on || !root || typeof MutationObserver === 'undefined') return
      observer = new MutationObserver(paintSoon)
      observer.observe(root, { childList: true, subtree: true, characterData: true })
    }
  )

  /**
   * Look for something: from the match the writer is on, so that it stays
   * theirs while the query grows and still matches it, or from the screen.
   * @param {string} text
   */
  const lookFor = text => {
    const was = matches.value[current.value]
    query.value = text
    current.value = nearest(was)
    go()
  }

  /**
   * Move to the match after the one the writer is on, or before it, going
   * round at the ends.
   * @param {1|-1} by
   */
  const step = by => {
    const count = matches.value.length
    if (count === 0) return
    current.value = current.value === -1 ? nearest(undefined) : (current.value + by + count) % count
    go()
  }

  /**
   * Open the find, looking for what is selected in the chat if that is a few
   * words on one line, and otherwise for what was looked for last.
   */
  const openFind = () => {
    const root = scroller()
    const selection = window.getSelection()
    const selected = selection?.toString() || ''
    if (
      root &&
      selection?.anchorNode &&
      root.contains(selection.anchorNode) &&
      selected &&
      !selected.includes('\n') &&
      selected.length <= 200
    ) {
      query.value = selected
    }
    open.value = true
    current.value = -1
    lookFor(query.value)
  }

  const closeFind = () => {
    open.value = false
    current.value = -1
    holding.value = null
    paint()
  }

  onBeforeUnmount(() => {
    observer?.disconnect()
    if (frame !== undefined) cancelAnimationFrame(frame)
    if (open.value) {
      open.value = false
      paint()
    }
  })

  return {
    open,
    query,
    current,
    count: computed(() => matches.value.length),
    holding,
    openFind,
    closeFind,
    lookFor,
    step,
  }
}
