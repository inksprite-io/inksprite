/**
 * @module config/preview
 * @description Features merged before they are released.
 *
 * A large feature is used for a while before anyone else sees it, and kept on
 * a branch that long it falls so far behind dev that merging it is a project
 * of its own. So it is merged as it is built, and hidden: wherever it reaches
 * the writer or the model (a menu item, a command, a tool, a setting, a
 * skill), it asks `inPreview` first. What it keeps is not hidden. Its fields
 * and migrations ship in every build, so that a backup or a library written
 * by a build with the feature opens in one without it.
 *
 * A build has the previews its VITE_PREVIEW names, separated by commas or
 * spaces, or every one for `all`. It is set in `app/.env.local`, which the
 * test server and the Mac dev build (`electron/build-for-mac.sh`) read. The
 * site and the released desktop app are built without that file, the guides'
 * capture clears it, and the tests never read it (`envDir` in
 * `vitest.config.js`).
 *
 * Out of preview, a feature loses its checks and its line here, and the next
 * CHANGELOG section says what it is.
 */

/**
 * Every feature in preview, by the name VITE_PREVIEW gives it, with the day it
 * went in, so none stays in preview unnoticed.
 *
 * @type {Record<string, string>}
 */
export const PREVIEWS = {}

/**
 * The names a value of VITE_PREVIEW gives.
 *
 * @param {string|undefined} value
 * @returns {Set<string>}
 */
export function previewsNamed(value) {
  return new Set(
    String(value || '')
      .split(/[\s,]+/)
      .filter(Boolean)
  )
}

/**
 * Whether a feature in preview is in this build.
 *
 * @param {string} name - A key of PREVIEWS
 * @returns {boolean}
 * @throws {Error} For a name PREVIEWS does not have: a check left behind when
 *   its feature came out of preview, or a misspelled one, which would hide the
 *   feature without a word
 */
export function inPreview(name) {
  if (!Object.hasOwn(PREVIEWS, name)) {
    throw new Error(`No feature named "${name}" is in preview. PREVIEWS lists them.`)
  }
  const named = previewsNamed(import.meta.env.VITE_PREVIEW)
  return named.has('all') || named.has(name)
}
