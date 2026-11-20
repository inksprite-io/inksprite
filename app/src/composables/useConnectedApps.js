/**
 * @module composables/useConnectedApps
 * @description The other apps on this computer the writer has let into their
 * projects, in the desktop app: a coding agent reading a design where it is
 * written. Each has a connection, its name, its token and the projects
 * ticked for it, kept by the native side (`platform/apps.js`); this is what
 * Settings › Connections › Connected apps shows and changes. See
 * `.llm/mcp_server_design.md`.
 *
 * One state for the app: wherever it is read, it is the same list.
 */

import { ref } from 'vue'
import { addApp, listApps, removeApp, setAppsPort, updateApp } from '@/platform/apps.js'

/** @typedef {import('@/platform/apps.js').AppConnection} AppConnection */
/** @typedef {import('@/platform/apps.js').AppsState} AppsState */

/** What an app's client calls the server it adds. */
const SERVER_NAME = 'inksprite'

/**
 * The connections and whether their apps can get in, as last read: null
 * until then.
 * @type {import('vue').Ref<AppsState|null>}
 */
const state = ref(null)

/**
 * Where an app reaches inksprite, on this computer.
 *
 * @param {number} port
 * @returns {string}
 */
export const appAddress = port => `http://127.0.0.1:${port}/mcp`

/**
 * The command that adds a connection to Claude Code, to paste in a terminal.
 *
 * @param {number} port
 * @param {string} token
 * @returns {string}
 */
export const claudeCodeCommand = (port, token) =>
  `claude mcp add --transport http ${SERVER_NAME} ${appAddress(port)} --header "Authorization: Bearer ${token}"`

/**
 * @returns {{
 *   state: import('vue').Ref<AppsState|null>,
 *   load: () => Promise<void>,
 *   add: (name: string) => Promise<AppConnection>,
 *   rename: (id: string, name: string) => Promise<void>,
 *   setProject: (id: string, storyId: string, ticked: boolean) => Promise<void>,
 *   setEdit: (id: string, edit: AppConnection['edit']) => Promise<void>,
 *   setComment: (id: string, comment: boolean) => Promise<void>,
 *   remove: (id: string) => Promise<void>,
 *   setPort: (port: number) => Promise<void>,
 * }}
 */
export function useConnectedApps() {
  /** Read the connections again, as the native side has them. */
  const load = async () => {
    state.value = await listApps()
  }

  /**
   * Put a changed connection in the place of the one it was.
   * @param {AppConnection} changed
   */
  const place = changed => {
    if (!state.value) return
    state.value = {
      ...state.value,
      connections: state.value.connections.map(one => (one.id === changed.id ? changed : one)),
    }
  }

  /**
   * Make a connection for an app, with no project ticked yet.
   * @param {string} name
   * @returns {Promise<AppConnection>}
   */
  const add = async name => {
    const made = await addApp(name)
    // Listening may have started with it, or failed to: read it all.
    await load()
    return made
  }

  /**
   * @param {string} id
   * @param {string} name
   */
  const rename = async (id, name) => {
    const before = state.value?.connections.find(one => one.id === id)
    if (!before || !name.trim() || name.trim() === before.name) return
    place(await updateApp(id, { name }))
  }

  /**
   * Tick a project for a connection, or untick it.
   *
   * @param {string} id
   * @param {string} storyId
   * @param {boolean} ticked
   */
  const setProject = async (id, storyId, ticked) => {
    const before = state.value?.connections.find(one => one.id === id)
    if (!before) return
    const others = before.projects.filter(project => project !== storyId)
    place(await updateApp(id, { projects: ticked ? [...others, storyId] : others }))
  }

  /**
   * Say how a connection may change the documents' text.
   *
   * @param {string} id
   * @param {AppConnection['edit']} edit
   */
  const setEdit = async (id, edit) => {
    place(await updateApp(id, { edit }))
  }

  /**
   * Say whether a connection may comment.
   *
   * @param {string} id
   * @param {boolean} comment
   */
  const setComment = async (id, comment) => {
    place(await updateApp(id, { comment }))
  }

  /**
   * Remove a connection: its app is let in no more.
   * @param {string} id
   */
  const remove = async id => {
    await removeApp(id)
    await load()
  }

  /**
   * Have apps reach inksprite on another port.
   * @param {number} port
   */
  const setPort = async port => {
    state.value = await setAppsPort(port)
  }

  return { state, load, add, rename, setProject, setEdit, setComment, remove, setPort }
}
