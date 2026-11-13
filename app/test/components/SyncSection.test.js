import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'

const account = ref(/** @type {any} */ (null))
const notice = ref(/** @type {string|null} */ (null))
const usage = ref(/** @type {any} */ (null))
const status = ref(
  /** @type {any} */ ({ phase: 'idle', waiting: 0, last: Date.now(), error: null })
)
const sendsDiagnostics = ref(true)
const sync = vi.hoisted(() => ({
  signUp: vi.fn(),
  signIn: vi.fn(),
  recover: vi.fn(),
  signOut: vi.fn(),
  syncNow: vi.fn(),
  remakeRecovery: vi.fn(),
  changePassphrase: vi.fn(),
  hasRecovery: vi.fn(async () => true),
  devices: vi.fn(async () => []),
  signOutDevice: vi.fn(async () => {}),
  refreshUsage: vi.fn(async () => {}),
  setSendsDiagnostics: vi.fn(),
  profile: vi.fn(async () => ({ id: 1, name: 'writer', friend: 'ABCDE-FGHJK-MNPQR-STVWX' })),
}))
vi.mock('@/composables/useCloudSync.js', () => ({
  useCloudSync: () => ({
    ...sync,
    account,
    notice,
    usage,
    status,
    sendsDiagnostics,
  }),
}))

const invitation = vi.hoisted(() => ({ opened: /** @type {any} */ (null) }))
vi.mock('@/cloud/invite.js', () => ({
  takeInvite: () => {
    const opened = invitation.opened
    invitation.opened = null
    return opened
  },
}))

const updates = vi.hoisted(() => ({ ready: /** @type {any} */ (null) }))
vi.mock('@/composables/useUpdates.js', async () => {
  const { ref } = await import('vue')
  updates.ready = ref(null)
  return { updateReady: updates.ready }
})

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/composables/useToast', () => ({ useToast: () => toast }))

const projects = vi.hoisted(() => ({ stories: /** @type {any} */ (null), roots: new Map() }))
vi.mock('@/stores/storiesStore', async () => {
  const { reactive, ref } = await import('vue')
  projects.stories = ref(new Map())
  // As Pinia gives it: the state's refs unwrapped.
  const store = reactive({ stories: projects.stories, loadNames: async () => {} })
  return { useStoriesStore: () => store }
})
vi.mock('@/stores/documentsStore', () => ({
  useDocumentsStore: () => ({ getRoot: (/** @type {string} */ id) => projects.roots.get(id) }),
}))

import SyncSection from '@/components/writer/settings/SyncSection.vue'

/** @param {string} [part] */
const mountSection = (part = 'account') =>
  mount(SyncSection, {
    props: { part },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: {
        BackupSection: { template: '<div data-backup />' },
        PeopleSection: { template: '<div data-people />' },
      },
    },
  })

/**
 * @param {ReturnType<typeof mountSection>} wrapper
 * @param {string} field
 * @param {string} value
 */
const fill = (wrapper, field, value) => wrapper.find(`[data-field="${field}"]`).setValue(value)

const CODE = '7KQ4M-2XWPD-AB1CD-EF0GH-JK2MN'

beforeEach(() => {
  vi.clearAllMocks()
  account.value = null
  notice.value = null
  usage.value = null
  status.value = { phase: 'idle', waiting: 0, last: Date.now(), error: null }
  updates.ready.value = null
})

afterEach(() => vi.unstubAllEnvs())

