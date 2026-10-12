/**
 * @module composables/useApplicationState
 * @description Centralized application state management using localStorage for persistence
 *
 * @example
 * // Access active profile
 * const { activeAIPresetId, setActiveAIPresetId } = useApplicationState()
 *
 * // Set active profile
 * setActiveProfileId('profile_custom_creative')
 *
 * // Future: Access other state
 * const { getState, setState } = useApplicationState()
 * setState('ui.theme', 'dark')
 * const theme = getState('ui.theme')
 */

import { ref, computed, watch } from 'vue'
import { localStorage } from '@/utils/localStorage'

const STORAGE_KEY = 'inksprite_app_state'

// Default application state structure
const defaultState = {
  ai: {
    // Active AI profile. Stored under the legacy "chat" key so we don't have
    // to migrate IndexedDB-resident IDs from earlier per-mode profiles.
    activeChatProfileId: null,
  },
  system: {
    // Whether the assistant's changes to documents go straight in, or wait in
    // the chat for the writer to accept them. App-wide: how the writer wants
    // to work with the assistant, not a property of any one conversation.
    applyEdits: 'auto',
    // Whether the built-in profiles written for explicit content are offered.
    // Off until the writer switches it on, so nobody meets them by opening a
    // menu.
    nsfwProfiles: false,
    // The profiles chats start on: new chats in a project that hasn't chosen
    // its own, and chats on a character card. Null for the built-ins, Default
    // and Roleplay.
    chatProfileId: null,
    roleplayProfileId: null,
    // Whether the editor sets its text close, or with the typography plugin's
    // article spacing. For comparing the two while one is chosen.
    compactText: true,
  },
  debug: {
    // Keeps a copy of the request that opened each assistant turn. Off by
    // default: a saved context is as large as the conversation it was built
    // from, and it is only ever read by someone looking at it on purpose.
    enabled: false,
  },
  workflows: {
    // The provider and model that convert a document's text to Markdown, and
    // how hard the model thinks about it. Nulls run the active preset's; the
    // Workflows settings fill them from it the first time they open.
    // `onImport` converts every file with text as it is imported.
    convert: { providerId: null, model: null, reasoningEffort: null, onImport: false },
  },
  narration: {
    // The connection and model last chosen to read aloud through, which a
    // project that has not chosen its own reads through: the built-in
    // Kokoro to start with, so a writer with Kokoro-FastAPI running has
    // nothing to set up.
    // A state saved before speech went through the connections has the
    // server's `endpoint` and `apiKey` here instead, which `useAIConfig`
    // moves onto a connection once.
    providerId: 'provider_kokoro_default',
    model: 'kokoro',
  },
  ui: {
    theme: 'system', // 'light', 'dark', or 'system'
    showProviderSetupDialog: true, // Show or hide the provider setup dialog
    showWelcomeDialog: true, // Show or hide the welcome dialog
    // Whether the editor colours each speaker's lines while the narration is
    // showing beside it.
    highlightSpeakers: true,
    lorebook: {
      sortBy: 'name', // 'name', 'category', or 'updated'
      sortOrder: 'asc', // 'asc' or 'desc'
    },
  },
}

/**
 * Load state from localStorage with defaults
 * @returns {object} Merged state
 */
