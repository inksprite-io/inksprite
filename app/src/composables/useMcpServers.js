/* global BroadcastChannel */
/**
 * @module composables/useMcpServers
 * @description The writer's MCP servers: adding one, listing what it offers
 * again, which profiles use it, and the tools they always allow.
 *
 * Adding is two steps, because what a server offers is what the model will be
 * told: `preview` connects and lists its tools with their descriptions for the
 * writer to read, and `addServer` keeps it. A server that runs as a local
 * program is kept without a preview, and shown as needing a bridge.
 *
 * A server that wants the writer to sign in says so when it is previewed or
 * listed, and `signIn` sends them, in a tab of its own, to its authorization
 * server; the tab comes back to `/connect/mcp`, which finishes it and says so
 * on a channel this listens to. See mcp/auth.js.
 */

import { computed, ref } from 'vue'
import { useMcpServerStore } from '@/stores/mcpServerStore.js'
import { listServer, describeFailure, disconnect, wantsSignIn } from '@/mcp/client.js'
import { SIGN_IN_CHANNEL, signOut as forgetSignIn, signedIn, startSignIn } from '@/mcp/auth.js'
import { serverTool } from '@/mcp/servers.js'
import { exposedNames, serverPrefix } from '@/mcp/names.js'

/** @typedef {import('../types/models.js').McpServer} McpServer */
/** @typedef {import('../types/models.js').McpTool} McpTool */
/** @typedef {import('../types/models.js').McpPrompt} McpPrompt */
/** @typedef {import('@/mcp/config.js').ConfiguredServer} ConfiguredServer */

/**
 * What a server offers, read for the writer before it is kept.
 *
 * @typedef {Object} ServerPreview
 * @property {string} serverName - What it calls itself
 * @property {string} instructions - What it tells a client about using it
 * @property {Array<Omit<McpTool, 'exposed'>>} tools
 * @property {McpPrompt[]} prompts
 */

/**
 * Its tools with the names the model will call them by.
 *
 * @param {string} prefix
 * @param {Array<Omit<McpTool, 'exposed'>>} tools
 * @returns {McpTool[]}
 */
function named(prefix, tools) {
  const names = exposedNames(
    prefix,
    tools.map(tool => tool.name)
  )
  return tools.map((tool, index) => ({ ...tool, exposed: names[index] }))
}

/** How long a sign-in tab is waited on before the writer is told to try again. */
const SIGN_IN_WAIT_MS = 10 * 60 * 1000

/**
 * Counts every sign-in and sign-out in this tab, or announced by another, so
 * whatever shows whether a server is signed in reads it again. The sign-ins
 * themselves are kept in local storage, which nothing is told about.
 */
const signIns = ref(0)

if (typeof BroadcastChannel !== 'undefined') {
  new BroadcastChannel(SIGN_IN_CHANNEL).onmessage = () => signIns.value++
}

/**
 * @returns {{
 *   ready: () => Promise<void>,
 *   servers: import('vue').ComputedRef<McpServer[]>,
 *   preview: (server: Pick<McpServer, 'url'|'headers'>) => Promise<{preview: ServerPreview}|{error: string, signIn?: boolean}>,
 *   isSignedIn: (url: string) => boolean,
 *   signIn: (url: string) => Promise<{signedIn: true}|{error: string}>,
 *   signOut: (url: string) => void,
 *   addServer: (configured: ConfiguredServer, preview?: ServerPreview, profiles?: string[]) => McpServer,
 *   refreshServer: (id: string) => Promise<{server: McpServer}|{error: string}>,
 *   updateServer: (id: string, updates: Partial<Pick<McpServer, 'name'|'url'|'headers'|'profiles'|'allowed'|'allowAll'|'auth'>>) => McpServer|null,
 *   removeServer: (id: string) => boolean,
 *   allowTool: (exposed: string) => void,
 *   allowServer: (exposed: string) => void,
 * }}
 */
