/**
 * @module composables/useNearScreen
 * @description Which rows of a long list are on the screen or close to it,
 * so only those are drawn in full.
 *
 * A list of several hundred cards takes most of a second to build, and is
 * built again each time it is shown. Its holder draws a row in full only
 * while `isNear` says so and leaves a blank of the row's height otherwise,
 * putting `vNear` on both with the row's key, so the list scrolls, and is
 * as long, as if every row were there.
 *
 * Where the browser can't say (no IntersectionObserver), every row is near.
 */

/* global IntersectionObserver */
import { onScopeDispose, ref } from 'vue'

/**
 * @param {Object} [options]
 * @param {(el: Element) => Element|null} [options.root] - The box that
 *   scrolls, found from a row; the page when left out
 * @param {number} [options.margin] - How far past the box's top and bottom
 *   still counts as near, in pixels
 * @returns {{
 *   isNear: (key: string) => boolean,
 *   vNear: import('vue').ObjectDirective<Element, string>,
 * }}
 */
export function useNearScreen({ root, margin = 400 } = {}) {
  const watched = typeof IntersectionObserver !== 'undefined'

  /** The keys of the rows near the screen. */
  const near = ref(/** @type {Set<string>} */ (new Set()))

  /** @type {WeakMap<Element, string>} */
  const keys = new WeakMap()

  /** @type {IntersectionObserver|null} */
  let observer = null

  /** @param {IntersectionObserverEntry[]} entries */
  const settle = entries => {
    const next = new Set(near.value)
    for (const entry of entries) {
      const key = keys.get(entry.target)
      if (key === undefined) continue
      if (entry.isIntersecting) next.add(key)
      else next.delete(key)
    }
    near.value = next
  }

  /** @type {import('vue').ObjectDirective<Element, string>} */
  const vNear = {
    mounted(el, { value }) {
      if (!watched) return
      observer ??= new IntersectionObserver(settle, {
        root: root?.(el) ?? null,
        rootMargin: `${margin}px 0px`,
      })
      keys.set(el, value)
      observer.observe(el)
    },
    updated(el, { value }) {
      keys.set(el, value)
    },
    unmounted(el) {
      observer?.unobserve(el)
    },
  }

  onScopeDispose(() => observer?.disconnect())

  return {
    isNear: key => !watched || near.value.has(key),
    vNear,
  }
}
