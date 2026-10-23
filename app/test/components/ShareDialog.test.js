/* global Event */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import ShareDialog from '@/components/writer/tree/ShareDialog.vue'
import { me, sharing } from '@/cloud/people.js'

const cloud = vi.hoisted(() => ({
  profile: vi.fn(),
  setDisplay: vi.fn(async () => {}),
  share: vi.fn(async () => {}),
  removeMember: vi.fn(async () => {}),
}))
vi.mock('@/composables/useCloudSync.js', () => ({ useCloudSync: () => cloud }))

const CODE = 'ABCDE-FGHJK-MNPQR-STVWX'

/** @type {import('@vue/test-utils').VueWrapper|null} */
let wrapper = null

const mountDialog = async () => {
  wrapper = mount(ShareDialog, {
    props: { visible: true, storyId: 'story_1', title: 'Thief' },
    attachTo: document.body,
    global: { plugins: [PrimeVue], directives: { tooltip: Tooltip } },
  })
  await flushPromises()
  return wrapper
}

/** @param {string} selector */
const find = selector => /** @type {HTMLElement} */ (document.body.querySelector(selector))

/**
 * @param {string} selector
 * @param {string} value
 */
async function type(selector, value) {
  const field = /** @type {HTMLInputElement} */ (find(selector))
  field.value = value
  field.dispatchEvent(new Event('input'))
  await flushPromises()
}

beforeEach(() => {
  vi.clearAllMocks()
  cloud.profile.mockResolvedValue({ id: 1, display: 'Ada', friend: CODE })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  me.value = null
  sharing.value = { me: null, projects: {} }
})

describe('ShareDialog', () => {
  it('shares the project with a friend’s code once it reads as one', async () => {
    await mountDialog()
    expect(find('[data-field="share-display"]')).toBeNull()
    await type('[data-field="share-code"]', 'abcde-fghjk')
    expect(/** @type {HTMLButtonElement} */ (find('[data-action="share"]')).disabled).toBe(true)
    await type('[data-field="share-code"]', 'abcde-fghjk-mnpqr-stvwx')
    find('[data-action="share"]').click()
    await flushPromises()
    expect(cloud.share).toHaveBeenCalledWith('story_1', 'abcde-fghjk-mnpqr-stvwx')
    expect(cloud.setDisplay).not.toHaveBeenCalled()
  })

  it('asks for the name others see first, where the account has none', async () => {
    cloud.profile.mockResolvedValue({ id: 1, display: null, friend: CODE })
    await mountDialog()
    await type('[data-field="share-code"]', CODE)
    expect(/** @type {HTMLButtonElement} */ (find('[data-action="share"]')).disabled).toBe(true)
    await type('[data-field="share-display"]', 'Ada')
    find('[data-action="share"]').click()
    await flushPromises()
    expect(cloud.setDisplay).toHaveBeenCalledWith('Ada')
    expect(cloud.share).toHaveBeenCalled()
  })

  it('says why it wasn’t shared', async () => {
    cloud.share.mockRejectedValueOnce(new Error('No one has that friend code.'))
    await mountDialog()
    await type('[data-field="share-code"]', CODE)
    find('[data-action="share"]').click()
    await flushPromises()
    expect(find('[data-share-error]').textContent?.trim()).toBe('No one has that friend code.')
  })

  it('lists who it is shared with, and takes one out', async () => {
    me.value = 1
    sharing.value = {
      me: 1,
      projects: {
        story_1: {
          role: 'owner',
          owner: 1,
          members: [
            { account: 1, owner: true, display: 'Ada' },
            { account: 2, owner: false, display: 'Grace' },
          ],
        },
      },
    }
    await mountDialog()
    const rows = [...document.body.querySelectorAll('[data-member]')]
    expect(rows.map(row => row.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'AdaYou',
      'Grace',
    ])
    expect(rows[0].querySelector('[data-action="remove-member"]')).toBeNull()
    const remove = /** @type {HTMLElement} */ (
      rows[1].querySelector('[data-action="remove-member"]')
    )
    remove.click()
    await flushPromises()
    expect(cloud.removeMember).toHaveBeenCalledWith('story_1', 2)
  })

  it('only lists the people of a project shared with this account', async () => {
    me.value = 2
    sharing.value = {
      me: 2,
      projects: {
        story_1: {
          role: 'member',
          owner: 1,
          members: [
            { account: 1, owner: true, display: 'Ada' },
            { account: 2, owner: false, display: 'Grace' },
          ],
        },
      },
    }
    await mountDialog()
    expect(find('[data-field="share-code"]')).toBeNull()
    expect(document.body.querySelectorAll('[data-action="remove-member"]')).toHaveLength(0)
    expect(find('[data-member="1"]').textContent).toContain('Owner')
  })
})
