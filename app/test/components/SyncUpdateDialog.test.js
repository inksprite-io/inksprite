import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import SyncUpdateDialog from '@/components/writer/settings/SyncUpdateDialog.vue'

const { sync, updates } = await vi.hoisted(async () => {
  const { ref, shallowRef } = await import('vue')
  const asked = ref(false)
  return {
    sync: {
      askedToUpdate: asked,
      putOffUpdate: vi.fn(() => {
        asked.value = false
      }),
    },
    updates: { ready: shallowRef(/** @type {any} */ (null)) },
  }
})
vi.mock('@/composables/useCloudSync.js', () => ({ useCloudSync: () => sync }))
vi.mock('@/composables/useUpdates.js', () => ({
  get updateReady() {
    return updates.ready
  },
}))

/** @type {import('@vue/test-utils').VueWrapper|null} */
let wrapper = null

/** @param {string} selector */
const find = selector => /** @type {HTMLElement|null} */ (document.body.querySelector(selector))

const mountDialog = async () => {
  wrapper = mount(SyncUpdateDialog, { attachTo: document.body, global: { plugins: [PrimeVue] } })
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  sync.askedToUpdate.value = false
  updates.ready.value = null
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('SyncUpdateDialog', () => {
  it('says nothing until sync waits for an update', async () => {
    await mountDialog()
    expect(find('[data-sync-update-dialog]')).toBeNull()
  })

  it('says some changes wait for an update, and goes when put off', async () => {
    sync.askedToUpdate.value = true
    await mountDialog()
    expect(find('[data-sync-update-dialog]')?.textContent).toContain(
      "Some changes can't sync until inksprite is updated."
    )
    expect(find('[data-action="sync-update-now"]')).toBeNull()
    find('[data-action="sync-update-later"]')?.click()
    await flushPromises()
    expect(sync.putOffUpdate).toHaveBeenCalled()
    expect(find('[data-sync-update-dialog]')).toBeNull()
  })

  it('offers the update once it is ready', async () => {
    sync.askedToUpdate.value = true
    await mountDialog()
    const apply = vi.fn(async () => {})
    updates.ready.value = { version: '0.1.0', apply }
    await flushPromises()
    find('[data-action="sync-update-now"]')?.click()
    await flushPromises()
    expect(apply).toHaveBeenCalled()
    expect(sync.putOffUpdate).toHaveBeenCalled()
  })
})
