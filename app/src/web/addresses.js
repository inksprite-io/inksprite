/**
 * @module web/addresses
 * @description Which addresses the model reads without the writer being
 * asked, and which wait on them.
 *
 * Text the writer didn't write (a page, a file, someone else's document) can
 * tell the model to read their documents and fetch an address with what it
 * read written into it, and the address goes wherever it names. An address
 * like that is one the model put together, so that is what asks: one that
 * came from outside the model is read as it is.
 *
 * An address came from outside when the writer typed it, a search answered
 * with it, or a page read that way links to it. Not when the model wrote it
 * first: in its own words, in a search's query, in a document, or in the
 * address of a page that says back what it was sent. So what a page links to
 * counts only where the page was itself reached by an address from outside.
 *
 * An address on the writer's own computer or network is asked about
 * whoever named it, until they always allow its site: a page has no
 * business pointing the model at their router, and what is on their network
 * is not always what they meant a model to read.
 *
 * A site the writer always allows is read whatever the address, and so is
 * everything once they say reading never asks. Nothing is kept of what a chat
 * has seen: it is worked out from the chat's own messages, so a fork has it
 * as its chat does.
 */

/** @typedef {import('../types/models.js').Message} Message */
/** @typedef {import('../types/models.js').ApiMessage} ApiMessage */

/**
 * The addresses a chat has from outside the model: those the writer typed,
 * and those searches and pages gave.
 *
 * @typedef {{typed: Set<string>, found: Set<string>, read: Set<string>}} Seen - `read`
 *   the addresses the chat has read a page at, whoever named them: one read
 *   is kept without being asked about again
 */

/**
 * The web tools, by the names the model calls them. Written out so that
 * nothing here depends on the tools themselves (ai/tools/web.js).
 */
const SEARCH = 'web_search'
const READ = 'read_web_page'
const SAVE = 'save_web_page'

/** An address in running text: up to whatever can't be part of one. */
const ADDRESS = /https?:\/\/[^\s<>"'`\\^{}|]+/gi

/** What ends a sentence around an address, or marks it up, and is not the address. */
const TRAILING = /[.,;:!?\]}*_~]$/

/**
 * An address as it was found in a text, without what only stood around it:
 * the bracket that closes a Markdown link or a remark in brackets, and the
 * full stop after it. A bracket the address opened itself stays.
 *
 * @param {string} found
 * @returns {string}
 */
function withoutSurroundings(found) {
  let depth = 0
  let end = found.length
  for (let at = 0; at < found.length; at++) {
    if (found[at] === '(') depth++
    else if (found[at] === ')' && depth-- === 0) {
      end = at
      break
    }
  }
  let address = found.slice(0, end)
  while (TRAILING.test(address)) address = address.slice(0, -1)
  return address
}

/**
 * An address as it is compared: its host, path and query. The scheme, a
 * trailing slash and a fragment say nothing a site could be sent, so an
 * address written with or without them is the same one.
 *
 * @param {unknown} address
 * @returns {string|null} Null for what is no web address
 */
