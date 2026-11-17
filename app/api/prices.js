/**
 * The site's price list: what Anthropic's and OpenAI's models cost, for the
 * app to show beside them (`src/ai/prices.js`, which says why the site reads
 * it and not the app). A Vercel function, answering `GET /api/prices`.
 */

import { priceListResponse } from '../src/ai/prices.js'

/** @returns {Promise<Response>} */
export function GET() {
  return priceListResponse()
}
