/**
 * @module stores/migrations/allowedProviders
 * @description A connection's allowed providers move onto its presets.
 *
 * OpenRouter's allowed list was part of a connection's routing policy, as
 * `routing.only`, and held for every model on that account. It is a choice
 * about a model — the upstreams that serve this one well — so it is the
 * preset's now, as `allowedProviders` beside the model (ai/routing.js).
 *
 * Dropped rather than moved, a list somebody set would quietly stop applying,
 * and requests they had kept to a few providers would go to any. So every
 * preset on the connection takes the list it was running under, unless it has
 * one of its own, and the connection's copy comes off.
 *
 * Pure, like the migrations before it, so the Dexie upgrade hook and backup
 * restore share one transform; and self-contained, so what it does to an old
 * row does not change when the routing module does.
 */

/**
 * Move each connection's `routing.only` onto the presets that use it.
 *
 * Idempotent: a connection with no `only` is left as it is, and a preset that
 * already has `allowedProviders` keeps them, so a retried upgrade or a backup
 * taken after this one restores unchanged.
 *
 * @param {any[]} providers - `aiProviders` rows
 * @param {any[]} presets - `aiProfiles` rows
 * @returns {{providers: any[], presets: any[], moved: number}} `moved` counts
 *   the connections whose list came off
 */
export function allowedProvidersToPresets(providers, presets) {
  const lists = new Map()

  const outProviders = (providers || []).map(provider => {
    if (!provider?.routing || !('only' in provider.routing)) return provider
    const { only, ...routing } = provider.routing
    const slugs = Array.isArray(only) ? only.filter(s => typeof s === 'string' && s) : []
    lists.set(provider.id, slugs)
    return { ...provider, routing }
  })

  const outPresets = (presets || []).map(preset => {
    const only = lists.get(preset?.providerId)
    if (!only?.length || preset.allowedProviders !== undefined) return preset
    return { ...preset, allowedProviders: only }
  })

  return { providers: outProviders, presets: outPresets, moved: lists.size }
}
