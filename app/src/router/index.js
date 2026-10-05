/**
 * @module router
 * @description Vue Router configuration for the InkSprite application.
 *
 * ## Routes
 *
 * - `/` - The writer, opening the project worked on most recently; with no
 *   projects yet, the project list and an invitation to start one
 * - `/project/:storyId` - The writer, on one project. It opens on the document
 *   the writer left, which the story remembers
 * - `/connect/openrouter` - OAuth callback for OpenRouter authentication
 * - `/connect/mcp` - OAuth callback for signing in to an MCP server
 * - anything else redirects to `/`
 *
 * ## Navigation Patterns
 *
 * The application uses client-side routing with Vue Router:
 * - Clean URLs with HTML5 history mode
 * - A URL names a project; what is open in it is the project's own state.
 *   A URL that names nothing goes to the root.
 *
 * @example
 * // Open a project
 * router.push({ name: 'project', params: { storyId: 'story_456' } })
 *
 * @example
 * // Back to whatever was worked on last
 * router.push('/')
 */

import { createRouter, createWebHistory } from 'vue-router'
import WriterView from '../components/writer/WriterView.vue'
import OpenRouterCallback from '../components/oauth/OpenRouterCallback.vue'
import McpCallback from '../components/oauth/McpCallback.vue'

/** @type {import('vue-router').RouteRecordRaw[]} */
const routes = [
  {
    path: '/',
    name: 'home',
    component: WriterView,
  },
  {
    path: '/project/:storyId',
    name: 'project',
    component: WriterView,
  },
  {
    path: '/connect/openrouter',
    name: 'openrouter-callback',
    component: OpenRouterCallback,
  },
  {
    path: '/connect/mcp',
    name: 'mcp-callback',
    component: McpCallback,
  },
  // Anything else — a document URL from before projects were the address, a
  // typo — names nothing, and the root finds the writer something to open.
  {
    path: '/:pathMatch(.*)*',
    redirect: '/',
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
