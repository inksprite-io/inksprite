/**
 * @module composables/useConnections
 * @description The AI connections the writer has: which are theirs, how each
 * answered last, and adding, checking and removing one.
 *
 * A connection is a key or an address: OpenRouter, Anthropic, a server at
 * home. The writer adds one in setup or in Settings › Connections, and it is
 * theirs. Every install used to make nine on start, one of each kind
 * (`BUILT_IN_PROVIDERS`); those still made by older devices, or left from
 * before, count only while they hold something of the writer's (`isSetUp`).
 * They are hidden rather than deleted, since an older device would only make
 * them again.
 *
 * Each connection's status is its own, and comes from the last real answer:
 * Connect, or a chat's reply. It is this device's alone, since a server at
 * home answers one device and not another.
 *
 * Design: `.llm/ai_setup_design.md`, "Step 2: setup".
 */

import { computed, reactive } from 'vue'
import { useAIConfig } from './useAIConfig.js'
import { useAIService } from './useAIService.js'
import { useModelLists } from './useModelLists.js'
import { localStorage } from '@/utils/localStorage.js'
import {
  connectionGap,
  connectionKind,
  creditsPage,
  kindOf,
  knownAddress,
  listsPublicly,
  presetProblem,
  providerDoes,
  providerLabel,
  signInOf,
  untouchedBuiltIn,
} from '@/ai/providers.js'
import { routingFilterOf } from '@/ai/routing.js'

/** @typedef {import('../types/models.js').AIProvider} AIProvider */
/** @typedef {import('@/ai/providers.js').ConnectionKind} ConnectionKind */
/** @typedef {import('@/ai/providers.js').ProviderKind} ProviderKind */

/**
 * How a connection answered last: it worked, it refused the key, or it
 * couldn't be reached.
 * @typedef {'connected'|'key'|'unreachable'} ConnectionState
 */

/** What each state is called beside a connection. */
export const STATE_LABELS = Object.freeze({
  connected: 'Connected',
  key: 'Key not accepted',
  unreachable: "Can't reach it",
})

/**
 * What came of checking a connection.
 * @typedef {Object} CheckResult
 * @property {ConnectionState|null} state - Null when it answered with
 *   something else wrong, which says nothing of the connection
 * @property {string} message - What to tell the writer
 * @property {boolean} [freeTier] - OpenRouter: an account that has never
 *   bought credits
 */

const STATUS_KEY = 'inksprite.connection-status'

/** @type {Record<string, ConnectionState>} By connection id */
const states = reactive(readStates())

/** @returns {Record<string, ConnectionState>} */
function readStates() {
  /** @type {any} */
  const kept = localStorage.get(STATUS_KEY, {})
  return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : {}
}

// A reply in another window of the app is how the connection answered here
// too: the settings in this one show it.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', event => {
    if (event.key !== STATUS_KEY || event.storageArea !== window.localStorage) return
    const fresh = readStates()
    for (const id of Object.keys(states)) if (!(id in fresh)) delete states[id]
    Object.assign(states, fresh)
  })
}

/**
 * Where a server is, as the writer would say it: its host and port.
 * @param {string|undefined} endpoint
 * @returns {string}
 */
export function hostOf(endpoint) {
  try {
    return endpoint ? new URL(endpoint).host : ''
  } catch {
    return endpoint || ''
  }
}

/**
 * Which state an error says the connection is in: a refused key, a server
 * not there, or neither.
 * @param {any} error
 * @returns {ConnectionState|null}
 */
export function stateOfError(error) {
  const status = error?.status
  if (status === 401 || status === 403) return 'key'
  if (status) return null
  return error instanceof TypeError ||
    /failed to fetch|load failed|networkerror|network error|connection error|econnrefused|could not connect/i.test(
      String(error?.message ?? '')
    )
    ? 'unreachable'
    : null
}

/**
 * What a failed reply offers to fix: the connection's settings, credits, or
 * another model.
 * @typedef {Object} FailureFix
 * @property {'connection'|'credits'|'model'} kind
 * @property {string} providerId - The connection the reply went through
 * @property {string} [url] - Where its account buys credits. A fix kept from
 *   before it said was OpenRouter's.
 */

/**
 * What NanoGPT's refusal of a model's routing means, by the code it names it
 * with, where it is one of those; null otherwise. Each is mended by another
 * model, or by the model's own providers, which the model's fix leads to.
 *
 * - `zdr_provider_required`: no provider serving it keeps nothing.
 * - `no_allowed_provider_for_model`, `provider_unknown_provider`: the
 *   providers chosen for it don't serve it (any more).
 * - `provider_selection_not_available`, `provider_selected`: a subscription
 *   with paid models off for its API may not choose providers.
 *
 * @param {unknown} code
 * @param {AIProvider} provider
 * @param {string} model
 * @returns {string|null}
 */
function nanoGptRefusal(code, provider, model) {
  switch (code) {
    case 'zdr_provider_required':
      return `${provider.name} can't serve ${model} with zero data retention.`
    case 'no_allowed_provider_for_model':
    case 'provider_unknown_provider':
      return `None of the providers chosen for ${model} serve it.`
    case 'provider_selection_not_available':
    case 'provider_selected':
      return `${provider.name} doesn't let a subscription choose providers while paid models are off for its API.`
    default:
      return null
  }
}

