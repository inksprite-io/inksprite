/* global Event, KeyboardEvent */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import PrimeVue from 'primevue/config'
import ContextMenu from 'primevue/contextmenu'

const people = ref(/** @type {any} */ (null))
const cloud = vi.hoisted(() => ({
  block: vi.fn(async () => {}),
  unblock: vi.fn(async () => {}),
  addPerson: vi.fn(async () => {}),
  forgetPerson: vi.fn(async () => {}),
  refreshPeople: vi.fn(async () => {}),
}))
vi.mock('@/composables/useCloudSync.js', () => ({
  useCloudSync: () => ({ ...cloud, people }),
}))

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/composables/useToast.js', () => ({ useToast: () => toast }))

import PeopleSection from '@/components/writer/settings/PeopleSection.vue'
import { sharing } from '@/cloud/people.js'
import { useBlocking } from '@/composables/useBlocking.js'

const GRACE = { account: 2, name: 'grace', friend: 'ABCDEFGHJKMNPQRSTVWX' }
const GIL = { account: 3, name: 'gil', friend: 'BBCDEFGHJKMNPQRSTVWX' }
const EX = { account: 4, name: 'someone', friend: 'CBCDEFGHJKMNPQRSTVWX' }

/** @type {import('@vue/test-utils').VueWrapper|null} */
let wrapper = null

const mountPeople = async () => {
  wrapper = mount(PeopleSection, {
    attachTo: document.body,
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })
  await flushPromises()
  // Open, as it was left.
  const title = wrapper.find('button[aria-expanded]')
  if (title.attributes('aria-expanded') !== 'true') await title.trigger('click')
  return wrapper
}

/** @param {string} selector */
const find = selector => /** @type {HTMLElement} */ (document.body.querySelector(selector))

/** @param {string} selector */
const texts = selector =>
  [...document.body.querySelectorAll(selector)].map(element => element.textContent?.trim())

/**
 * Someone's menu, by its items' labels, and what each does.
 * @param {number} account
 */
async function menuOf(account) {
  find(`[data-person="${account}"]`).dispatchEvent(new Event('contextmenu', { bubbles: true }))
  await flushPromises()
  return /** @type {any[]} */ (
    /** @type {any} */ (wrapper).findComponent(ContextMenu).props('model')
  )
}

/** @param {any[]} items */
const labels = items => items.map(item => item.label)

beforeEach(() => {
  vi.clearAllMocks()
  people.value = { people: [GRACE, GIL], blocked: [EX] }
  sharing.value = {
    me: 1,
    projects: {
      story_1: {
        role: 'owner',
        owner: 1,
        members: [
          { account: 1, owner: true, display: 'writer' },
          { account: 2, owner: false, display: 'grace' },
        ],
      },
    },
    selective: [],
    invitations: [],
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  wrapper?.unmount()
  wrapper = null
  sharing.value = { me: null, projects: {}, selective: [], invitations: [] }
  useBlocking().asking.value = null
})

describe('PeopleSection', () => {
  it('lists the people by name alone, asked for afresh, and not those blocked', async () => {
    await mountPeople()
    expect(cloud.refreshPeople).toHaveBeenCalled()
    expect(texts('[data-person-name]')).toEqual(['grace', 'gil'])
    expect(document.body.textContent).not.toContain('ABCDE')
  })

  it('copies someone’s friend code, and forgets them only while nothing is shared with them', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await mountPeople()

    expect(labels(await menuOf(2))).toEqual(['Copy friend code', 'Block'])
    const gil = await menuOf(3)
    expect(labels(gil)).toEqual(['Copy friend code', 'Forget', 'Block'])
    await gil[0].command()
    expect(writeText).toHaveBeenCalledWith('BBCDE-FGHJK-MNPQR-STVWX')
    await gil[1].command()
    await flushPromises()
    expect(cloud.forgetPerson).toHaveBeenCalledWith(3)
  })

  it('blocks someone nothing is shared with at once, and asks first for someone it is', async () => {
    await mountPeople()
    ;(await menuOf(3))[2].command()
    await flushPromises()
    expect(cloud.block).toHaveBeenCalledWith(3)
    ;(await menuOf(2))[1].command()
    await flushPromises()
    expect(cloud.block).toHaveBeenCalledTimes(1)
    expect(useBlocking().asking.value).toEqual({ person: GRACE, mine: ['story_1'], theirs: [] })
  })

  it('shows those blocked only when asked, each to unblock', async () => {
    await mountPeople()
    find('[data-action="show-blocked"]').click()
    await flushPromises()
    expect(texts('[data-person-name]')).toEqual(['grace', 'gil', 'someone'])
    expect(find('[data-person="4"] [data-person-blocked]')).not.toBeNull()
    const items = await menuOf(4)
    expect(labels(items)).toEqual(['Copy friend code', 'Unblock'])
    items[1].command()
    await flushPromises()
    expect(cloud.unblock).toHaveBeenCalledWith(4)

    find('[data-action="show-blocked"]').click()
    await flushPromises()
    expect(texts('[data-person-name]')).toEqual(['grace', 'gil'])
  })

  it('has no button for those blocked when there are none', async () => {
    people.value = { people: [GRACE], blocked: [] }
    await mountPeople()
    expect(find('[data-action="show-blocked"]')).toBeNull()
  })

  it('adds someone by their friend code, from the +', async () => {
    await mountPeople()
    find('[data-action="add-person"]').click()
    await flushPromises()
    const field = /** @type {HTMLInputElement} */ (find('[data-field="add-person"]'))
    field.value = 'not a code'
    field.dispatchEvent(new Event('input'))
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    expect(cloud.addPerson).not.toHaveBeenCalled()
    expect(find('[data-people-error]').textContent?.trim()).toBe("That isn't a friend code.")

    field.value = 'cbcde-fghjk-mnpqr-stvwx'
    field.dispatchEvent(new Event('input'))
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    await flushPromises()
    expect(cloud.addPerson).toHaveBeenCalledWith('cbcde-fghjk-mnpqr-stvwx')
    expect(find('[data-field="add-person"]')).toBeNull()
  })

  it('says why something couldn’t be done', async () => {
    cloud.forgetPerson.mockRejectedValueOnce(new Error('The sync server can’t be reached.'))
    await mountPeople()
    ;(await menuOf(3))[1].command()
    await flushPromises()
    expect(find('[data-people-error]').textContent?.trim()).toBe(
      'The sync server can’t be reached.'
    )
  })
})
