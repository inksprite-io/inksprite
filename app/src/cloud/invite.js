/* global URLSearchParams */
/**
 * @module cloud/invite
 * @description An invitation to a sync server, opened as a link:
 * `https://app.inksprite.io/?server=sync.inksprite.io&invite=7K3M-Q9TX-2HDP`.
 *
 * Opening it takes the server and the code off the address, and has the
 * settings open on Sync, ready to create an account with them. The server
 * counts only in a build with dev features (`config/dev.js`); any other signs
 * up with ours, so a link can't send a writer's account elsewhere. The admin
 * script prints the link (`server/src/admin.js invite`).
 *
 * Design: `.llm/sync_design.md`, "Hosted", "Accounts".
 */

import { sessionStorage } from '@/utils/sessionStorage.js'

/** @typedef {{server: string, code: string}} Invitation */

/** The invitation opened, until the Sync settings take it. @type {Invitation|null} */
let opened = null

/**
 * Take an invitation from the page's address, if it carries one.
 *
 * @param {{location?: Location, history?: History}} [page]
 * @returns {boolean} Whether it did
 */
export function takeInviteFromAddress({
  location = window.location,
  history = window.history,
} = {}) {
  const params = new URLSearchParams(location.search)
  const code = params.get('invite')?.trim()
  if (!code) return false
  opened = { server: params.get('server')?.trim() ?? '', code }
  // The Sync settings shown open.
  sessionStorage.set('expandable-section-ui.settings.sync', true)
  params.delete('invite')
  params.delete('server')
  const rest = params.toString()
  history.replaceState(
    history.state,
    '',
    `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`
  )
  return true
}

/**
 * The invitation opened, handed over once.
 * @returns {Invitation|null}
 */
export function takeInvite() {
  const invitation = opened
  opened = null
  return invitation
}
