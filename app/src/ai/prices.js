/* global Response */
/**
 * @module ai/prices
 * @description What Anthropic's and OpenAI's models cost, which neither says
 * in its own list of models.
 *
 * OpenRouter lists every model with its price, publicly, and charges what
 * the makers do, so their prices are read off its list. Not by the app,
 * though: a writer with a key of Anthropic's and nothing of OpenRouter's
 * would be telling OpenRouter they are there. The site does it
 * (`api/prices.js`), keeps what it read for a day, and the app asks the
 * site, which it was loaded from anyway. A copy of the app served without
 * that function shows no prices for those models, and nothing else changes.
 *
 * Nothing here reaches for the rest of the app: the function on the site
 * and the dev server (`vite.config.js`) run it as it is.
 */

/** Where the site answers with the prices, as `makerPrices` gives them. */
export const PRICES_PATH = '/api/prices'

/** The makers whose own lists carry no prices. */
export const MAKERS = /** @type {const} */ (['anthropic', 'openai'])

/** OpenRouter's public list of models, which needs no key. */
const SOURCE = 'https://openrouter.ai/api/v1/models'

/** How long the site keeps what it read, and goes on answering with it while it reads again. */
const KEPT = 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'

/**
 * @typedef {{prompt: number, completion: number}} Pricing - A token read, and
 *   a token written, in dollars
 * @typedef {Record<string, Record<string, Pricing>>} MakerPrices - By maker,
 *   then by the model's plain id
 */

/**
 * A model's id without its maker, its date, or how its version is written:
 * Anthropic's `claude-sonnet-4-5-20250929` and OpenRouter's
 * `anthropic/claude-sonnet-4.5` are both `claude-sonnet-4-5`.
 * @param {string} id
 * @returns {string}
 */
export function plainModelId(id) {
  return id
    .toLowerCase()
    .replace(/^[^/]+\//, '')
    .replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, '')
    .replace(/\./g, '-')
}

/**
 * What a model costs a token, read and written, or undefined where the list
 * doesn't say.
 * @param {any} pricing - The model's `pricing`
 * @param {number} [per] - How many tokens the list prices: OpenRouter's one,
 *   as strings, NanoGPT's a million, as numbers
 * @returns {Pricing|undefined}
 */
export function pricingOf(pricing, per = 1) {
  if (pricing?.prompt == null || pricing?.completion == null) return undefined
  const prompt = Number(pricing.prompt) / per
  const completion = Number(pricing.completion) / per
  return Number.isFinite(prompt) && Number.isFinite(completion) && prompt >= 0 && completion >= 0
    ? { prompt, completion }
    : undefined
}

/**
 * What each maker's models cost, read off OpenRouter's list: the first price
 * it has for a model, its batch prices aside.
 * @param {Array<Record<string, any>>} entries - The list's models
 * @returns {MakerPrices}
 */
export function makerPrices(entries) {
  /** @type {MakerPrices} */
  const prices = Object.fromEntries(MAKERS.map(maker => [maker, {}]))
  for (const model of entries) {
    const id = String(model?.id ?? '')
    const maker = MAKERS.find(one => id.startsWith(`${one}/`))
    if (!maker || id.endsWith(':batch')) continue
    const pricing = pricingOf(model.pricing)
    const plain = plainModelId(id)
    if (pricing && !(plain in prices[maker])) prices[maker][plain] = pricing
  }
  return prices
}

/**
 * The site's answer to `PRICES_PATH`: the makers' prices as OpenRouter lists
 * them now, to be kept a day by whatever stands in front of the function,
 * and readable from any origin, the desktop app's among them. When
 * OpenRouter can't be read, an error nothing keeps.
 *
 * @param {typeof fetch} [ask] - What reads OpenRouter's list
 * @returns {Promise<Response>}
 */
export async function priceListResponse(ask = fetch) {
  const open = { 'access-control-allow-origin': '*' }
  try {
    const response = await ask(SOURCE, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`OpenRouter answered ${response.status}`)
    const { data } = await response.json()
    if (!Array.isArray(data)) throw new Error('OpenRouter’s list was not a list')
    return Response.json(makerPrices(data), { headers: { ...open, 'cache-control': KEPT } })
  } catch {
    return Response.json(
      { error: 'The prices could not be read.' },
      { status: 502, headers: { ...open, 'cache-control': 'no-store' } }
    )
  }
}