const loadState = () => {
  const stored = localStorage.get(STORAGE_KEY)
  if (!stored) return defaultState

  // Deep merge to preserve default structure
  const merged = JSON.parse(JSON.stringify(defaultState))

  // Merge stored state
  if (stored.ai) {
    Object.assign(merged.ai, stored.ai)
  }
  if (stored.system) {
    Object.assign(merged.system, stored.system)
  }
  if (stored.debug) {
    Object.assign(merged.debug, stored.debug)
  }
  // Called roles until they were renamed workflows; a state saved before then
  // has them under the old name, and is read as if it had the new one.
  const workflows = stored.workflows || stored.roles
  if (workflows) {
    for (const [name, settings] of Object.entries(workflows)) {
      merged.workflows[name] = { ...(merged.workflows[name] || {}), ...settings }
    }
  }
  if (stored.narration) {
    Object.assign(merged.narration, stored.narration)
  }
  if (stored.ui) {
    Object.assign(merged.ui, stored.ui)
    // Preserve nested lorebook settings
    if (stored.ui.lorebook) {
      merged.ui.lorebook = { ...merged.ui.lorebook, ...stored.ui.lorebook }
    }
  }

  // Earlier versions split the active profile across activeChatProfileId /
  // activeWriteProfileId / activeAdventureProfileId. Collapse onto the
  // canonical chat key, picking whichever stored value is set.
  const ai = merged.ai
  ai.activeChatProfileId =
    ai.activeChatProfileId || ai.activeWriteProfileId || ai.activeAdventureProfileId || null
  delete ai.activeWriteProfileId
  delete ai.activeAdventureProfileId

  return merged
}

// Global reactive state
const state = ref(loadState())

// Auto-persist to localStorage on changes
watch(
  state,
  newState => {
    localStorage.set(STORAGE_KEY, newState)
  },
  { deep: true }
)

/**
 * What documents are read aloud through: one of the AI connections that
 * speaks, and its model. Each project keeps its own (`StoryNarration`); this
 * is the one last chosen, for a project that has none. See `useSpeechServer`.
 *
 * @typedef {Object} NarrationChoice
 * @property {string|null} providerId
 * @property {string|null} model
 */

/**
 * The settings a whole backup carries, which are kept here rather than in the
 * database: what the writer chose and would choose again on another computer.
 * Not the debug switch, the dialogs already seen, or the temporary Compact
 * text switch, which are about this one browser.
 *
 * @typedef {Object} BackedUpSettings
 * @property {string|null} aiPreset - The AI preset in use
 * @property {'auto'|'ask'} applyEdits
 * @property {boolean} nsfwProfiles
 * @property {string|null} chatProfileId - The profile new chats start on
 * @property {string|null} roleplayProfileId - The one chats on a character card start on
 * @property {Record<string, import('../types/models.js').WorkflowSettings>} workflows
 * @property {NarrationChoice} narration
 * @property {'light'|'dark'|'system'} theme
 * @property {boolean} highlightSpeakers
 */

/**
 * @param {unknown} value
 * @returns {boolean}
 */
const isChoice = value => value === null || typeof value === 'string'

/**
 * A workflow's settings as a backup has them, keeping only what a workflow
 * holds and in the shape it holds it. A file can say anything.
 *
 * @param {any} settings
 * @returns {Partial<import('../types/models.js').WorkflowSettings>}
 */
function workflowFrom(settings) {
  if (!settings || typeof settings !== 'object') return {}
  const { allowedProviders, onImport } = settings
  const choices = ['providerId', 'model', 'reasoningEffort'].filter(field =>
    isChoice(settings[field])
  )
  return {
    ...Object.fromEntries(choices.map(field => [field, settings[field]])),
    ...(Array.isArray(allowedProviders) && allowedProviders.every(id => typeof id === 'string')
      ? { allowedProviders }
      : {}),
    ...(typeof onImport === 'boolean' ? { onImport } : {}),
  }
}