export function addressKey(address) {
  let url
  try {
    url = new URL(String(address ?? '').trim())
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  return `${url.host}${url.pathname.replace(/\/+$/, '')}${url.search}`
}

/**
 * The site an address is on, as the writer allows one: its host name, and
 * its port where it names one. A computer serves a different thing on each
 * port, so allowing one is not allowing them all.
 *
 * @param {unknown} address
 * @returns {string|null}
 */
export function siteOf(address) {
  try {
    return new URL(String(address ?? '').trim()).host.toLowerCase() || null
  } catch {
    return null
  }
}

/**
 * An address's host name alone, an IPv6 number without its brackets.
 *
 * @param {unknown} address
 * @returns {string|null}
 */
function hostOf(address) {
  try {
    const host = new URL(String(address ?? '').trim()).hostname.toLowerCase()
    return host.replace(/^\[|\]$/g, '') || null
  } catch {
    return null
  }
}

/**
 * Every address written in a text, as `addressKey` compares them. One inside
 * brackets or at a sentence's end loses what closes it.
 *
 * @param {unknown} text
 * @returns {string[]}
 */
export function addressesIn(text) {
  if (typeof text !== 'string' || !text) return []
  const keys = []
  for (const [found] of text.matchAll(ADDRESS)) {
    const key = addressKey(withoutSurroundings(found))
    if (key) keys.push(key)
  }
  return keys
}

/** A site named without its scheme, as a writer types one: `tides.example/tables`. */
const NAME =
  /(?<![\w@/.-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"'`]*)?/gi

/**
 * Every site a text names without a scheme, as `addressKey` compares
 * addresses: what a writer types when they say "read tides.example". Only
 * for what the writer wrote; a page's words are not addresses for looking
 * like them.
 *
 * @param {unknown} text
 * @returns {string[]}
 */
export function namesIn(text) {
  if (typeof text !== 'string' || !text) return []
  const keys = []
  for (const [found] of text.matchAll(NAME)) {
    const key = addressKey(`https://${withoutSurroundings(found)}`)
    if (key) keys.push(key)
  }
  return keys
}

/**
 * Whether an address is on the writer's own computer or network, by its
 * name: `localhost`, a name with no dot or one that ends as a home network's
 * do, or a number in a range kept for private use. A name that only resolves
 * to one is not caught here.
 *
 * @param {unknown} address
 * @returns {boolean}
 */
export function isLocalAddress(address) {
  const host = hostOf(address)
  if (!host) return false
  // An IPv6 number: this computer, a private or link-local range, or an IPv4
  // number written as one.
  if (host.includes(':')) {
    return (
      host === '::1' ||
      host === '::' ||
      /^f[cd]/.test(host) ||
      /^fe[89ab]/.test(host) ||
      host.startsWith('::ffff:')
    )
  }
  if (host === 'localhost' || !host.includes('.')) return true
  if (/\.(local|localhost|lan|home|internal|home\.arpa)$/.test(host)) return true
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false
  const [a, b] = parts
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

/** @returns {Seen} */
export const nothingSeen = () => ({ typed: new Set(), found: new Set(), read: new Set() })

/**
 * Whether the chat has an address from outside the model. One on the
 * writer's own network only when they typed it.
 *
 * @param {Seen} seen
 * @param {unknown} address
 * @returns {boolean}
 */
export function hasSeen(seen, address) {
  const key = addressKey(address)
  if (!key) return false
  return seen.typed.has(key) || (!isLocalAddress(address) && seen.found.has(key))
}

/**
 * What a call's arguments are, read from the JSON the model wrote.
 *
 * @param {string|null|undefined} written
 * @returns {Record<string, any>}
 */
function argumentsOf(written) {
  try {
    const parsed = JSON.parse(written || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Take in what a web call answered: the addresses a search found, and those
 * a page links to when the page was itself reached by an address from
 * outside. Nothing the model wrote into the call comes back as found: a
 * search's own query, said back by the service, is left out.
 *
 * @param {Seen} seen - Added to
 * @param {string} name - The tool
 * @param {string|null|undefined} written - Its arguments, as the model wrote them
 * @param {string|null|undefined} answered - Its result, as the model reads it
 */
export function noteWebResult(seen, name, written, answered) {
  if (name !== SEARCH && name !== READ && name !== SAVE) return
  const args = argumentsOf(written)
  let result
  try {
    result = JSON.parse(answered || 'null')
  } catch {
    return
  }
  if (!result || typeof result !== 'object' || result.error) return

  if (name === SEARCH) {
    const asked = new Set(addressesIn(args.query))
    const answers = [
      ...(Array.isArray(result.results)
        ? result.results.flatMap((/** @type {any} */ one) => [
            addressKey(one?.url),
            ...addressesIn(one?.text),
          ])
        : []),
      ...addressesIn(result.text),
    ]
    for (const key of answers) if (key && !asked.has(key)) seen.found.add(key)
    return
  }

  const at = addressKey(args.url)
  if (name === READ && at) seen.read.add(at)
  // A page reached by an address the model put together may say that address
  // back, or whatever was written into it: its links count for nothing.
  if (!hasSeen(seen, args.url)) return
  for (const key of addressesIn(result.content)) seen.found.add(key)
}

/**
 * The addresses a chat's messages hold from outside the model, read in the
 * order they came: what the writer typed, and what each turn's searches and
 * pages answered.
 *
 * @param {Message[]} messages
 * @returns {Seen}
 */
export function seenIn(messages) {
  const seen = nothingSeen()
  for (const message of messages) {
    if (message.role === 'user') {
      const typed = message.segments
        ? message.segments.flatMap(segment => (segment.type === 'text' ? [segment.content] : []))
        : [message.content]
      for (const text of typed) {
        for (const key of [...addressesIn(text), ...namesIn(text)]) seen.typed.add(key)
      }
      continue
    }
    noteTrajectory(seen, message.metadata?.apiTrajectory || [])
  }
  return seen
}

/**
 * Take in a turn's calls and their results, in order.
 *
 * @param {Seen} seen - Added to
 * @param {ApiMessage[]} trajectory
 */
export function noteTrajectory(seen, trajectory) {
  /** @type {Map<string, {name: string, written: string}>} */
  const calls = new Map()
  for (const entry of trajectory) {
    for (const call of entry.tool_calls || []) {
      calls.set(call.id, { name: call.function?.name, written: call.function?.arguments })
    }
    const call = entry.role === 'tool' && entry.tool_call_id ? calls.get(entry.tool_call_id) : null
    if (call) noteWebResult(seen, call.name, call.written, entry.content)
  }
}

/**
 * The address a call to a web tool would fetch, when it is one of the two
 * that fetch an address the model names.
 *
 * @param {string} name - The tool
 * @param {string|null|undefined} written - Its arguments, as the model wrote them
 * @returns {string|null}
 */
export function addressFetched(name, written) {
  if (name !== READ && name !== SAVE) return null
  return webAddress(argumentsOf(written).url)
}

/**
 * The address a call gave, when it is one a page can be read at: written
 * out as text, http or https, and with no name or password in it, which a
 * site takes as said to it and a reader takes for the site's name. What
 * asks about an address and what fetches it both read it here, so neither
 * sees one the other doesn't.
 *
 * @param {unknown} value
 * @returns {string|null}
 */
export function webAddress(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.username || url.password ? null : url.href
  } catch {
    return null
  }
}

/**
 * How the writer has reading set: whether it never asks, and the sites it
 * never asks about.
 *
 * @typedef {Object} ReadingAllowed
 * @property {boolean} [always] - Reading never asks
 * @property {boolean} [local] - Reading on the writer's own computer and
 *   network never asks
 * @property {boolean} [localOff] - Nothing there is read at all
 * @property {string[]} [sites] - Sites always allowed
 */

/**
 * Whether reading an address waits on the writer: one the model put
 * together, on a site they haven't always allowed. On their own network,
 * any, whoever named it and whatever else is allowed but its own site.
 *
 * @param {unknown} address
 * @param {Seen} seen
 * @param {ReadingAllowed} [allowed]
 * @returns {boolean}
 */
export function readingAsks(
  address,
  seen,
  { always = false, local = false, localOff = false, sites = [] } = {}
) {
  const site = siteOf(address)
  // No address at all is the tool's to refuse, with nothing to ask about.
  if (!site || !addressKey(address)) return false
  // Switched off, there is nothing to ask: the tool says no itself.
  if (localOff && isLocalAddress(address)) return false
  if (sites.includes(site)) return false
  // Their own network is asked about whoever named the address, they among
  // them: what is there is theirs, and not always what they meant to show.
  if (isLocalAddress(address)) return !local
  return !hasSeen(seen, address) && !always
}

/**
 * Where on the writer's own computer and network a fetch may go: anywhere,
 * once they say reading there never asks, and otherwise only to the sites
 * they always allow. Only those: an allowed site that redirects is followed
 * to no other place at home.
 *
 * @param {ReadingAllowed} [allowed]
 * @returns {true|string[]}
 */
export function mayLeadHome({ local = false, localOff = false, sites = [] } = {}) {
  if (localOff) return []
  return local ? true : [...sites]
}
