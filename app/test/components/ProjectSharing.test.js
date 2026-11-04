/* global Event */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import ProjectSharing from '@/components/writer/settings/ProjectSharing.vue'
import { me, sharing } from '@/cloud/people.js'
import { clearDocumentInstances, useDocuments } from '@/composables/useDocuments'
import { useDocumentsStore } from '@/stores/documentsStore'

const cloud = vi.hoisted(() => ({
  share: vi.fn(async () => {}),
  setSelective: vi.fn(async () => {}),
  removeMember: vi.fn(async () => {}),
  refreshPeople: vi.fn(async () => {}),
  account: { value: /** @type {any} */ (null) },
  people: { value: /** @type {any} */ (null) },
}))
vi.mock('@/composables/useCloudSync.js', () => ({ useCloudSync: () => cloud }))

vi.mock('@/stores/db', () => ({
  default: {
    documents: {
      where: vi.fn(() => ({ equals: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })),
    },
  },
}))

vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

const CODE = 'ABCDE-FGHJK-MNPQR-STVWX'

/** @type {import('@vue/test-utils').VueWrapper|null} */
let wrapper = null

const mountSharing = async () => {
  wrapper = mount(ProjectSharing, {
    props: { storyId: 'story_1' },
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
  setActivePinia(createPinia())
  clearDocumentInstances()
  vi.clearAllMocks()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  me.value = null
  sharing.value = { me: null, projects: {}, selective: [], invitations: [] }
  cloud.people.value = null
  vi.unstubAllEnvs()
})

describe('ProjectSharing', () => {
  it('shares the project with a friend’s code once it reads as one', async () => {
    await mountSharing()
    await type('[data-field="share-code"]', 'abcde-fghjk')
    expect(/** @type {HTMLButtonElement} */ (find('[data-action="share"]')).disabled).toBe(true)
    await type('[data-field="share-code"]', 'abcde-fghjk-mnpqr-stvwx')
    find('[data-action="share"]').click()
    await flushPromises()
    expect(cloud.share).toHaveBeenCalledWith('story_1', CODE)
  })

  it('offers the people this account shares with, and shares with one by name', async () => {
    cloud.people.value = {
      people: [
        { account: 2, name: 'grace', friend: 'ABCDEFGHJKMNPQRSTVWX' },
        { account: 3, name: 'gil', friend: 'BBCDEFGHJKMNPQRSTVWX' },
        { account: 4, name: 'ada', friend: 'CBCDEFGHJKMNPQRSTVWX' },
      ],
      blocked: [],
    }
    me.value = 1
    sharing.value = {
      me: 1,
      projects: {
        story_1: {
          role: 'owner',
          owner: 1,
          members: [
            { account: 1, owner: true, display: 'writer' },
            { account: 4, owner: false, display: 'ada' },
          ],
        },
      },
      selective: [],
      invitations: [],
    }
    await mountSharing()
    const field = find('[data-field="share-code"]')
    field.dispatchEvent(new Event('focus'))
    await flushPromises()
    /** The people offered, by name. */
    const offered = () =>
      [...document.body.querySelectorAll('[data-suggestion]')].map(option =>
        option.querySelector('span')?.textContent?.trim()
      )
    // Not those it is shared with already.
    expect(offered()).toEqual(['grace', 'gil'])
    await type('[data-field="share-code"]', 'gr')
    expect(offered()).toEqual(['grace'])
    find('[data-suggestion="2"]').dispatchEvent(new Event('mousedown'))
    await flushPromises()
    expect(/** @type {HTMLInputElement} */ (field).value).toBe('grace')
    expect(offered()).toEqual([])
    find('[data-action="share"]').click()
    await flushPromises()
    expect(cloud.share).toHaveBeenCalledWith('story_1', 'ABCDE-FGHJK-MNPQR-STVWX')
  })

  it('marks someone invited until they answer, and takes the invitation back', async () => {
    me.value = 1
    sharing.value = {
      me: 1,
      projects: {
        story_1: {
          role: 'owner',
          owner: 1,
          members: [
            { account: 1, owner: true, display: 'writer' },
            { account: 2, owner: false, display: 'grace', invited: true },
            { account: 3, owner: false, display: 'gil' },
          ],
        },
      },
      selective: [],
      invitations: [],
    }
    await mountSharing()
    const rows = [...document.body.querySelectorAll('[data-member]')]
    expect(rows.map(row => Boolean(row.querySelector('[data-member-invited]')))).toEqual([
      false,
      true,
      false,
    ])
    const takeBack = /** @type {HTMLElement} */ (
      rows[1].querySelector('[data-action="remove-member"]')
    )
    takeBack.click()
    await flushPromises()
    expect(cloud.removeMember).toHaveBeenCalledWith('story_1', 2)
  })

  it('says why it wasn’t shared', async () => {
    cloud.share.mockRejectedValueOnce(new Error('No one has that friend code.'))
    await mountSharing()
    await type('[data-field="share-code"]', CODE)
    find('[data-action="share"]').click()
    await flushPromises()
    expect(find('[data-share-error]').textContent?.trim()).toBe('No one has that friend code.')
  })

  it('lists who it is shared with, each by name and friend code, and takes one out', async () => {
    me.value = 1
    sharing.value = {
      me: 1,
      projects: {
        story_1: {
          role: 'owner',
          owner: 1,
          members: [
            { account: 1, owner: true, display: 'Ada', friend: 'ABCDEFGHJKMNPQRSTVWX' },
            { account: 2, owner: false, display: 'Grace', friend: null },
          ],
        },
      },
      selective: [],
      invitations: [],
    }
    await mountSharing()
    const rows = [...document.body.querySelectorAll('[data-member]')]
    /** @param {Element} row @param {string} part */
    const text = (row, part) => row.querySelector(part)?.textContent?.trim() ?? null
    expect(rows.map(row => text(row, '[data-member-name]'))).toEqual(['Ada', 'Grace'])
    expect(rows.map(row => text(row, '[data-member-tag]'))).toEqual(['You', null])
    // Grouped as it is typed; a server from before codes were listed has none.
    expect(rows.map(row => text(row, '[data-member-friend]'))).toEqual([CODE, ''])
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
      selective: [],
      invitations: [],
    }
    await mountSharing()
    expect(find('[data-field="share-code"]')).toBeNull()
    expect(document.body.querySelectorAll('[data-action="remove-member"]')).toHaveLength(0)
    expect(find('[data-member="1"]').textContent).toContain('Owner')
  })
})