describe('SyncSection', () => {
  it('shows the recovery code once the account is made, until the writer is done with it', async () => {
    sync.signUp.mockImplementation(async () => {
      account.value = { server: 'https://sync.example.com', name: 'writer' }
      return CODE
    })
    const wrapper = mountSection()
    await wrapper.findAll('[data-field="sync-mode"] button')[1].trigger('click')
    await fill(wrapper, 'sync-name', 'writer')
    await fill(wrapper, 'sync-passphrase', 'a long passphrase')
    await fill(wrapper, 'sync-code', 'letmein')
    await wrapper.find('[data-action="sync-sign-in"]').trigger('click')
    await flushPromises()

    expect(sync.signUp).toHaveBeenCalledWith({
      server: 'https://sync.inksprite.io',
      name: 'writer',
      passphrase: 'a long passphrase',
      code: 'letmein',
    })
    expect(wrapper.find('[data-recovery-code]').text()).toBe(CODE)
    await wrapper.find('[data-action="recovery-done"]').trigger('click')
    expect(wrapper.find('[data-recovery-shown]').exists()).toBe(false)
  })

  it('recovers an account with its code and a new passphrase, and shows the new code', async () => {
    sync.recover.mockImplementation(async () => {
      account.value = { server: 'https://sync.example.com', name: 'writer' }
      return 'NEW00-NEW00-NEW00-NEW00-NEW00'
    })
    const wrapper = mountSection()
    await wrapper.findAll('[data-field="sync-mode"] button')[2].trigger('click')
    await fill(wrapper, 'sync-name', 'writer')
    await fill(wrapper, 'sync-recovery-code', CODE)
    await fill(wrapper, 'sync-passphrase', 'a new passphrase')
    await wrapper.find('[data-action="sync-sign-in"]').trigger('click')
    await flushPromises()

    expect(sync.recover).toHaveBeenCalledWith({
      server: 'https://sync.inksprite.io',
      name: 'writer',
      passphrase: 'a new passphrase',
      code: CODE,
    })
    expect(wrapper.find('[data-recovery-code]').text()).toBe('NEW00-NEW00-NEW00-NEW00-NEW00')
  })

  it('says sync is in private preview before an account is made', async () => {
    expect(mountSection().find('[data-sync-preview]').text()).toBe(
      'Sync is in private preview. An account needs an invitation.'
    )
    account.value = { server: 'https://sync.inksprite.io', name: 'writer' }
    const signedIn = mountSection()
    await flushPromises()
    expect(signedIn.find('[data-sync-preview]').exists()).toBe(false)
  })

  it('says why this device was signed out', () => {
    notice.value = 'This device was signed out. Sign in again to sync it.'
    expect(mountSection().find('[data-sync-notice]').text()).toContain('was signed out')
  })

  it('lists the devices, and signs another one out', async () => {
    account.value = { server: 'https://sync.example.com', name: 'writer' }
    sync.devices.mockResolvedValue([
      {
        id: 'a'.repeat(64),
        device: 'inksprite on macOS',
        created: 1,
        used: Date.now(),
        current: true,
      },
      {
        id: 'b'.repeat(64),
        device: 'Safari on iPhone',
        created: 1,
        used: Date.now(),
        current: false,
      },
    ])
    const wrapper = mountSection('devices')
    await flushPromises()

    expect(wrapper.find('[data-device="this"]').text()).toContain('This device')
    const phone = wrapper.find(`[data-device="${'b'.repeat(64)}"]`)
    expect(phone.text()).toContain('Safari on iPhone')
    await phone.find('[data-action="sign-out-device"]').trigger('click')
    await flushPromises()

    expect(sync.signOutDevice).toHaveBeenCalledWith('b'.repeat(64))
    expect(wrapper.find(`[data-device="${'b'.repeat(64)}"]`).exists()).toBe(false)
  })

  it('makes a new recovery code with the passphrase, and says when it was wrong', async () => {
    account.value = { server: 'https://sync.example.com', name: 'writer' }
    sync.remakeRecovery.mockRejectedValueOnce(new Error('The passphrase is wrong.'))
    sync.remakeRecovery.mockResolvedValueOnce(CODE)
    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-action="make-recovery"]').trigger('click')
    expect(wrapper.text()).toContain('The code you have now stops working.')
    await fill(wrapper, 'sync-current', 'wrong')
    await wrapper.find('[data-action="sync-confirm"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-sync-error]').text()).toBe('The passphrase is wrong.')

    await fill(wrapper, 'sync-current', 'a long passphrase')
    await wrapper.find('[data-action="sync-confirm"]').trigger('click')
    await flushPromises()
    expect(sync.remakeRecovery).toHaveBeenLastCalledWith('a long passphrase')
    expect(wrapper.find('[data-recovery-code]').text()).toBe(CODE)
  })

  it('changes the passphrase', async () => {
    account.value = { server: 'https://sync.example.com', name: 'writer' }
    const wrapper = mountSection()
    await flushPromises()

    await wrapper.find('[data-action="change-passphrase"]').trigger('click')
    await fill(wrapper, 'sync-current', 'old one')
    await fill(wrapper, 'sync-next', 'new one')
    await wrapper.find('[data-action="sync-confirm"]').trigger('click')
    await flushPromises()

    expect(sync.changePassphrase).toHaveBeenCalledWith('old one', 'new one')
    expect(toast.success).toHaveBeenCalledWith('Changed the passphrase')
    expect(wrapper.find('[data-sync-asking]').exists()).toBe(false)
  })

  it('says what a name may be made of, as an account is made', async () => {
    const wrapper = mountSection()
    expect(wrapper.find('[data-sync-name-format]').exists()).toBe(false)
    await wrapper.findAll('[data-field="sync-mode"] button')[1].trigger('click')
    expect(wrapper.find('[data-sync-name-format]').text()).toBe(
      '3 to 30 letters, digits and hyphens'
    )
  })

  it('signs in to our server, and asks for no other', async () => {
    const wrapper = mountSection()
    expect(wrapper.find('[data-field="sync-server"]').exists()).toBe(false)
    await fill(wrapper, 'sync-name', 'writer')
    await fill(wrapper, 'sync-passphrase', 'a long passphrase')
    await wrapper.find('[data-action="sync-sign-in"]').trigger('click')
    await flushPromises()

    expect(sync.signIn).toHaveBeenCalledWith({
      server: 'https://sync.inksprite.io',
      name: 'writer',
      passphrase: 'a long passphrase',
    })
  })

  it('takes another server in a build with dev features', async () => {
    vi.stubEnv('VITE_DEV_FEATURES', 'true')
    const wrapper = mountSection()
    const field = wrapper.find('[data-field="sync-server"]')
    expect(/** @type {HTMLInputElement} */ (field.element).value).toBe('https://sync.inksprite.io')
    await field.setValue('localhost:8787')
    await fill(wrapper, 'sync-name', 'writer')
    await fill(wrapper, 'sync-passphrase', 'a long passphrase')
    await wrapper.find('[data-action="sync-sign-in"]').trigger('click')
    await flushPromises()

    expect(sync.signIn).toHaveBeenCalledWith(expect.objectContaining({ server: 'localhost:8787' }))
  })

  it('is ready to create an account with the code of an invitation opened, on our server', async () => {
    invitation.opened = { server: 'sync.example.com', code: '7K3M-Q9TX-2HDP' }
    const wrapper = mountSection()
    expect(wrapper.find('[data-field="sync-server"]').exists()).toBe(false)
    expect(
      /** @type {HTMLInputElement} */ (wrapper.find('[data-field="sync-code"]').element).value
    ).toBe('7K3M-Q9TX-2HDP')
    expect(wrapper.find('[data-action="sync-sign-in"]').text()).toBe('Create account')

    await fill(wrapper, 'sync-name', 'writer')
    await fill(wrapper, 'sync-passphrase', 'a long passphrase')
    await wrapper.find('[data-action="sync-sign-in"]').trigger('click')
    await flushPromises()
    expect(sync.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ server: 'https://sync.inksprite.io', code: '7K3M-Q9TX-2HDP' })
    )
  })

  it("takes an invitation's server in a build with dev features", () => {
    vi.stubEnv('VITE_DEV_FEATURES', 'true')
    invitation.opened = { server: 'sync.example.com', code: '7K3M-Q9TX-2HDP' }
    const wrapper = mountSection()
    expect(
      /** @type {HTMLInputElement} */ (wrapper.find('[data-field="sync-server"]').element).value
    ).toBe('sync.example.com')
  })

  it('says how much the account keeps, and when its storage is full', async () => {
    account.value = { server: 'https://sync.inksprite.io', name: 'writer' }
    usage.value = { used: 340 * 1024 * 1024, quota: 2 * 1024 ** 3 }
    const wrapper = mountSection()
    await flushPromises()
    expect(sync.refreshUsage).toHaveBeenCalled()
    expect(wrapper.find('[data-sync-usage]').text()).toBe('340.0 MB of 2 GB used')
    usage.value = { used: 1024, quota: null }
    status.value = { ...status.value, full: true }
    await flushPromises()
    expect(wrapper.find('[data-sync-usage]').text()).toBe('1 KB used')
    expect(wrapper.find('[data-sync-status]').text()).toBe('Sync storage is full')
  })

  it('says what sync is doing in a few words, and what is left of a large sync', async () => {
    account.value = { server: 'https://sync.inksprite.io', name: 'writer' }
    const wrapper = mountSection()
    await flushPromises()
    const line = wrapper.find('[data-sync-status]')
    expect(line.text()).toBe('Up to date')

    // What waits after a round that went through waits on something else.
    status.value = { ...status.value, waiting: 3 }
    await flushPromises()
    expect(line.text()).toBe('Up to date')

    status.value = { ...status.value, phase: 'syncing' }
    await flushPromises()
    expect(line.text()).toBe('Syncing…')
    expect(wrapper.find('[data-action="sync-now"] .pi-spin').exists()).toBe(true)

    status.value = { ...status.value, waiting: 1204 }
    await flushPromises()
    expect(line.text()).toBe('Syncing 1,204 changes…')

    status.value = { ...status.value, phase: 'offline' }
    await flushPromises()
    expect(line.text()).toBe("Can't reach the sync server")
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    status.value = { ...status.value }
    await flushPromises()
    expect(line.text()).toBe('No network connection')
    vi.restoreAllMocks()
  })

  it('keeps signing out with the passphrase and the recovery code, and backups signed in or not', async () => {
    const wrapper = mountSection('backup')
    expect(wrapper.find('[data-backup]').exists()).toBe(true)

    account.value = { server: 'https://sync.inksprite.io', name: 'writer' }
    sync.devices.mockResolvedValueOnce([{ id: 1, device: 'Mac', used: Date.now(), current: true }])
    await flushPromises()
    expect(wrapper.find('[data-backup]').exists()).toBe(true)

    await wrapper.setProps({ part: 'account' })
    const buttons = wrapper.findAll('[data-action]').map(button => button.attributes('data-action'))
    expect(buttons.slice(buttons.indexOf('make-recovery'))).toEqual([
      'make-recovery',
      'change-passphrase',
      'sync-sign-out',
    ])
    await wrapper.find('[data-action="sync-sign-out"]').trigger('click')
    expect(sync.signOut).toHaveBeenCalled()
  })

  it('shows one part at a time, asking the server once however they are gone through', async () => {
    account.value = { server: 'https://sync.inksprite.io', name: 'writer' }
    sync.devices.mockResolvedValue([{ id: 1, device: 'Mac', used: Date.now(), current: true }])
    const wrapper = mountSection()
    await flushPromises()
    expect(wrapper.find('[data-sync-account]').exists()).toBe(true)
    expect(wrapper.find('[data-sync-devices]').exists()).toBe(false)

    await wrapper.setProps({ part: 'devices' })
    expect(wrapper.find('[data-sync-account]').exists()).toBe(false)
    expect(wrapper.find('[data-device="this"]').exists()).toBe(true)

    await wrapper.setProps({ part: 'people' })
    await wrapper.setProps({ part: 'account' })
    await flushPromises()
    expect(sync.devices).toHaveBeenCalledTimes(1)
    expect(sync.profile).toHaveBeenCalledTimes(1)
  })

  it('syncs by hand from beside what it says', async () => {
    account.value = { server: 'https://sync.inksprite.io', name: 'writer' }
    const wrapper = mountSection()
    await flushPromises()
    await wrapper.find('[data-action="sync-now"]').trigger('click')
    expect(sync.syncNow).toHaveBeenCalled()
  })

  it('says quietly that it waits for an update, and offers the one ready', async () => {
    account.value = { server: 'https://sync.inksprite.io', name: 'writer' }
    status.value = { phase: 'held', waiting: 2, last: Date.now(), error: null }
    const wrapper = mountSection()
    await flushPromises()
    const line = wrapper.find('[data-sync-status]')
    expect(line.text()).toBe('Update inksprite to keep syncing')
    expect(line.classes()).not.toContain('text-red-600')
    expect(wrapper.find('[data-action="sync-update"]').exists()).toBe(false)

    const apply = vi.fn(async () => {})
    updates.ready.value = { version: '0.1.0-dev.21', apply }
    await flushPromises()
    await wrapper.find('[data-action="sync-update"]').trigger('click')
    expect(apply).toHaveBeenCalled()

    status.value = { ...status.value, phase: 'idle' }
    await flushPromises()
    expect(wrapper.find('[data-action="sync-update"]').exists()).toBe(false)
  })

  it('names the projects kept on this device only', async () => {
    account.value = { server: 'https://sync.inksprite.io', name: 'writer' }
    projects.stories.value = new Map([
      ['story_a', { id: 'story_a', syncOff: 1 }],
      ['story_b', { id: 'story_b' }],
      ['story_c', { id: 'story_c', syncOff: 2 }],
      ['story_d', { id: 'story_d', keptElsewhere: 3, trashed: 3 }],
    ])
    projects.roots = new Map([
      ['story_a', { title: 'Thief' }],
      ['story_b', { title: 'Synced' }],
      ['story_c', { title: 'Notes' }],
    ])
    const wrapper = mountSection()
    expect(wrapper.find('[data-sync-kept-here]').text()).toBe(
      'Notes and Thief are kept on this device only.'
    )
    projects.stories.value = new Map()
  })

  it('shows the friend code in the account, apart from the people', async () => {
    account.value = { server: 'https://sync.inksprite.io', name: 'writer' }
    const wrapper = mountSection()
    await flushPromises()
    expect(wrapper.find('[data-friend-code]').text()).toBe('ABCDE-FGHJK-MNPQR-STVWX')
    expect(wrapper.find('[data-people]').exists()).toBe(false)
    await wrapper.setProps({ part: 'people' })
    expect(wrapper.find('[data-people]').exists()).toBe(true)
  })

  it('shows nothing of sharing for a server without it', async () => {
    sync.profile.mockRejectedValueOnce(new Error('There is nothing here.'))
    account.value = { server: 'https://sync.inksprite.io', name: 'writer' }
    const wrapper = mountSection()
    await flushPromises()
    expect(wrapper.find('[data-friend-code]').exists()).toBe(false)
    await wrapper.setProps({ part: 'people' })
    expect(wrapper.find('[data-people]').exists()).toBe(false)
  })

  it('turns diagnostics off for this device', async () => {
    account.value = { server: 'https://sync.inksprite.io', name: 'writer' }
    const wrapper = mountSection()
    await wrapper.find('[data-sync-diagnostics] input').setValue(false)
    expect(sync.setSendsDiagnostics).toHaveBeenCalledWith(false)
  })
})

