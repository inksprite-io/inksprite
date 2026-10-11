/**
 * @module web
 * @description The web, for the model: a search and a page read through a
 * service the writer connects. See `.llm/web_search_design.md`.
 *
 * inksprite has no backend, and a page cannot read another site, so the web
 * is reached through a search service that answers a page: Exa and Kagi,
 * through their hosted MCP servers, with the client in `mcp/client.js`. They
 * are not connections in the MCP sense: their tools never reach the model,
 * nothing asks before a call, and they are not in the server list. Brave
 * refuses a page, so it is the desktop app's alone, which also reads a page
 * straight from its site for it, Brave having no reader.
 *
 * ## Files
 *
 * - `services.js` - The services, and what each needs: a key, the desktop app
 * - `exa.js`, `kagi.js`, `brave.js` - Each service's search, and its page
 *   read and free check where it has them, its answers taken apart into the
 *   shape the tools answer in
 * - `direct.js` - A page read straight from its site and made markdown, on
 *   desktop, for a service with no reader
 * - `answers.js` - That shape, its limits, and a refusal said for the writer
 * - `config.js` - The setup as the rest of the app reads it, which service
 *   can search, and which chats search
 * - `pages.js` - Pages read lately, so a long one is read on from without
 *   asking for it again
 *
 * The setup is kept in `stores/webSearchStore.js` and set up in Settings ›
 * Connections (`useWebSearch`). The tools, `web_search` and `read_web_page`,
 * are in `ai/tools/web.js`, in a group of their own that is opted into, as a
 * server's tools are: a chat searches when its profile is one the setup lists,
 * or when the chat itself says so.
 *
 * @example
 * import { serviceInUse } from '@/web/config.js'
 * const using = serviceInUse()
 * if (using) await using.service.search('spring tides', { key: using.key })
 */

export { WEB_SERVICES, getWebService } from './services.js'
export { serviceInUse, webForChat, setWebSearch, onWebSearchChanged } from './config.js'
export { readPage } from './pages.js'
