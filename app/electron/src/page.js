/**
 * The page, served to the window from the app's own files.
 *
 * At `app://inksprite/`, a scheme of the app's own that the window treats as
 * a secure origin of its own, the way it would `https://`: the page's
 * database, workers and fetches work there as on the web.
 */

import { net, protocol } from 'electron'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** The page's scheme. */
const SCHEME = 'app'

/** Where the page is, in the window. */
export const PAGE_URL = `${SCHEME}://inksprite/`

/**
 * Make the scheme an origin the window trusts, as `https://` is. Before the
 * app is ready.
 */
export function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ])
}

/**
 * Answer the scheme from the page's files in `root`, the build's `dist`.
 *
 * @param {string} root
 */
export function servePage(root) {
  protocol.handle(SCHEME, async request => {
    const url = new URL(request.url)
    const file = url.host === 'inksprite' ? await pageFile(root, url.pathname) : null
    return file ? net.fetch(pathToFileURL(file).href) : new Response(null, { status: 404 })
  })
}

/**
 * The file a request for `pathname` is answered with: the file, if the build
 * has one there, and otherwise `index.html`, for the router's own paths
 * (`/connect/google`). Null for anything outside `root`.
 *
 * @param {string} root
 * @param {string} pathname - As in the request's URL, encoded
 * @returns {Promise<string|null>}
 */
export async function pageFile(root, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  const file = path.join(root, decoded)
  if (path.relative(root, file).startsWith('..')) return null
  const found = await stat(file).catch(() => null)
  return found?.isFile() ? file : path.join(root, 'index.html')
}