describe('SyncSection, what the server said last', () => {
  const MAC = { id: 'a'.repeat(64), device: 'inksprite on macOS', used: 1, current: true }
  const PHONE = { id: 'b'.repeat(64), device: 'Safari on iPhone', used: 1, current: false }

  /** The devices listed, by name. */
  const listed = wrapper =>
    wrapper.findAll('[data-sync-devices] li span:first-child').map(one => one.text())

  /** Open the settings once on an account, as the server answers, and close them. */
  const lookOnce = async () => {
    sync.devices.mockResolvedValueOnce([PHONE, MAC])
    const wrapper = mountSection('devices')
    await flushPromises()
    wrapper.unmount()
  }

  it('has the devices and the friend code at once the next time the settings open', async () => {
    account.value = { server: 'https://sync.inksprite.io', name: 'returning' }
    await lookOnce()
    // The server slow to answer this time.
    sync.devices.mockReturnValueOnce(new Promise(() => {}))
    sync.profile.mockReturnValueOnce(new Promise(() => {}))

    const wrapper = mountSection('devices')

    // This device first, as it was listed.
    expect(listed(wrapper)).toEqual(['inksprite on macOS', 'Safari on iPhone'])
    await wrapper.setProps({ part: 'account' })
    expect(wrapper.find('[data-friend-code]').text()).toBe('ABCDE-FGHJK-MNPQR-STVWX')
    await wrapper.setProps({ part: 'people' })
    expect(wrapper.find('[data-people]').exists()).toBe(true)
  })

  it('brings them up to date as the server answers again', async () => {
    account.value = { server: 'https://sync.inksprite.io', name: 'updated' }
    await lookOnce()
    sync.devices.mockResolvedValueOnce([MAC])

    const wrapper = mountSection('devices')
    expect(listed(wrapper)).toHaveLength(2)
    await flushPromises()

    expect(listed(wrapper)).toEqual(['inksprite on macOS'])
    expect(sync.devices).toHaveBeenCalledTimes(2)
  })

  it('remembers a device signed out from here as gone', async () => {
    account.value = { server: 'https://sync.inksprite.io', name: 'tidy' }
    sync.devices.mockResolvedValueOnce([MAC, PHONE])
    const first = mountSection('devices')
    await flushPromises()
    await first.find('[data-action="sign-out-device"]').trigger('click')
    await flushPromises()
    first.unmount()
    sync.devices.mockReturnValueOnce(new Promise(() => {}))

    expect(listed(mountSection('devices'))).toEqual(['inksprite on macOS'])
  })

  it('shows one account nothing of what was said of another', async () => {
    account.value = { server: 'https://sync.inksprite.io', name: 'first-writer' }
    await lookOnce()
    account.value = { server: 'https://sync.inksprite.io', name: 'second-writer' }
    sync.devices.mockReturnValueOnce(new Promise(() => {}))
    sync.profile.mockReturnValueOnce(new Promise(() => {}))

    const wrapper = mountSection('devices')

    expect(listed(wrapper)).toEqual([])
    await wrapper.setProps({ part: 'account' })
    expect(wrapper.find('[data-friend-code]').exists()).toBe(false)
  })

  it('lists no devices for a server that lists none, and goes on', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    account.value = { server: 'https://sync.inksprite.io', name: 'older-server' }
    sync.devices.mockRejectedValueOnce(new Error('There is nothing here.'))

    const wrapper = mountSection('devices')
    await flushPromises()

    expect(wrapper.find('[data-sync-devices]').exists()).toBe(true)
    expect(listed(wrapper)).toEqual([])
    await wrapper.setProps({ part: 'account' })
    expect(wrapper.find('[data-sync-account]').text()).toContain('Signed in as older-server')
    vi.restoreAllMocks()
  })

  it('forgets what it showed once signed out', async () => {
    account.value = { server: 'https://sync.inksprite.io', name: 'leaving' }
    sync.devices.mockResolvedValueOnce([MAC])
    const wrapper = mountSection('devices')
    await flushPromises()
    expect(listed(wrapper)).toHaveLength(1)

    account.value = null
    await flushPromises()

    expect(listed(wrapper)).toEqual([])
    await wrapper.setProps({ part: 'account' })
    expect(wrapper.find('[data-field="sync-mode"]').exists()).toBe(true)
  })
})
