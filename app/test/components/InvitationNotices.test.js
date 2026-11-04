import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'

const prime = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn() }))
vi.mock('primevue/usetoast', () => ({ useToast: () => prime }))

const toast = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))

const cloud = vi.hoisted(() => ({
  accept: vi.fn(async () => {}),
  reject: vi.fn(async () => {}),
  block: vi.fn(async () => {}),
}))
vi.mock('@/composables/useCloudSync.js', () => ({ useCloudSync: () => cloud }))

const projects = vi.hoisted(() => ({ restore: vi.fn(async () => {}) }))
vi.mock('@/composables/useProjects.js', () => ({ useProjects: () => projects }))

const stores = vi.hoisted(() => ({
  trash: new Map(),
  roots: new Map(),
}))
vi.mock('@/stores/storiesStore', () => ({
  useStoriesStore: () => ({ trash: stores.trash, loadNames: async () => {} }),
}))
vi.mock('@/stores/documentsStore', () => ({
  useDocumentsStore: () => ({ getRoot: (/** @type {string} */ id) => stores.roots.get(id) }),
}))

import InvitationNotices from '@/components/writer/settings/InvitationNotices.vue'
import BlockDialog from '@/components/writer/settings/BlockDialog.vue'
import { sharing } from '@/cloud/people.js'
import { useBlocking } from '@/composables/useBlocking.js'

const GRACE = { account: 2, name: 'grace', friend: 'ABCDEFGHJKMNPQRSTVWX' }

/**
 * @param {string} collection
 * @param {number} invited
 * @param {string|null} [title]
 */
const invitation = (collection, invited, title = 'Thief') => ({
  collection,
  from: GRACE,
  title,
  invited,
})

/** @param {Array<ReturnType<typeof invitation>>} invitations */
const invited = (invitations, projects = {}) => {
  sharing.value = { me: 1, projects, selective: [], invitations }
}

/** The toast shown for each invitation, as it was added. */
const added = () => prime.add.mock.calls.map(([message]) => message)

/**
 * Press one of a toast's buttons.
 * @param {any} message
 * @param {string} label
 */
const press = (message, label) =>
  message.actions.find((/** @type {any} */ action) => action.label === label).command()

beforeEach(() => {
  vi.clearAllMocks()
  stores.trash.clear()
  stores.roots.clear()
})

afterEach(() => {
  sharing.value = { me: null, projects: {}, selective: [], invitations: [] }
  useBlocking().asking.value = null
})

describe('InvitationNotices', () => {
  const mountNotices = () =>
    mount(InvitationNotices, {
      global: { plugins: [PrimeVue], stubs: { BlockDialog: true } },
    })

  it('shows a toast for each invitation, which stays, with who sent it and their friend code', async () => {
    invited([invitation('c1', 1), invitation('c2', 2, null)])
    mountNotices()
    expect(added().map(message => [message.summary, message.detail, message.life])).toEqual([
      ['grace shared a project with you: Thief', 'Friend code: ABCDE-FGHJK-MNPQR-STVWX', null],
      ['grace shared a project with you.', 'Friend code: ABCDE-FGHJK-MNPQR-STVWX', null],
    ])
    expect(added()[0].actions.map((/** @type {any} */ action) => action.label)).toEqual([
      'Accept',
      'Reject',
      'Block',
    ])

    press(added()[0], 'Accept')
    press(added()[1], 'Reject')
    await flushPromises()
    expect(cloud.accept).toHaveBeenCalledWith('c1')
    expect(cloud.reject).toHaveBeenCalledWith('c2')
  })

  it('takes a toast away once its invitation goes, and shows one made again', async () => {
    invited([invitation('c1', 1)])
    mountNotices()
    const first = added()[0]
    invited([invitation('c1', 1)])
    await flushPromises()
    expect(prime.add).toHaveBeenCalledTimes(1)

    invited([])
    await flushPromises()
    expect(prime.remove).toHaveBeenCalledWith(first)

    invited([invitation('c1', 5)])
    await flushPromises()
    expect(prime.add).toHaveBeenCalledTimes(2)
  })

  it('says why an answer didn’t go', async () => {
    cloud.accept.mockRejectedValueOnce(new Error('The sync server can’t be reached.'))
    invited([invitation('c1', 1)])
    mountNotices()
    press(added()[0], 'Accept')
    await flushPromises()
    expect(toast.error).toHaveBeenCalledWith(
      "The project couldn't be accepted. The sync server can’t be reached."
    )
  })

  it('blocks at once where nothing is shared between the two, and asks first where something is', async () => {
    invited([invitation('c1', 1)])
    mountNotices()
    press(added()[0], 'Block')
    await flushPromises()
    expect(cloud.block).toHaveBeenCalledWith(2)

    invited([invitation('c2', 2)], {
      story_theirs: {
        role: 'member',
        owner: 2,
        members: [
          { account: 2, owner: true, display: 'grace' },
          { account: 1, owner: false, display: 'writer' },
        ],
      },
    })
    await flushPromises()
    press(added()[1], 'Block')
    await flushPromises()
    expect(cloud.block).toHaveBeenCalledTimes(1)
    expect(useBlocking().asking.value).toEqual({
      person: GRACE,
      mine: [],
      theirs: ['story_theirs'],
    })
  })
})

describe('BlockDialog', () => {
  const mountDialog = () =>
    mount(BlockDialog, {
      attachTo: document.body,
      global: { plugins: [PrimeVue] },
    })

  /** @param {string} selector */
  const find = selector => /** @type {HTMLElement} */ (document.body.querySelector(selector))

  const ask = () => {
    stores.roots.set('story_mine', { title: 'Thief' })
    stores.roots.set('story_theirs', { title: 'Heist' })
    stores.roots.set('story_also', { title: 'Alibi' })
    stores.trash.set('story_theirs', {})
    stores.trash.set('story_also', {})
    useBlocking().asking.value = {
      person: GRACE,
      mine: ['story_mine'],
      theirs: ['story_theirs', 'story_also'],
    }
  }

  it('names what ends, and keeps their projects out of the trash unless told to delete them', async () => {
    const wrapper = mountDialog()
    ask()
    await flushPromises()
    expect(find('[data-block-mine]').textContent?.trim()).toBe("They'll be taken out of Thief.")
    expect(find('[data-block-theirs]').textContent?.trim()).toBe("You'll leave Alibi and Heist.")

    find('[data-action="block-confirm"]').click()
    await flushPromises()
    expect(cloud.block).toHaveBeenCalledWith(2)
    expect(projects.restore.mock.calls.map(([id]) => id)).toEqual(['story_theirs', 'story_also'])
    expect(useBlocking().asking.value).toBeNull()
    wrapper.unmount()
  })

  it('leaves their projects in the trash when told to delete them', async () => {
    const wrapper = mountDialog()
    ask()
    await flushPromises()
    find('[data-field="block-delete-theirs"] input').click()
    await flushPromises()
    find('[data-action="block-confirm"]').click()
    await flushPromises()
    expect(cloud.block).toHaveBeenCalledWith(2)
    expect(projects.restore).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('blocks no one when cancelled', async () => {
    const wrapper = mountDialog()
    ask()
    await flushPromises()
    find('[data-action="block-cancel"]').click()
    await flushPromises()
    expect(cloud.block).not.toHaveBeenCalled()
    expect(useBlocking().asking.value).toBeNull()
    wrapper.unmount()
  })
})
