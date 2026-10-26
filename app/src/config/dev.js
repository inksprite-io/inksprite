/**
 * @module config/dev
 * @description Features for developing inksprite, which writers never get:
 * so far, choosing the sync server (the home server, or one run for a test)
 * in Settings › Sync and sharing and from an invitation's link.
 *
 * A build has them with VITE_DEV_FEATURES=true in `app/.env.local`, which the
 * test server and the Mac dev build read. Unlike a preview, a dev feature is
 * never released, and a browser can't turn one on for itself.
 */

/**
 * Whether this build has the features for developing inksprite.
 * @returns {boolean}
 */
export function hasDevFeatures() {
  return import.meta.env.VITE_DEV_FEATURES === 'true'
}
