/**
 * @module utils/routeHelpers
 * @description Route helpers for addressing projects.
 *
 * A URL names one project: `/project/<storyId>`. What is open in it — the
 * document, the panels — is the project's own state, kept on the story, and
 * the URL does not repeat it: that would be a second source for one fact, and
 * a segment to keep in step. The document used to be the address; it stopped
 * being one when the story started remembering it.
 */

/**
 * Resolve a route parameter to a story ID
 * @param {string|string[]} routeParam - The story ID from route params
 * @returns {string} The story ID, or '' if absent
 */
export function storyIdFromRoute(routeParam) {
  if (!routeParam) return ''
  const id = Array.isArray(routeParam) ? routeParam[0] : routeParam
  return id || ''
}

/**
 * Navigate to a project
 * @param {import('vue-router').Router} router - Vue Router instance
 * @param {string} storyId - The project to open
 */
export function pushProjectToRoute(router, storyId) {
  if (!storyId) return
  router.push(`/project/${storyId}`)
}

/**
 * Replace the current route with a project, for redirects that should not
 * leave a step in the history
 * @param {import('vue-router').Router} router - Vue Router instance
 * @param {string} storyId - The project to open
 */
export function replaceProjectInRoute(router, storyId) {
  if (!storyId) return
  router.replace(`/project/${storyId}`)
}