describe('ProjectSharing, sharing only some documents', () => {
  /** @type {ReturnType<typeof useDocuments>} */
  let api

  beforeEach(async () => {
    vi.stubEnv('VITE_PREVIEW', 'selective-sharing')
    api = useDocuments('story_1')
    await api.init()
  })

  /** The switch for sharing it whole. */
  const whole = () => /** @type {HTMLInputElement} */ (find('[data-field="share-whole"] input'))

  /** Turn sharing it whole on or off, as the writer clicks it. */
  async function flip() {
    whole().click()
    await flushPromises()
  }

  /** @param {string} id */
  const box = id => /** @type {HTMLInputElement} */ (find(`[data-share-node="${id}"] input`))

  it('shares only the documents ticked, from the moment they are', async () => {
    cloud.setSelective.mockImplementation(async (storyId, on) => {
      sharing.value = { ...sharing.value, selective: on ? [storyId] : [] }
    })
    const store = useDocumentsStore()
    const notes = api.createFolder(api.root.value.id, 'Notes')
    const note = api.createTextDocument(notes.id, 'A note')
    const chapter = api.createTextDocument(api.root.value.id, 'Chapter 1')
    await mountSharing()
    // Shared whole, every box is ticked and none can be clicked.
    expect(whole().checked).toBe(true)
    expect(find('[data-share-tree]').getAttribute('aria-disabled')).toBe('true')
    expect(box(notes.id).checked).toBe(true)
    expect(box(notes.id).disabled).toBe(true)

    await flip()
    expect(cloud.setSelective).toHaveBeenCalledWith('story_1', true)
    expect(whole().checked).toBe(false)
    expect(find('[data-share-tree]').getAttribute('aria-disabled')).toBeNull()
    expect(box(chapter.id).checked).toBe(true)
    expect(box(chapter.id).disabled).toBe(false)

    // Nothing shared, from the project's own box; then the chapter again.
    box(api.root.value.id).click()
    await flushPromises()
    for (const id of [api.root.value.id, notes.id, note.id, chapter.id]) {
      expect(store.getDocument(id).unshared).toBe(true)
    }
    box(chapter.id).click()
    await flushPromises()
    expect(store.getDocument(chapter.id).unshared).toBe(false)
    // The project itself is only on the way to it; what is made at the top level isn't shared.
    expect(api.root.value.unshared).toBe(true)
    expect(box(api.root.value.id).closest('[data-p-indeterminate]')).not.toBeNull()
    expect(box(notes.id).checked).toBe(false)

    await flip()
    expect(cloud.setSelective).toHaveBeenLastCalledWith('story_1', false)
    expect(whole().checked).toBe(true)
    expect(box(notes.id).checked).toBe(true)
    expect(box(notes.id).disabled).toBe(true)
  })

  it('opens as the project is shared, and goes back when the choice can’t be made', async () => {
    sharing.value = { me: null, projects: {}, selective: ['story_1'] }
    await mountSharing()
    expect(whole().checked).toBe(false)

    cloud.setSelective.mockRejectedValueOnce(
      new Error("This project isn't on the sync server yet. Try again once it has synced.")
    )
    await flip()
    expect(whole().checked).toBe(false)
    expect(find('[data-share-error]').textContent?.trim()).toBe(
      "This project isn't on the sync server yet. Try again once it has synced."
    )
  })

  it('offers no choice to someone it is shared with, or without the preview', async () => {
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
      selective: [],
      invitations: [],
    }
    await mountSharing()
    expect(find('[data-field="share-whole"]')).toBeNull()
    expect(find('[data-share-tree]')).toBeNull()
    wrapper?.unmount()

    sharing.value = { me: null, projects: {}, selective: [], invitations: [] }
    vi.stubEnv('VITE_PREVIEW', '')
    await mountSharing()
    expect(find('[data-field="share-whole"]')).toBeNull()
    expect(find('[data-share-tree]')).toBeNull()
  })
})