/**
 * What a reply that failed says, and the fix it offers where there is one: a
 * refused key or a server not there, its connection; no credits left on
 * OpenRouter or NanoGPT, more; a model a service no longer offers, or one
 * NanoGPT can't serve as asked (`nanoGptRefusal`), another. Anything else is
 * said as the server said it.
 *
 * Another model, not the connection, where NanoGPT's zero data retention is
 * what stopped it: it may be the key's own policy, which the connection's
 * settings can't change.
 *
 * OpenRouter's 404 is a model it dropped only where no routing step left it
 * without an endpoint (`routingFilterOf`). Where one did, the connection's
 * provider routing offers its settings, which the writer may never have
 * seen, since the floor is on by default; the providers the model is
 * limited to, or a model that can't use tools, another model.
 *
 * @param {any} error
 * @param {AIProvider|null|undefined} provider - What the reply went through
 * @param {string} model
 * @returns {{text: string, state: ConnectionState|null, fix?: FailureFix}}
 */
export function describeFailure(error, provider, model) {
  const text = error?.message || String(error)
  if (!provider) return { text, state: null }
  const providerId = provider.id
  const refused = nanoGptRefusal(error?.code, provider, model)
  if (refused) return { text: refused, state: null, fix: { kind: 'model', providerId } }
  const state = stateOfError(error)
  if (state) {
    return { text: stateMessage(provider, state), state, fix: { kind: 'connection', providerId } }
  }
  const credits = creditsPage(provider.type)
  if (error?.status === 402 && credits) {
    return {
      text: `Your ${provider.name} account is out of credits.`,
      state: null,
      fix: { kind: 'credits', providerId, url: credits },
    }
  }
  const filter = provider.type === 'openrouter' ? routingFilterOf(error?.routingStep) : null
  if (filter === 'connection') {
    return {
      text: `${provider.name}'s provider routing leaves no provider for ${model}.`,
      state: null,
      fix: { kind: 'connection', providerId },
    }
  }
  if (filter === 'model') {
    return {
      text: `None of the providers chosen for ${model} serve it.`,
      state: null,
      fix: { kind: 'model', providerId },
    }
  }
  if (filter === 'tools') {
    return {
      text: `${model} can't use tools on ${provider.name}.`,
      state: null,
      fix: { kind: 'model', providerId },
    }
  }
  // A hosted service that answers 404 for a model has dropped it; a server at
  // home may only be at another address.
  if (error?.status === 404 && knownAddress(provider.type)) {
    return {
      text: `${provider.name} no longer offers ${model}.`,
      state: null,
      fix: { kind: 'model', providerId },
    }
  }
  return { text, state: null }
}

/**
 * What to tell the writer of a connection in a state.
 * @param {AIProvider} provider
 * @param {ConnectionState} state
 * @returns {string}
 */
export function stateMessage(provider, state) {
  if (state === 'connected') return `Connected to ${provider.name}.`
  if (state === 'key') return `${provider.name} didn't accept the key.`
  const host = hostOf(provider.endpoint || knownAddress(provider.type))
  return host ? `Couldn't reach ${provider.name} at ${host}.` : `Couldn't reach ${provider.name}.`
}