export function useMcpServers() {
  const store = useMcpServerStore()

  const ready = () => store.ensureInitialized()

  const servers = computed(() => {
    void store.servers.size
    return store.getAllServers()
  })

  /**
   * Connect and list what a server offers, without keeping it.
   *
   * @param {Pick<McpServer, 'url'|'headers'>} server
   */
  const preview = async server => {
    try {
      return { preview: await listServer(server) }
    } catch (error) {
      return { error: describeFailure(error), ...(wantsSignIn(error) ? { signIn: true } : {}) }
    }
  }

  /**
   * Whether the writer is signed in to the server at this address.
   *
   * @param {string} url
   */
  const isSignedIn = url => {
    void signIns.value
    return signedIn(url)
  }

  /**
   * Sign in to a server: in a tab of its own, opened here, so it must be
   * called straight from a click — a tab opened after anything has been
   * waited on is a popup, and browsers block those.
   *
   * @param {string} url
   * @returns {Promise<{signedIn: true}|{error: string}>}
   */
  const signIn = url => {
    const tab = window.open('', '_blank')
    return new Promise(resolve => {
      const channel = new BroadcastChannel(SIGN_IN_CHANNEL)
      /** @param {{signedIn: true}|{error: string}} outcome */
      const done = outcome => {
        channel.close()
        clearTimeout(timer)
        signIns.value++
        resolve(outcome)
      }
      const timer = setTimeout(
        () => done({ error: 'Sign-in took too long. Start it again.' }),
        SIGN_IN_WAIT_MS
      )
      channel.onmessage = event => {
        if (event.data?.url !== url) return
        done(event.data.error ? { error: event.data.error } : { signedIn: true })
      }

      startSignIn(url, address => {
        if (tab) tab.location.href = address.toString()
        else window.open(address.toString(), '_blank')
      })
        .then(result => {
          // Signed in already, or a refresh was enough: nowhere to go.
          if (result === 'AUTHORIZED') {
            tab?.close()
            done({ signedIn: true })
          }
        })
        .catch(error => {
          tab?.close()
          done({ error: describeFailure(error) })
        })
    })
  }

  /**
   * Sign out of a server: forget its tokens, and the client it was
   * registered as.
   *
   * @param {string} url
   */
  const signOut = url => {
    forgetSignIn(url)
    signIns.value++
  }

  /**
   * Keep a server, with what it offered when it was previewed.
   *
   * @param {ConfiguredServer} configured
   * @param {ServerPreview} [listed] - Absent for one that runs as a program
   * @param {string[]} [profiles] - The profiles whose chats use it
   */
  const addServer = (configured, listed, profiles = []) => {
    const prefix = serverPrefix(
      configured.name,
      store.getAllServers().map(server => server.prefix)
    )
    return store.createServer({
      name: configured.name,
      prefix,
      ...(configured.url ? { url: configured.url } : {}),
      // Kept signed in, it is one that wants signing in: if the sign-in goes,
      // the screen offers it again.
      ...(configured.url && signedIn(configured.url)
        ? { auth: /** @type {const} */ ('oauth') }
        : {}),
      ...(configured.headers ? { headers: configured.headers } : {}),
      ...(configured.command ? { command: configured.command } : {}),
      ...(configured.args ? { args: configured.args } : {}),
      tools: listed ? named(prefix, listed.tools) : [],
      prompts: listed ? listed.prompts : [],
      profiles,
      allowed: [],
      ...(listed ? { listedAt: Date.now() } : {}),
    })
  }

  /**
   * List what a server offers again: a server adds and changes tools, and
   * what the model is told should be what it offers now. A tool keeps the name
   * it had; a new one gets the next free one.
   *
   * @param {string} id
   */
  const refreshServer = async id => {
    const server = store.getServer(id)
    if (!server) return { error: 'That server is no longer connected.' }
    try {
      const listed = await listServer(server)
      const kept = new Map((server.tools || []).map(tool => [tool.name, tool.exposed]))
      const added = listed.tools.filter(tool => !kept.has(tool.name))
      const names = exposedNames(
        server.prefix,
        added.map(tool => tool.name),
        [...kept.values()]
      )
      for (const [index, tool] of added.entries()) kept.set(tool.name, names[index])
      const tools = listed.tools.map(tool => ({
        ...tool,
        exposed: /** @type {string} */ (kept.get(tool.name)),
      }))
      const updated = store.updateServer(id, {
        tools,
        prompts: listed.prompts,
        listedAt: Date.now(),
        error: undefined,
      })
      return updated ? { server: updated } : { error: 'That server is no longer connected.' }
    } catch (error) {
      const message = describeFailure(error)
      store.updateServer(id, { error: message })
      return { error: message }
    }
  }

  /**
   * @param {string} id
   * @param {Partial<Pick<McpServer, 'name'|'url'|'headers'|'profiles'|'allowed'|'allowAll'|'auth'>>} updates
   */
  const updateServer = (id, updates) => {
    if ('url' in updates || 'headers' in updates) disconnect(id)
    return store.updateServer(id, updates)
  }

  /**
   * Remove a server, and its sign-in with it unless another server answers
   * at the same address.
   *
   * @param {string} id
   */
  const removeServer = id => {
    const url = store.getServer(id)?.url
    const removed = store.deleteServer(id)
    if (url && !store.getAllServers().some(server => server.url === url)) signOut(url)
    return removed
  }

  /**
   * Always allow a server's tool from now on: the writer said so when it
   * asked.
   *
   * @param {string} exposed - The tool, as the model calls it
   */
  const allowTool = exposed => {
    const found = serverTool(exposed)
    if (!found) return
    const { server, tool } = found
    if ((server.allowed || []).includes(tool.name)) return
    store.updateServer(server.id, { allowed: [...(server.allowed || []), tool.name] })
  }

  /**
   * Always allow everything a server has from now on, the tools it adds later
   * included: the writer said so when one of its tools asked.
   *
   * @param {string} exposed - One of its tools, as the model calls it
   */
  const allowServer = exposed => {
    const found = serverTool(exposed)
    if (!found || found.server.allowAll) return
    store.updateServer(found.server.id, { allowAll: true })
  }

  return {
    allowServer,
    ready,
    servers,
    preview,
    isSignedIn,
    signIn,
    signOut,
    addServer,
    refreshServer,
    updateServer,
    removeServer,
    allowTool,
  }
}
