/**
 * @module utils/modelFacts
 * @description What the model picker says of a model in a few characters:
 * its price, in and out, per million tokens, and how much it reads at once.
 */

/**
 * A price per million tokens, from one per token: `$3`, `$0.37`, `$0.01`.
 * @param {number} perToken - Dollars
 * @returns {string}
 */
function dollars(perToken) {
  const perMillion = perToken * 1e6
  if (perMillion === 0) return '$0'
  if (perMillion >= 10) return `$${Math.round(perMillion)}`
  if (perMillion >= 1) return `$${Number(perMillion.toFixed(2))}`
  return `$${Number(perMillion.toPrecision(2))}`
}

/**
 * What a model costs per million tokens, read and written, as `$3 / $15`;
 * `Free` for one that costs nothing, and '' where the list doesn't say.
 * @param {{prompt: number, completion: number}|undefined} pricing
 * @returns {string}
 */
export function formatPrice(pricing) {
  if (!pricing) return ''
  if (pricing.prompt === 0 && pricing.completion === 0) return 'Free'
  return `${dollars(pricing.prompt)} / ${dollars(pricing.completion)}`
}

/**
 * How many tokens a model reads at once, as `200K` or `1M`; '' where unknown.
 * @param {number|undefined} tokens
 * @returns {string}
 */
export function formatContext(tokens) {
  if (!tokens || tokens <= 0) return ''
  if (tokens >= 1e6) return `${Number((tokens / 1e6).toFixed(1))}M`
  if (tokens >= 1e3) return `${Math.round(tokens / 1e3)}K`
  return String(tokens)
}
