/**
 * @module cloud/names
 * @description What a sync account may be called: 3 to 30 of the letters a
 * to z, digits and hyphens, a hyphen only between two others, and none of
 * the names the server keeps back. Checked here as an account is made, so
 * the writer hears at once; the server holds to the same
 * (`server/src/names.js`), and keeps back the names. An account made before
 * signs in as it is.
 *
 * Design: `.llm/sync_design.md`, "Hosted", "Accounts".
 */

export const SHORTEST_NAME = 3
export const LONGEST_NAME = 30

/**
 * What is wrong with a name for a new account, or null if nothing is.
 * @param {string} name
 * @returns {string|null}
 */
export function nameProblem(name) {
  if (name.length < SHORTEST_NAME) return `Use a name of at least ${SHORTEST_NAME} characters.`
  if (name.length > LONGEST_NAME) return `Use a name of at most ${LONGEST_NAME} characters.`
  if (!/^[A-Za-z0-9-]+$/.test(name))
    return 'Use only the letters a to z, digits and hyphens in a name.'
  if (!/^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/.test(name)) {
    return 'Put each hyphen in a name between two letters or digits.'
  }
  return null
}
