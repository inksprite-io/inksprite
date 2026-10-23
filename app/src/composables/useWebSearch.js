/**
 * @module composables/useWebSearch
 * @description Web search as Settings › Connections sets it up: which service
 * is in use, its key, and which profiles' chats search. See web/ and
 * .llm/web_search_design.md.
 *
 * Choosing a service checks it at once where that costs nothing (listing its
 * tools). Connect checks it with the key typed in, and where there is no free
 * check, as with Brave, does so with a search, the writer having asked.
 */

import { computed, ref } from 'vue'
import { useWebSearchStore } from '@/stores/webSearchStore.js'
import { WEB_SERVICES, getWebService } from '@/web/services.js'
import { reachableService, serviceInUse } from '@/web/config.js'
import { describeRefusal } from '@/web/answers.js'

/** @typedef {import('../types/models.js').WebSearchSetup} WebSearchSetup */
/** @typedef {import('../types/models.js').WebServiceId} WebServiceId */
/** @typedef {import('@/web/services.js').WebService} WebService */

/**
 * What the last check of a service found, by service: answered, or why not.
 * App-wide, so the section shows it again when reopened.
 *
 * @type {import('vue').Ref<Partial<Record<WebServiceId, {ok: true}|{error: string}>>>}
 */
const checks = ref({})

/** The service being checked, while it is. */
const checking = ref(/** @type {WebServiceId|null} */ (null))

/** What Connect searches for, at a service with no free check. */
const PROBE = 'weather'

/** How long Connect waits for a search, in milliseconds. */
const PROBE_TIMEOUT_MS = 30000

/**
 * @returns {{
 *   ready: () => Promise<void>,
 *   setup: import('vue').ComputedRef<WebSearchSetup>,
 *   services: WebService[],
 *   reachable: (service: WebService) => boolean,
 *   inUse: import('vue').ComputedRef<boolean>,
 *   checks: typeof checks,
 *   checking: typeof checking,
 *   choose: (id: WebServiceId|null) => Promise<void>,
 *   setKey: (id: WebServiceId, key: string) => void,
 *   connect: (id: WebServiceId, key: string) => Promise<void>,
 *   setProfile: (profileId: string, on: boolean) => void,
 *   setAskBeforeSaving: (ask: boolean) => void,
 * }}
 */
export function useWebSearch() {
  const store = useWebSearchStore()

  const setup = computed(() => store.setup)

  /** Whether a chat could search now, were it asked to. */
  const inUse = computed(() => serviceInUse(setup.value) !== null)

  /**
   * Check a service with the key it has: where that costs nothing, or with a
   * search when the writer asked.
   *
   * @param {WebServiceId} id
   * @param {{search?: boolean}} [options] - Whether a search may do for a
   *   service with no free check
   */
  async function check(id, { search = false } = {}) {
    const service = getWebService(id)
    if (!service || !reachableService(service)) return
    const tryKey =
      service.check ||
      (search ? key => service.search(PROBE, { key, timeout: PROBE_TIMEOUT_MS }) : null)
    if (!tryKey) return
    const key = setup.value.keys?.[id] || ''
    if (service.needsKey && !key) {
      checks.value = { ...checks.value, [id]: undefined }
      return
    }
    checking.value = id
    try {
      await tryKey(key)
      checks.value = { ...checks.value, [id]: { ok: true } }
    } catch (error) {
      checks.value = {
        ...checks.value,
        [id]: {
          error: describeRefusal(service.name, error, { limited: service.limited, here: true }),
        },
      }
    } finally {
      if (checking.value === id) checking.value = null
    }
  }

  /**
   * Use this service, or none.
   *
   * @param {WebServiceId|null} id
   */
  async function choose(id) {
    store.update({ service: id || undefined })
    if (id) await check(id)
  }

  /**
   * Keep a service's key. What a check of the last one found no longer holds.
   *
   * @param {WebServiceId} id
   * @param {string} key
   */
  function setKey(id, key) {
    const trimmed = key.trim()
    if (trimmed === (setup.value.keys?.[id] || '')) return
    store.update({ keys: { ...setup.value.keys, [id]: trimmed } })
    checks.value = { ...checks.value, [id]: undefined }
  }

  /**
   * Keep a service's key, and check it, with a search if need be.
   *
   * @param {WebServiceId} id
   * @param {string} key
   */
  async function connect(id, key) {
    setKey(id, key)
    await check(id, { search: true })
  }

  /**
   * Search in chats on this profile, or stop.
   *
   * @param {string} profileId
   * @param {boolean} on
   */
  function setProfile(profileId, on) {
    const current = setup.value.profiles || []
    store.update({
      profiles: on ? [...new Set([...current, profileId])] : current.filter(id => id !== profileId),
    })
  }

  /**
   * Ask before the model keeps a page in the project, or stop asking.
   *
   * @param {boolean} ask
   */
  function setAskBeforeSaving(ask) {
    store.update({ saveWithoutAsking: !ask })
  }

  return {
    ready: () => store.ensureInitialized(),
    setup,
    services: WEB_SERVICES,
    reachable: reachableService,
    inUse,
    checks,
    checking,
    choose,
    setKey,
    connect,
    setProfile,
    setAskBeforeSaving,
  }
}