export function useConnections() {
  const aiConfig = useAIConfig()
  const aiService = useAIService()
  const modelLists = useModelLists()

  /**
   * Whether a connection is the writer's: one they added, or one left from
   * before that holds something of theirs, a key, an address or routing, or
   * a preset on it that could run.
   * @param {AIProvider|null|undefined} provider
   * @returns {boolean}
   */
  const isSetUp = provider =>
    Boolean(provider) &&
    (!untouchedBuiltIn(provider) ||
      (connectionGap(provider) === null &&
        aiConfig.presets.value.some(preset => preset.providerId === provider?.id)))

  /** The writer's connections, in the menus' order. */
  const connections = computed(() => aiConfig.providers.value.filter(isSetUp))

  /**
   * The writer's connections that can be asked for this.
   * @param {ProviderKind} kind
   */
  const connectionsFor = kind => connections.value.filter(one => providerDoes(one, kind))

  /** Whether any connection of the writer's can answer a chat. */
  const hasChatConnection = computed(() => connectionsFor('chat').length > 0)

  /**
   * Whether the model new chats start on can answer: on one of the writer's
   * connections, with nothing missing. Until it can, setup is not done,
   * though a connection may be.
   */
  const canChat = computed(() => {
    const starting = aiConfig.startingPreset.value
    const provider = starting ? aiConfig.getProvider(starting.providerId) : null
    return (
      isSetUp(provider) &&
      providerDoes(provider, 'chat') &&
      !presetProblem(starting, id => aiConfig.getProvider(id))
    )
  })

  /**
   * The connection setup shows for a kind: the writer's first of it, or the
   * built-in one left from before, to fill in. Null where there is neither.
   * @param {string} kindId
   * @returns {AIProvider|null}
   */
  function forKind(kindId) {
    const kind = connectionKind(kindId)
    if (!kind) return null
    return (
      connections.value.find(one => kindOf(one).id === kind.id) ??
      (kind.builtInId ? aiConfig.getProvider(kind.builtInId) : null)
    )
  }

  /**
   * What a new connection of a kind is called: the kind's name, numbered from
   * (2) when the writer has one called that already.
   * @param {ConnectionKind} kind
   * @returns {string}
   */
  function nameFor(kind) {
    const taken = new Set(connections.value.map(one => one.name))
    if (!taken.has(kind.name)) return kind.name
    let number = 2
    while (taken.has(`${kind.name} (${number})`)) number++
    return `${kind.name} (${number})`
  }

  /**
   * Add a connection of a kind. The first of a kind that was a built-in takes
   * that one's id, and its row where one is left, so presets made for it and
   * the writer's other devices find it there.
   * @param {string} kindId
   * @param {{name?: string, apiKey?: string, endpoint?: string}} fields
   * @returns {AIProvider}
   */
  function addConnection(kindId, fields) {
    const kind = connectionKind(kindId) ?? /** @type {ConnectionKind} */ (connectionKind('generic'))
    const name = fields.name?.trim() || nameFor(kind)
    const endpoint = fields.endpoint?.trim() || kind.endpoint
    const apiKey = fields.apiKey?.trim() || undefined
    const left = kind.builtInId ? aiConfig.getProvider(kind.builtInId) : null
    if (kind.builtInId && !isSetUp(left)) {
      if (left) {
        return /** @type {AIProvider} */ (
          aiConfig.updateProvider(kind.builtInId, { name, endpoint, apiKey, added: true })
        )
      }
      return aiConfig.createProvider({
        id: kind.builtInId,
        name,
        type: kind.type,
        endpoint,
        apiKey,
        added: true,
      })
    }
    return aiConfig.createProvider({
      name,
      type: kind.type,
      endpoint,
      apiKey,
      server: kind.server,
      added: true,
    })
  }

  /**
   * Keep how a connection answered.
   * @param {string} providerId
   * @param {ConnectionState|null} state - Null to forget it
   */
  function setState(providerId, state) {
    if (state) states[providerId] = state
    else delete states[providerId]
    localStorage.set(STATUS_KEY, { ...states })
  }

  /**
   * How a connection answered last, or null where nothing has asked it yet.
   * @param {string|null|undefined} providerId
   * @returns {ConnectionState|null}
   */
  const stateOf = providerId => (providerId ? (states[providerId] ?? null) : null)

  /**
   * What is still missing before a connection can be asked anything, as the
   * writer is told it, or null.
   * @param {AIProvider} provider
   * @returns {string|null}
   */
  function missing(provider) {
    const gap = connectionGap(provider)
    if (gap === 'endpoint') return "Enter the server's address."
    if (gap !== 'key') return null
    return signInOf(provider.type)
      ? `Enter a key, or sign in with ${providerLabel(provider.type)}.`
      : `Enter your ${provider.name} key.`
  }

  /**
   * Ask a connection something real, and keep how it answered: OpenRouter
   * about its key, NanoGPT its balance, any other for its models. Those two
   * list their models to anyone, so a list says nothing of a key.
   * @param {string} providerId
   * @returns {Promise<CheckResult>}
   */
  async function check(providerId) {
    const provider = aiConfig.getProvider(providerId)
    if (!provider) return { state: null, message: 'This connection was removed.' }
    const notYet = missing(provider)
    if (notYet) return { state: null, message: notYet }

    try {
      /** @type {CheckResult} */
      const result = { state: 'connected', message: stateMessage(provider, 'connected') }
      if (provider.type === 'openrouter') {
        const { freeTier } = await aiService.checkOpenRouterKey(provider.apiKey ?? '')
        result.freeTier = freeTier
      } else if (provider.type === 'nanogpt') {
        await aiService.checkNanoGptKey(provider.apiKey ?? '')
      } else {
        const kind = providerDoes(provider, 'chat') ? 'chat' : 'speech'
        await modelLists.load(providerId, kind)
      }
      // A public list, which the model step wants.
      if (listsPublicly(provider.type)) modelLists.load(providerId).catch(() => {})
      setState(providerId, 'connected')
      return result
    } catch (error) {
      console.error(`Checking ${provider.name} failed:`, error)
      const state = stateOfError(error)
      if (state) {
        setState(providerId, state)
        return { state, message: stateMessage(provider, state) }
      }
      return { state: null, message: error?.message || `${provider.name} couldn't be checked.` }
    }
  }

  /**
   * Remove a connection, its models' settings, and what was kept of how it
   * answered.
   * @param {string} providerId
   */
  function remove(providerId) {
    aiConfig.deleteProvider(providerId)
    aiConfig.forgetModelSettings(providerId)
    modelLists.forget(providerId)
    setState(providerId, null)
  }

  return {
    connections,
    connectionsFor,
    hasChatConnection,
    canChat,
    isSetUp,
    forKind,
    nameFor,
    addConnection,
    check,
    stateOf,
    setState,
    missing,
    remove,
  }
}
