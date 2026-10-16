/**
 * @module cards/sources
 * @description Where a card is downloaded from, given the link someone has
 * to it.
 *
 * The sites that share cards link to a page about the card, not to the card.
 * Each keeps the card as a file at an address that follows from the page's,
 * so the page's link is read for that address:
 *
 * - **botbooru** - `botbooru.com/character/12345`, or its download link,
 *   becomes `botbooru.com/download/png/12345`
 * - **Chub** - `chub.ai/characters/creator/name`, or `creator/name` alone,
 *   becomes the card's PNG on `avatars.charhub.io`
 * - **Anything else** - a link straight to a PNG or JSON card, used as it is
 *
 * Pure: nothing here fetches. Design: `.llm/card_library_design.md`.
 */

/**
 * Where to download a card from, and what to call the file.
 *
 * @typedef {Object} CardLink
 * @property {string} url
 * @property {string} name - A filename for it, without an extension: what
 *   the response's type says the file is decides that
 * @property {string} site - The site as the writer knows it, for saying
 *   what could not be reached: `chub.ai` for a Chub card, though its PNG is
 *   elsewhere
 */

/** The hosts Chub's pages are on. */
const CHUB_HOSTS = new Set(['chub.ai', 'venus.chub.ai', 'characterhub.org'])

/** `creator/name`, as Chub writes a card's path. */
const CHUB_PATH = /^([\w.-]+)\/([\w.-]+)$/

/**
 * A Chub card's PNG, from its creator and name.
 *
 * @param {string} creator
 * @param {string} name
 * @returns {CardLink}
 */
const chub = (creator, name) => ({
  url: `https://avatars.charhub.io/avatars/${creator}/${name}/chara_card_v2.png`,
  name,
  site: 'chub.ai',
})

/**
 * Where a link to a card downloads it from, or null for something that is
 * not a link at all.
 *
 * @param {string} input - As typed or dropped: a page, a download link, or
 *   Chub's `creator/name`
 * @returns {CardLink|null}
 */
export function cardLink(input) {
  const text = (input || '').trim()
  if (!text) return null

  const path = text.match(CHUB_PATH)
  if (path && !text.includes('.')) return chub(path[1], path[2])

  /** @type {URL} */
  let url
  try {
    url = new URL(/^[a-z][\w+.-]*:\/\//i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (!url.hostname.includes('.')) return null

  const host = url.hostname.replace(/^www\./, '')
  const parts = url.pathname.split('/').filter(Boolean)

  if (host === 'botbooru.com') {
    const id = parts[0] === 'character' ? parts[1] : parts[0] === 'download' ? parts[2] : undefined
    if (id && /^\d+$/.test(id)) {
      return {
        url: `https://botbooru.com/download/png/${id}`,
        name: `botbooru-${id}`,
        site: 'botbooru.com',
      }
    }
  }

  if (CHUB_HOSTS.has(host) && parts[0] === 'characters' && parts.length >= 3) {
    return chub(parts[1], parts[2])
  }

  const last = decodeURIComponent(parts.at(-1) || host)
  return { url: url.href, name: last.replace(/\.(png|json)$/i, '') || host, site: host }
}