/**
 * Application state composable
 *
 * @returns {{
 *   state: import('vue').Ref<object>,
 *   activeAIPresetId: import('vue').ComputedRef<string>,
 *   setActiveAIPresetId: (profileId: string) => void,
 *   getActiveAIPresetId: () => string,
 *   debug: import('vue').ComputedRef<boolean>,
 *   setDebug: (on: boolean) => void,
 *   applyEdits: import('vue').ComputedRef<'auto'|'ask'>,
 *   setApplyEdits: (mode: 'auto'|'ask') => void,
 *   nsfwProfiles: import('vue').ComputedRef<boolean>,
 *   setNsfwProfiles: (on: boolean) => void,
 *   chatProfileId: import('vue').ComputedRef<string|null>,
 *   roleplayProfileId: import('vue').ComputedRef<string|null>,
 *   setChatProfileId: (id: string|null) => void,
 *   setRoleplayProfileId: (id: string|null) => void,
 *   compactText: import('vue').ComputedRef<boolean>,
 *   setCompactText: (on: boolean) => void,
 *   narration: import('vue').ComputedRef<NarrationChoice>,
 *   workflows: import('vue').ComputedRef<Record<string, import('../types/models.js').WorkflowSettings>>,
 *   setWorkflow: (name: string, patch: Partial<import('../types/models.js').WorkflowSettings>) => void,
 *   setNarration: (patch: Partial<NarrationChoice>) => void,
 *   highlightSpeakers: import('vue').ComputedRef<boolean>,
 *   setHighlightSpeakers: (highlight: boolean) => void,
 *   theme: import('vue').ComputedRef<'light'|'dark'|'system'>,
 *   setTheme: (theme: 'light'|'dark'|'system') => void,
 *   getTheme: () => 'light'|'dark'|'system',
 *   setLorebookSortBy: (field: 'name'|'category'|'updated') => void,
 *   getLorebookSortBy: () => 'name'|'category'|'updated',
 *   setLorebookSortOrder: (order: 'asc'|'desc') => void,
 *   getLorebookSortOrder: () => 'asc'|'desc',
 *   showProviderSetupDialog: import('vue').ComputedRef<boolean>,
 *   setShowProviderSetupDialog: (show: boolean) => void,
 *   getShowProviderSetupDialog: () => boolean,
 *   showWelcomeDialog: import('vue').ComputedRef<boolean>,
 *   setShowWelcomeDialog: (show: boolean) => void,
 *   getShowWelcomeDialog: () => boolean,
 *   checkAndShowWelcomeDialog: () => Promise<void>,
 *   settingsForBackup: () => BackedUpSettings,
 *   restoreSettings: (settings: Partial<BackedUpSettings>) => void,
 *   getState: (path: string) => any,
 *   setState: (path: string, value: any) => void,
 *   resetState: () => void
 * }}
 */
