/**
 * @module stores/mcpServerStore
 * @description The MCP servers the writer has connected, app-wide.
 *
 * Each keeps where it answers, what it was sent with, and what it offered the
 * last time it was listed, so its tools can be offered to the model without
 * connecting to it first; the connection is opened by the first call. Which
 * profiles use it, and which of its tools the writer always allows, are kept
 * here too, because they are about the server and not about any one chat.
 *
 * Whatever is here is handed to `mcp/servers.js` the moment it changes, so the
 * tool registry is made from what is here now — the way the skills library
 * reaches the skills registry.
 */

import { defineStore } from 'pinia'
import { ref } from 'vue'
import { nanoid } from 'nanoid'
import { useSyncStore } from './syncStore.js'
import { setServers } from '@/mcp/servers.js'
import { disconnect } from '@/mcp/client.js'
import db from './db'

/** @typedef {import('../types/models.js').McpServer} McpServer */

/** @returns {string} */
function generateServerId() {
  return `mcp_${nanoid()}`
}

export const useMcpServerStore = defineStore('mcpServers', () => {
  /** @type {import('vue').Ref<Map<string, McpServer>>} */
  const servers = ref(new Map())

  const syncStore = useSyncStore()

  /** @type {import('vue').Ref<Promise<void>|null>} */
  const initializePromise = ref(null)

  /** The servers as they stand, in the order they were added. */
  function getAllServers() {
    return Array.from(servers.value.values()).sort((a, b) => a.created - b.created)
  }

  /** Hand the servers as they stand to the tool registry. */
  function publish() {
    setServers(getAllServers())
  }

  async function initialize() {
    try {
      const stored = await db.mcpServers.toArray()
      for (const server of stored) servers.value.set(server.id, server)
      console.log(`Loaded ${servers.value.size} MCP servers`)
    } catch (error) {
      console.error('Failed to load MCP servers from database:', error)
    }
    publish()
  }

  /** @returns {Promise<void>} */
  function ensureInitialized() {
    if (!initializePromise.value) initializePromise.value = initialize()
    return initializePromise.value
  }

  ensureInitialized()

  /**
   * @param {Omit<McpServer, 'id'|'created'|'updated'>} fields
   * @returns {McpServer}
   */
  function createServer(fields) {
    /** @type {McpServer} */
    const server = {
      ...fields,
      id: generateServerId(),
      created: Date.now(),
      updated: Date.now(),
    }

    servers.value.set(server.id, server)
    syncStore.trackChange('mcpServers', server.id, server)
    publish()
    return server
  }

  /**
   * Change a server. One whose address or headers changed is reached on a new
   * connection the next time it is called.
   *
   * @param {string} serverId
   * @param {Partial<Omit<McpServer, 'id'|'created'>>} updates
   * @returns {McpServer|null}
   */
  function updateServer(serverId, updates) {
    const server = servers.value.get(serverId)
    if (!server) {
      console.error(`Failed to update MCP server, '${serverId}' not found`)
      return null
    }

    /** @type {McpServer} */
    const updated = {
      ...server,
      ...updates,
      id: server.id,
      created: server.created,
      updated: Date.now(),
    }

    servers.value.set(serverId, updated)
    syncStore.trackChange('mcpServers', serverId, updated)
    publish()
    return updated
  }

  /**
   * @param {string} serverId
   * @returns {boolean}
   */
  function deleteServer(serverId) {
    if (!servers.value.has(serverId)) return false

    servers.value.delete(serverId)
    syncStore.trackDelete('mcpServers', serverId)
    disconnect(serverId)
    publish()
    return true
  }

  /**
   * @param {string} serverId
   * @returns {McpServer|null}
   */
  function getServer(serverId) {
    return servers.value.get(serverId) || null
  }

  return {
    servers,
    ensureInitialized,
    createServer,
    updateServer,
    deleteServer,
    getServer,
    getAllServers,
  }
})
