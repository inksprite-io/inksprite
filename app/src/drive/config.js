/**
 * @module drive/config
 * @description The OAuth client a build signs in to Google with, from its
 * environment, and whether importing from Drive is on offer at all.
 */

import { isDesktop } from '@/platform/desktop.js'

/**
 * What Google knows the app by, here.
 *
 * In a browser, a web client: its sign-in comes back to `/connect/google` on
 * the page's own origin, which the client names among its redirect URIs. In
 * the desktop window, a desktop client: its sign-in comes back to the app's
 * listener on localhost, and its secret finishes it. Google expects a
 * desktop app to ship that secret, and does not count it as one.
 *
 * @typedef {{kind: 'web', clientId: string}|{kind: 'desktop', clientId: string, clientSecret: string}} DriveConfig
 */

/**
 * The build's Google client for where the app is running, or null when it
 * has none: a fork or a self-hosted copy works without one, and one that
 * wants Drive registers its own (`.env.example`).
 *
 * @returns {DriveConfig|null}
 */
export function driveConfig() {
  const env = import.meta.env
  // Trimmed: a value pasted into a CI variable can keep a space at its end,
  // and Google knows no client by an ID with a space in it.
  if (isDesktop()) {
    const clientId = env.VITE_GOOGLE_DESKTOP_CLIENT_ID?.trim()
    const clientSecret = env.VITE_GOOGLE_DESKTOP_CLIENT_SECRET?.trim()
    return clientId && clientSecret ? { kind: 'desktop', clientId, clientSecret } : null
  }
  const clientId = env.VITE_GOOGLE_CLIENT_ID?.trim()
  return clientId ? { kind: 'web', clientId } : null
}

/**
 * Whether the tree offers an import from Drive.
 *
 * @returns {boolean}
 */
export const driveAvailable = () => driveConfig() !== null