export function useApplicationState() {
  // The one AI preset in use — the provider, model and sampling everything
  // runs on. Stored under `activeChatProfileId`, which is two renames out of
  // date and stays that way: it is a key in somebody's saved settings, and it
  // has nothing to do with the chat profiles a chat is stamped from.

  const setActiveAIPresetId = profileId => {
    state.value.ai.activeChatProfileId = profileId
  }
  const getActiveAIPresetId = () => state.value.ai.activeChatProfileId
  const activeAIPresetId = computed(() => state.value.ai.activeChatProfileId)

  /**
   * Whether the debug switch is on: each assistant turn keeps the request
   * that opened it, and a chat can be exported with its words taken out.
   * The switch used to be only the first of those, under its old name, and a
   * setting saved under that name still counts.
   * @type {import('vue').ComputedRef<boolean>}
   */
  const debug = computed(
    () => state.value.debug?.enabled === true || state.value.debug?.saveContext === true
  )

  /**
   * @param {boolean} on
   */
  const setDebug = on => {
    if (!state.value.debug) state.value.debug = {}
    state.value.debug.enabled = on === true
    delete state.value.debug.saveContext
  }

  /**
   * Whether the assistant's changes to documents wait on the writer. Anything
   * but an explicit ask means they go in, as they always did.
   * @type {import('vue').ComputedRef<'auto'|'ask'>}
   */
  const applyEdits = computed(() => (state.value.system?.applyEdits === 'ask' ? 'ask' : 'auto'))

  /**
   * @param {'auto'|'ask'} mode
   */
  const setApplyEdits = mode => {
    if (mode !== 'auto' && mode !== 'ask') return
    if (!state.value.system) state.value.system = {}
    state.value.system.applyEdits = mode
  }

  /**
   * Whether the NSFW chat profiles are offered. See `nsfw` on a profile in
   * ai/profiles.
   * @type {import('vue').ComputedRef<boolean>}
   */
  const nsfwProfiles = computed(() => state.value.system?.nsfwProfiles === true)

  /**
   * @param {boolean} on
   */
  const setNsfwProfiles = on => {
    if (!state.value.system) state.value.system = {}
    state.value.system.nsfwProfiles = on === true
  }

  /**
   * The profile new chats start on, where a project has not chosen one, and
   * the one chats on a character card start on. Null for the built-ins'. See
   * `chatDefaultId` and `roleplayDefaultId` in useProfiles.
   * @type {import('vue').ComputedRef<string|null>}
   */
  const chatProfileId = computed(() => state.value.system?.chatProfileId || null)
  /** @type {import('vue').ComputedRef<string|null>} */
  const roleplayProfileId = computed(() => state.value.system?.roleplayProfileId || null)

  /**
   * @param {string|null} id
   */
  const setChatProfileId = id => {
    if (!state.value.system) state.value.system = {}
    state.value.system.chatProfileId = id || null
  }

  /**
   * @param {string|null} id
   */
  const setRoleplayProfileId = id => {
    if (!state.value.system) state.value.system = {}
    state.value.system.roleplayProfileId = id || null
  }

  /**
   * Whether the editor sets its text close. Anything but an explicit off is
   * on. See `COMPACT` in the editor.
   * @type {import('vue').ComputedRef<boolean>}
   */
  const compactText = computed(() => state.value.system?.compactText !== false)

  /**
   * @param {boolean} on
   */
  const setCompactText = on => {
    if (!state.value.system) state.value.system = {}
    state.value.system.compactText = on !== false
  }

  /**
   * What documents are read aloud through, as far as it is chosen. A state
   * written before there was a choice has the built-in Kokoro.
   * @type {import('vue').ComputedRef<NarrationChoice>}
   */
  const narration = computed(() => {
    const { providerId, model } = { ...defaultState.narration, ...(state.value.narration || {}) }
    return { providerId, model }
  })

  /**
   * Change the connection or the model, leaving the other.
   * @param {Partial<NarrationChoice>} patch
   */
  const setNarration = patch => {
    state.value.narration = { ...narration.value, ...patch }
  }

  /**
   * The workflows and the models they run on, as far as they are set.
   * @type {import('vue').ComputedRef<Record<string, import('../types/models.js').WorkflowSettings>>}
   */
  const workflows = computed(() => {
    /** @type {Record<string, import('../types/models.js').WorkflowSettings>} */
    const merged = {}
    for (const [name, settings] of Object.entries(defaultState.workflows)) {
      merged[name] = { ...settings, ...(state.value.workflows?.[name] || {}) }
    }
    for (const [name, settings] of Object.entries(state.value.workflows || {})) {
      if (!merged[name]) merged[name] = { providerId: null, model: null, ...settings }
    }
    return merged
  })

  /**
   * Change how a workflow is run, leaving the rest of it.
   * @param {string} name
   * @param {Partial<import('../types/models.js').WorkflowSettings>} patch
   */
  const setWorkflow = (name, patch) => {
    state.value.workflows = {
      ...(state.value.workflows || {}),
      [name]: { ...(workflows.value[name] || { providerId: null, model: null }), ...patch },
    }
  }

  /**
   * Whether the editor colours each speaker's lines while the narration is
   * showing. On unless switched off.
   * @type {import('vue').ComputedRef<boolean>}
   */
  const highlightSpeakers = computed(() => state.value.ui?.highlightSpeakers !== false)

  /** @param {boolean} highlight */
  const setHighlightSpeakers = highlight => {
    state.value.ui.highlightSpeakers = highlight === true
  }

  /**
   * Set the theme
   * @param {'light'|'dark'|'system'} theme - Theme to set
   */
  const setTheme = theme => {
    if (['light', 'dark', 'system'].includes(theme)) {
      state.value.ui.theme = theme
    }
  }

  /**
   * Get the current theme
   * @returns {'light'|'dark'|'system'} Current theme
   */
  const getTheme = () => {
    return state.value.ui.theme || 'system'
  }

  /**
   * Computed ref for reactive theme
   * @type {import('vue').ComputedRef<'light'|'dark'|'system'>}
   */
  const theme = computed(() => state.value.ui.theme || 'system')

  /**
   * Get state value by dot notation path
   * @param {string} path - Dot notation path (e.g., 'ai.activeChatProfileId')
   * @returns {*} Value at path or undefined
   */
  const getState = path => {
    return path.split('.').reduce((obj, key) => obj?.[key], state.value)
  }

  /**
   * Set state value by dot notation path
   * @param {string} path - Dot notation path (e.g., 'ui.theme')
   * @param {*} value - Value to set
   */
  const setState = (path, value) => {
    const keys = path.split('.')
    const lastKey = keys.pop()
    const target = keys.reduce((obj, key) => {
      if (!obj[key]) obj[key] = {}
      return obj[key]
    }, state.value)
    target[lastKey] = value
  }

  /**
   * Set lorebook sort by field
   * @param {'name'|'category'|'updated'} field - Field to sort by
   */
  const setLorebookSortBy = field => {
    if (['name', 'category', 'updated'].includes(field)) {
      state.value.ui.lorebook.sortBy = field
    }
  }

  /**
   * Get lorebook sort by field
   * @returns {'name'|'category'|'updated'} Sort by field
   */
  const getLorebookSortBy = () => {
    return state.value.ui?.lorebook?.sortBy || 'name'
  }

  /**
   * Set lorebook sort order
   * @param {'asc'|'desc'} order - Sort order
   */
  const setLorebookSortOrder = order => {
    if (['asc', 'desc'].includes(order)) {
      state.value.ui.lorebook.sortOrder = order
    }
  }

  /**
   * Get lorebook sort order
   * @returns {'asc'|'desc'} Sort order
   */
  const getLorebookSortOrder = () => {
    return state.value.ui?.lorebook?.sortOrder || 'asc'
  }

  /**
   * Set show provider setup dialog state
   * @param {boolean} show - Whether to show the provider setup dialog
   */
  const setShowProviderSetupDialog = show => {
    state.value.ui.showProviderSetupDialog = show
  }

  /**
   * Get show provider setup dialog state
   * @returns {boolean} Whether to show the provider setup dialog
   */
  const getShowProviderSetupDialog = () => {
    return state.value.ui?.showProviderSetupDialog !== false // Default to true if not set
  }

  /**
   * Computed ref for reactive show provider setup dialog state
   * @type {import('vue').ComputedRef<boolean>}
   */
  const showProviderSetupDialog = computed(() => state.value.ui?.showProviderSetupDialog !== false)

  /**
   * Set show welcome dialog state
   * @param {boolean} show - Whether to show the welcome dialog
   */
  const setShowWelcomeDialog = show => {
    state.value.ui.showWelcomeDialog = show
    // If closing the dialog, save the "don't show again" preference
    if (!show) {
      localStorage.set('ui.welcome.provider-setup.dont-show-again', true)
    }
  }

  /**
   * Get show welcome dialog state
   * @returns {boolean} Whether to show the welcome dialog
   */
  const getShowWelcomeDialog = () => {
    return state.value.ui?.showWelcomeDialog !== false // Default to true if not set
  }

  /**
   * Computed ref for reactive show welcome dialog state
   * @type {import('vue').ComputedRef<boolean>}
   */
  const showWelcomeDialog = computed(() => state.value.ui?.showWelcomeDialog !== false)

  /**
   * Check if the welcome dialog should be shown and show it if necessary
   * Should be called after AI config is initialized
   */
  const checkAndShowWelcomeDialog = async () => {
    // Small delay to ensure everything is properly initialized
    await new Promise(resolve => setTimeout(resolve, 100))

    // Check if user has opted out
    const dontShowAgain = localStorage.get('ui.welcome.provider-setup.dont-show-again', false)
    if (dontShowAgain) {
      state.value.ui.showWelcomeDialog = false
      return
    }

    // Show dialog if user hasn't seen it before
    state.value.ui.showWelcomeDialog = true
  }

  /**
   * The settings a whole backup carries. See `BackedUpSettings`.
   * @returns {BackedUpSettings}
   */
  const settingsForBackup = () => ({
    aiPreset: activeAIPresetId.value ?? null,
    applyEdits: applyEdits.value,
    nsfwProfiles: nsfwProfiles.value,
    chatProfileId: chatProfileId.value,
    roleplayProfileId: roleplayProfileId.value,
    workflows: workflows.value,
    narration: narration.value,
    theme: theme.value,
    highlightSpeakers: highlightSpeakers.value,
  })

  /**
   * Take the settings a restored backup carries. Each is taken only if it is
   * the kind of value it should be, and one the file does not have stays as
   * it is. They are written out at once rather than when the state is next
   * saved, because a restore reloads the page straight after.
   * @param {Partial<BackedUpSettings>} settings
   */
  const restoreSettings = settings => {
    if (!settings || typeof settings !== 'object') return
    if (isChoice(settings.aiPreset)) setActiveAIPresetId(settings.aiPreset)
    if (settings.applyEdits) setApplyEdits(settings.applyEdits)
    if (typeof settings.nsfwProfiles === 'boolean') setNsfwProfiles(settings.nsfwProfiles)
    if (isChoice(settings.chatProfileId)) setChatProfileId(settings.chatProfileId)
    if (isChoice(settings.roleplayProfileId)) setRoleplayProfileId(settings.roleplayProfileId)
    if (settings.workflows && typeof settings.workflows === 'object') {
      for (const [name, workflow] of Object.entries(settings.workflows)) {
        setWorkflow(name, workflowFrom(workflow))
      }
    }
    const { providerId, model } = settings.narration || {}
    if (isChoice(providerId) && isChoice(model)) setNarration({ providerId, model })
    if (settings.theme) setTheme(settings.theme)
    if (typeof settings.highlightSpeakers === 'boolean') {
      setHighlightSpeakers(settings.highlightSpeakers)
    }
    localStorage.set(STORAGE_KEY, state.value)
  }

  /**
   * Reset state to defaults
   */
  const resetState = () => {
    state.value = JSON.parse(JSON.stringify(defaultState))
  }

  return {
    // Full state ref for advanced usage
    state,

    // Active AI profile
    activeAIPresetId,
    setActiveAIPresetId,
    getActiveAIPresetId,

    // Debug specific
    debug,
    setDebug,

    // How the assistant's document changes are applied
    applyEdits,
    setApplyEdits,

    // Whether the NSFW chat profiles are offered
    nsfwProfiles,
    setNsfwProfiles,
    chatProfileId,
    roleplayProfileId,
    setChatProfileId,
    setRoleplayProfileId,

    // How close the editor sets its text
    compactText,
    setCompactText,

    // What documents are read aloud through, and whether speakers' lines are coloured
    narration,
    workflows,
    setWorkflow,
    setNarration,
    highlightSpeakers,
    setHighlightSpeakers,

    // Theme specific
    theme,
    setTheme,
    getTheme,

    // Lorebook specific
    setLorebookSortBy,
    getLorebookSortBy,
    setLorebookSortOrder,
    getLorebookSortOrder,

    // Show provider setup dialog specific
    showProviderSetupDialog,
    setShowProviderSetupDialog,
    getShowProviderSetupDialog,

    // Show welcome dialog specific
    showWelcomeDialog,
    setShowWelcomeDialog,
    getShowWelcomeDialog,
    checkAndShowWelcomeDialog,

    // What a whole backup carries, and taking it back
    settingsForBackup,
    restoreSettings,

    // Generic state access for future use
    getState,
    setState,
    resetState,
  }
}
