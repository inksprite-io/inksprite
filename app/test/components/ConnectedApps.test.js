import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DOMWrapper, mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import PrimeVue from 'primevue/config'

/**
 * The native side, stood in for: the connections it keeps, its port, and
 * whether their apps can get in, each changed as the page asks.
 */
const native = vi.hoisted(() => {
  const kept = {
    port: 4657,
    enabled: true,
    connections: /** @type {any[]} */ ([]),
    problem: /** @type {string|null} */ (null),
    called: /** @type {Record<string, number>} */ ({}),
  }
  let made = 0

  /** What the page is told: the connections, and whether they can get in. */
  const state = () => ({
    port: kept.port,
    enabled: kept.enabled,
    connections: kept.connections.map(one => ({ ...one })),
    listening: kept.enabled && kept.connections.length > 0 && !kept.problem,
    problem: kept.problem,
    called: { ...kept.called },
  })

  /** @param {string} id */
  const find = id => kept.connections.find(one => one.id === id)

  /**
   * Make a connection as the native side does: with a token of its own, no
   * project ticked, and writing.
   * @param {object} given - Its name, and anything else it is to start with
   */
  const make = given => {
    const one = {
      id: `app_${++made}`,
      token: `tok${made}-not-to-be-shown`,
      projects: [],
      readOnly: false,
      created: made,
      ...given,
    }
    kept.connections.push(one)
    return one
  }

  return {
    kept,
    /** As a fresh install has it: no connection, and apps let in. */
    reset() {
      Object.assign(kept, { port: 4657, enabled: true, connections: [], problem: null, called: {} })
      made = 0
    },
    /**
     * A connection there already.
     * @param {object} [given]
     */
    has: (given = {}) => make({ name: 'Claude Code', ...given }),
    platform: {
      listApps: vi.fn(async () => state()),
      addApp: vi.fn(async name => ({ ...make({ name }) })),
      updateApp: vi.fn(async (id, patch) => {
        // A name is kept trimmed, as the native side keeps it.
        Object.assign(find(id), patch, 'name' in patch ? { name: patch.name.trim() } : {})
        return { ...find(id) }
      }),
      removeApp: vi.fn(async id => {
        kept.connections = kept.connections.filter(one => one.id !== id)
      }),
      setAppsPort: vi.fn(async port => {
        if (port < 1024 || port > 65535) throw new Error('A port is a number from 1024 to 65535.')
        kept.port = port
        return state()
      }),
      setAppsEnabled: vi.fn(async enabled => {
        kept.enabled = enabled
        return state()
      }),
    },
  }
})
vi.mock('@/platform/apps.js', () => native.platform)

/** The writer's projects, as the list of them has them. */
const rows = ref(/** @type {{id: string, name: string}[]} */ ([]))
const init = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/composables/useProjects.js', () => ({ useProjects: () => ({ rows, init }) }))

const toast = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('@/composables/useToast', () => ({ useToast: () => toast }))

import ConnectedApps from '@/components/writer/settings/ConnectedApps.vue'
import { useConnectedApps } from '@/composables/useConnectedApps.js'
import { SECTION_HEADING } from '@/components/common/sectionHeading.js'

const THIEF = { id: 'story_thief', name: 'Thief' }
const NOTES = { id: 'story_notes', name: 'Field notes' }
const RECIPES = { id: 'story_recipes', name: 'Recipes' }

const MINUTE = 60000
const HOUR = 60 * MINUTE

/** @param {object} [given] - What it is mounted in: a section's heading, say */
const mountApps = async (given = {}) => {
  const wrapper = mount(ConnectedApps, {
    attachTo: document.body,
    global: { plugins: [PrimeVue], directives: { tooltip: {} }, ...given },
  })
  await flushPromises()
  return wrapper
}

/** A connection's card. */
const card = (wrapper, id) => wrapper.find(`[data-app="${id}"]`)

/** Open a connection's card, or shut it, by a click on its name. */
const clickCard = (wrapper, id) => card(wrapper, id).find('[data-card-toggle]').trigger('click')

/**
 * Mount it with one connection there, its card open.
 * @param {object} [patch] - What the connection has besides a name
 * @param {object} [given] - What it is mounted in
 */
const mountOpen = async (patch = {}, given = {}) => {
  const app = native.has(patch)
  const wrapper = await mountApps(given)
  await clickCard(wrapper, app.id)
  return { wrapper, app, open: () => card(wrapper, app.id) }
}

/**
 * What a card says before it is opened, a part at a time: its name, the line
 * under it, and what is on its right, where anything is.
 */
const says = (wrapper, id) =>
  card(wrapper, id)
    .find('[data-card-toggle]')
    .findAll('span')
    .filter(span => span.element.children.length === 0)
    .map(span => span.text())

/** The names of the cards, in order. */
const names = wrapper =>
  wrapper.findAll('[data-app]').map(one => says(wrapper, one.attributes('data-app'))[0])

/** The line under a card's name. */
const lineOf = (wrapper, id) => says(wrapper, id)[1]

/** The projects listed in the open card, by name. */
const listed = wrapper => wrapper.findAll('[data-app-project]').map(one => one.text())

/** A project's tick in the open card. */
const tickOf = (wrapper, project) => wrapper.find(`[data-app-project="${project.id}"] input`)

/** Tick a project, or untick it, as a click on it does. */
const tick = async (wrapper, project) => {
  await tickOf(wrapper, project).trigger('change')
  await flushPromises()
}

/** The switch that has a connection only read. */
const readOnlySwitch = wrapper => wrapper.find('[data-app-read-only] input')

/** A row of what the app is set up with: its label, and what it shows. */
const setup = (wrapper, row) => wrapper.find(`[data-setup="${row}"]`)

beforeEach(() => {
  // Reset, not only cleared: a failure queued for a call that never came
  // would be the next test's.
  vi.resetAllMocks()
  native.reset()
  rows.value = [THIEF, NOTES]
  // One state for the app, so the last test's is still there.
  useConnectedApps().state.value = null
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('ConnectedApps', () => {
  it('lists each app as a card, by its name, with the projects it is let into under it', async () => {
    const first = native.has({ name: 'Claude Code', projects: [NOTES.id, THIEF.id] })
    const second = native.has({ name: 'The other agent' })
    const wrapper = await mountApps()

    expect(names(wrapper)).toEqual(['Claude Code', 'The other agent'])
    // In the order the projects are listed, not the order they were ticked.
    expect(lineOf(wrapper, first.id)).toBe('Thief, Field notes')
    expect(lineOf(wrapper, second.id)).toBe('No projects')
    // Shut, to start with.
    expect(wrapper.find('[data-card-body]').exists()).toBe(false)
  })

  it('says under its name that an app only reads', async () => {
    const some = native.has({ projects: [THIEF.id], readOnly: true })
    const none = native.has({ name: 'The other agent', readOnly: true })
    const wrapper = await mountApps()

    expect(lineOf(wrapper, some.id)).toBe('Thief · Read only')
    expect(lineOf(wrapper, none.id)).toBe('No projects · Read only')
  })

  it('leaves out of the line a project that is no longer there', async () => {
    const app = native.has({ projects: ['story_gone', THIEF.id] })
    const wrapper = await mountApps()

    expect(lineOf(wrapper, app.id)).toBe('Thief')
  })

  it('says when an app last called, on its card, and nothing for one that hasn’t', async () => {
    const lately = native.has()
    const earlier = native.has({ name: 'The other agent' })
    const never = native.has({ name: 'A third' })
    native.kept.called = {
      [lately.id]: Date.now() - 5 * MINUTE,
      [earlier.id]: Date.now() - 3 * HOUR,
    }
    const wrapper = await mountApps()

    expect(says(wrapper, lately.id)).toEqual(['Claude Code', 'No projects', '5m ago'])
    expect(says(wrapper, earlier.id)).toEqual(['The other agent', 'No projects', '3h ago'])
    expect(says(wrapper, never.id)).toEqual(['A third', 'No projects'])
  })

  it('says the apps couldn’t be read, where they couldn’t', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    native.platform.listApps.mockRejectedValueOnce(new Error('No such channel.'))

    const wrapper = await mountApps()

    expect(toast.error).toHaveBeenCalledWith("The connected apps couldn't be read.")
    expect(wrapper.find('[data-card-list]').exists()).toBe(false)
  })

  it('reads the projects, for an app’s to be ticked from', async () => {
    await mountApps()

    expect(init).toHaveBeenCalled()
  })

  describe('adding an app', () => {
    it('makes the connection as Claude Code, and opens its card', async () => {
      const wrapper = await mountApps()

      await wrapper.find('[data-action="add-app"]').trigger('click')
      await flushPromises()

      expect(native.platform.addApp).toHaveBeenCalledWith('Claude Code')
      const [made] = native.kept.connections
      expect(names(wrapper)).toEqual(['Claude Code'])
      expect(lineOf(wrapper, made.id)).toBe('No projects')
      expect(card(wrapper, made.id).find('[data-card-toggle]').attributes('aria-expanded')).toBe(
        'true'
      )
      // Whole: its projects, and what the app is set up with.
      const body = card(wrapper, made.id).find('[data-card-body]')
      expect(listed(body)).toEqual(['Thief', 'Field notes'])
      expect(body.find('[data-app-setup]').exists()).toBe(true)
    })

    it('opens it on its name, selected to type over', async () => {
      const wrapper = await mountApps()

      await wrapper.find('[data-action="add-app"]').trigger('click')
      await flushPromises()

      const field = /** @type {HTMLInputElement} */ (
        wrapper.find('[data-field="app-rename"]').element
      )
      expect(field.value).toBe('Claude Code')
      expect(document.activeElement).toBe(field)
      expect([field.selectionStart, field.selectionEnd]).toEqual([0, 'Claude Code'.length])
    })

    it('numbers the name where it is taken', async () => {
      native.has({ name: 'Claude Code' })
      const wrapper = await mountApps()

      await wrapper.find('[data-action="add-app"]').trigger('click')
      await flushPromises()
      await wrapper.find('[data-action="add-app"]').trigger('click')
      await flushPromises()

      expect(native.platform.addApp.mock.calls).toEqual([['Claude Code (2)'], ['Claude Code (3)']])
      expect(names(wrapper)).toEqual(['Claude Code', 'Claude Code (2)', 'Claude Code (3)'])
    })

    it('shuts the card that was open for the new one’s', async () => {
      const before = native.has({ name: 'The other agent' })
      const wrapper = await mountApps()
      await clickCard(wrapper, before.id)

      await wrapper.find('[data-action="add-app"]').trigger('click')
      await flushPromises()

      const made = native.kept.connections[1]
      expect(wrapper.findAll('[data-card-body]')).toHaveLength(1)
      expect(card(wrapper, made.id).find('[data-card-body]').exists()).toBe(true)
    })

    it('adds one app for two clicks in a row', async () => {
      const wrapper = await mountApps()

      wrapper.find('[data-action="add-app"]').trigger('click')
      wrapper.find('[data-action="add-app"]').trigger('click')
      await flushPromises()

      expect(native.platform.addApp).toHaveBeenCalledTimes(1)
      // And another once the first is made.
      await wrapper.find('[data-action="add-app"]').trigger('click')
      await flushPromises()
      expect(native.kept.connections.map(one => one.name)).toEqual([
        'Claude Code',
        'Claude Code (2)',
      ])
    })

    it('says so when one couldn’t be added, and opens nothing', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      native.platform.addApp.mockRejectedValueOnce(new Error('The file couldn’t be written.'))
      const wrapper = await mountApps()

      await wrapper.find('[data-action="add-app"]').trigger('click')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith("The app couldn't be added.")
      expect(wrapper.find('[data-card-body]').exists()).toBe(false)
    })
  })

  describe('an app’s card', () => {
    it('opens one at a time, and shuts on a click on its name or Done', async () => {
      const first = native.has()
      const second = native.has({ name: 'The other agent' })
      const wrapper = await mountApps()

      await clickCard(wrapper, first.id)
      await clickCard(wrapper, second.id)
      expect(wrapper.findAll('[data-card-body]')).toHaveLength(1)
      expect(card(wrapper, second.id).find('[data-card-body]').exists()).toBe(true)

      await clickCard(wrapper, second.id)
      expect(wrapper.find('[data-card-body]').exists()).toBe(false)

      await clickCard(wrapper, first.id)
      await card(wrapper, first.id).find('[data-action="done"]').trigger('click')
      expect(wrapper.find('[data-card-body]').exists()).toBe(false)
      // Done only shuts it.
      expect(names(wrapper)).toEqual(['Claude Code', 'The other agent'])
      expect(native.platform.removeApp).not.toHaveBeenCalled()
    })

    it('renames the app as its name field is left', async () => {
      const { wrapper, app, open } = await mountOpen()
      const field = open().find('[data-field="app-rename"]')
      expect(field.element.value).toBe('Claude Code')

      await field.setValue('The agent')
      // Not until it is left.
      expect(native.platform.updateApp).not.toHaveBeenCalled()
      await field.trigger('blur')
      await flushPromises()

      expect(native.platform.updateApp).toHaveBeenCalledWith(app.id, { name: 'The agent' })
      expect(names(wrapper)).toEqual(['The agent'])
      expect(open().find('[data-field="app-rename"]').element.value).toBe('The agent')
    })

    it('renames it on Enter', async () => {
      const { wrapper, app, open } = await mountOpen()

      await open().find('[data-field="app-rename"]').setValue('The agent')
      await open().find('[data-field="app-rename"]').trigger('keydown', { key: 'Enter' })
      await flushPromises()

      expect(native.platform.updateApp).toHaveBeenCalledWith(app.id, { name: 'The agent' })
      expect(names(wrapper)).toEqual(['The agent'])
      // Still open, to go on to its projects.
      expect(open().find('[data-card-body]').exists()).toBe(true)
    })

    it('keeps the name it has when the field is left empty, and shows it again', async () => {
      const { wrapper, open } = await mountOpen()
      const field = () => open().find('[data-field="app-rename"]')

      await field().setValue('')
      await field().trigger('blur')
      await flushPromises()
      expect(field().element.value).toBe('Claude Code')

      await field().setValue('   ')
      await field().trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(field().element.value).toBe('Claude Code')

      expect(native.platform.updateApp).not.toHaveBeenCalled()
      expect(names(wrapper)).toEqual(['Claude Code'])
      expect(toast.error).not.toHaveBeenCalled()
    })

    it('asks nothing for a name left as it was', async () => {
      const { open } = await mountOpen()

      await open().find('[data-field="app-rename"]').trigger('blur')
      await flushPromises()

      expect(native.platform.updateApp).not.toHaveBeenCalled()
    })

    it('shows the name as it was kept', async () => {
      const { wrapper, open } = await mountOpen()

      await open().find('[data-field="app-rename"]').setValue('  The agent  ')
      await open().find('[data-field="app-rename"]').trigger('blur')
      await flushPromises()

      expect(open().find('[data-field="app-rename"]').element.value).toBe('The agent')
      expect(names(wrapper)).toEqual(['The agent'])
    })

    it('puts the name back when it couldn’t be changed', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      native.platform.updateApp.mockRejectedValueOnce(new Error('No such connection.'))
      const { wrapper, open } = await mountOpen()

      await open().find('[data-field="app-rename"]').setValue('The agent')
      await open().find('[data-field="app-rename"]').trigger('blur')
      await flushPromises()

      expect(open().find('[data-field="app-rename"]').element.value).toBe('Claude Code')
      expect(names(wrapper)).toEqual(['Claude Code'])
    })

    it('lists the projects, those it is let into ticked', async () => {
      const { open } = await mountOpen({ projects: [NOTES.id] })

      expect(listed(open())).toEqual(['Thief', 'Field notes'])
      expect(tickOf(open(), THIEF).element.checked).toBe(false)
      expect(tickOf(open(), NOTES).element.checked).toBe(true)
    })

    it('lets it into a project ticked, and out of one unticked', async () => {
      const { wrapper, app, open } = await mountOpen({ projects: [NOTES.id] })

      await tick(open(), THIEF)
      expect(native.platform.updateApp).toHaveBeenLastCalledWith(app.id, {
        projects: [NOTES.id, THIEF.id],
      })
      expect(tickOf(open(), THIEF).element.checked).toBe(true)
      expect(lineOf(wrapper, app.id)).toBe('Thief, Field notes')

      await tick(open(), NOTES)
      expect(native.platform.updateApp).toHaveBeenLastCalledWith(app.id, { projects: [THIEF.id] })
      expect(tickOf(open(), NOTES).element.checked).toBe(false)
      expect(lineOf(wrapper, app.id)).toBe('Thief')
    })

    it('ticks a project for the app whose card it is, and no other', async () => {
      const first = native.has()
      const second = native.has({ name: 'The other agent' })
      const wrapper = await mountApps()
      await clickCard(wrapper, second.id)

      await tick(card(wrapper, second.id), THIEF)

      expect(native.platform.updateApp).toHaveBeenCalledWith(second.id, { projects: [THIEF.id] })
      expect(lineOf(wrapper, first.id)).toBe('No projects')
      expect(lineOf(wrapper, second.id)).toBe('Thief')
    })

    it('shows a tick as it was when its change couldn’t be made', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      native.platform.updateApp.mockRejectedValueOnce(new Error('No such connection.'))
      const { open } = await mountOpen()

      await tickOf(open(), THIEF).setValue(true)
      await flushPromises()

      expect(tickOf(open(), THIEF).element.checked).toBe(false)
    })

    it('says so when its projects couldn’t be changed', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      native.platform.updateApp.mockRejectedValueOnce(new Error('No such connection.'))
      const { wrapper, app, open } = await mountOpen()

      await tick(open(), THIEF)

      expect(toast.error).toHaveBeenCalledWith("The app's projects couldn't be changed.")
      expect(lineOf(wrapper, app.id)).toBe('No projects')
    })

    it('narrows the projects to those the search finds', async () => {
      rows.value = [THIEF, NOTES, RECIPES]
      const { open } = await mountOpen()
      const search = open().find('[data-field="app-project-search"]')
      expect(search.attributes('aria-label')).toBe('Search projects')

      await search.setValue('notes')
      expect(listed(open())).toEqual(['Field notes'])

      // Every word of it, in any order.
      await search.setValue('NOTES fie')
      expect(listed(open())).toEqual(['Field notes'])

      await search.setValue('ledger')
      expect(listed(open())).toEqual([])

      await search.setValue('')
      expect(listed(open())).toEqual(['Thief', 'Field notes', 'Recipes'])
    })

    it('ticks a project found by the search', async () => {
      const { wrapper, app, open } = await mountOpen()

      await open().find('[data-field="app-project-search"]').setValue('thief')
      await tick(open(), THIEF)

      expect(native.platform.updateApp).toHaveBeenCalledWith(app.id, { projects: [THIEF.id] })
      expect(lineOf(wrapper, app.id)).toBe('Thief')
      // The search is left as it was.
      expect(listed(open())).toEqual(['Thief'])
    })

    it('starts the search empty in the next card opened', async () => {
      const first = native.has()
      const second = native.has({ name: 'The other agent' })
      const wrapper = await mountApps()
      await clickCard(wrapper, first.id)
      await wrapper.find('[data-field="app-project-search"]').setValue('thief')

      await clickCard(wrapper, second.id)

      expect(wrapper.find('[data-field="app-project-search"]').element.value).toBe('')
      expect(listed(wrapper)).toEqual(['Thief', 'Field notes'])
    })

    it('offers no search, with nothing to search', async () => {
      rows.value = []
      const { open } = await mountOpen()

      expect(open().find('[data-app-projects]').exists()).toBe(false)
      expect(open().find('[data-field="app-project-search"]').exists()).toBe(false)
      // The rest of the card is there.
      expect(open().find('[data-field="app-rename"]').exists()).toBe(true)
      expect(open().find('[data-app-setup]').exists()).toBe(true)
    })

    it('has an app only read, and write again, from its switch', async () => {
      const { wrapper, app, open } = await mountOpen({ projects: [THIEF.id] })
      expect(readOnlySwitch(open()).element.checked).toBe(false)

      await readOnlySwitch(open()).trigger('change')
      await flushPromises()
      expect(native.platform.updateApp).toHaveBeenLastCalledWith(app.id, { readOnly: true })
      expect(readOnlySwitch(open()).element.checked).toBe(true)
      expect(lineOf(wrapper, app.id)).toBe('Thief · Read only')

      await readOnlySwitch(open()).trigger('change')
      await flushPromises()
      expect(native.platform.updateApp).toHaveBeenLastCalledWith(app.id, { readOnly: false })
      expect(lineOf(wrapper, app.id)).toBe('Thief')
    })

    it('says so when what it may do couldn’t be changed', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      native.platform.updateApp.mockRejectedValueOnce(new Error('No such connection.'))
      const { wrapper, app, open } = await mountOpen()

      await readOnlySwitch(open()).trigger('change')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith("Read only couldn't be changed.")
      expect(lineOf(wrapper, app.id)).toBe('No projects')
    })

    it('shows the switch as it was when its change couldn’t be made', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      native.platform.updateApp.mockRejectedValueOnce(new Error('No such connection.'))
      const { open } = await mountOpen()

      await readOnlySwitch(open()).setValue(true)
      await flushPromises()

      expect(readOnlySwitch(open()).element.checked).toBe(false)
    })

    it('names the switch for a screen reader, and for a click on its label', async () => {
      const { open } = await mountOpen()

      const label = open()
        .findAll('label')
        .find(one => one.text() === 'Read only')
      expect(label.attributes('for')).toBe(readOnlySwitch(open()).attributes('id'))
    })

    it('removes the app, and its card with it', async () => {
      const first = native.has()
      const second = native.has({ name: 'The other agent' })
      const wrapper = await mountApps()
      await clickCard(wrapper, first.id)

      await card(wrapper, first.id).find('[data-action="remove"]').trigger('click')
      await flushPromises()

      expect(native.platform.removeApp).toHaveBeenCalledWith(first.id)
      expect(names(wrapper)).toEqual(['The other agent'])
      // The one left is not opened in its place.
      expect(wrapper.find('[data-card-body]').exists()).toBe(false)
      expect(card(wrapper, second.id).exists()).toBe(true)
    })

    it('says so when it couldn’t be removed, and leaves its card open', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      native.platform.removeApp.mockRejectedValueOnce(new Error('The file couldn’t be written.'))
      const { open } = await mountOpen()

      await open().find('[data-action="remove"]').trigger('click')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith("The app couldn't be removed.")
      expect(open().find('[data-card-body]').exists()).toBe(true)
    })
  })

  describe('what an app is set up with', () => {
    const TOKEN = 'k3Yq-made-up-for-this-test'
    const COMMAND = `claude mcp add --transport http inksprite http://127.0.0.1:4657/mcp --header "Authorization: Bearer ${TOKEN}"`

    /** The rows, as their labels and what each shows. */
    const shown = wrapper =>
      wrapper.findAll('[data-setup]').map(row => [row.find('span').text(), row.find('code').text()])

    it('is the command for Claude Code, then the address and the token, the token shown only in part', async () => {
      const { open } = await mountOpen({ token: TOKEN })

      expect(shown(open())).toEqual([
        [
          'Claude Code',
          'claude mcp add --transport http inksprite http://127.0.0.1:4657/mcp --header "Authorization: Bearer k3Yq…"',
        ],
        ['Address', 'http://127.0.0.1:4657/mcp'],
        ['Token', 'k3Yq…'],
      ])
      // Nowhere in the card, a tooltip or a title included.
      expect(open().html()).not.toContain(TOKEN)
    })

    it('is each app’s own', async () => {
      const first = native.has({ token: TOKEN })
      const second = native.has({ name: 'The other agent', token: 'Zz9w-another-made-up' })
      const wrapper = await mountApps()

      await clickCard(wrapper, second.id)

      expect(setup(wrapper, 'token').find('code').text()).toBe('Zz9w…')
      await clickCard(wrapper, first.id)
      expect(setup(wrapper, 'token').find('code').text()).toBe('k3Yq…')
    })

    it('copies a row whole, the token with it', async () => {
      const writeText = vi.fn(async () => {})
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
      const { open } = await mountOpen({ token: TOKEN })
      const copy = async row => {
        await setup(open(), row).find('[data-action="copy-setup"]').trigger('click')
        await flushPromises()
      }

      await copy('claude-code')
      expect(writeText).toHaveBeenLastCalledWith(COMMAND)
      await copy('address')
      expect(writeText).toHaveBeenLastCalledWith('http://127.0.0.1:4657/mcp')
      await copy('token')
      expect(writeText).toHaveBeenLastCalledWith(TOKEN)
    })

    it('names each row’s copy button for what it copies', async () => {
      const { open } = await mountOpen()

      expect(
        open()
          .findAll('[data-action="copy-setup"]')
          .map(button => button.attributes('aria-label'))
      ).toEqual(['Copy the command for Claude Code', 'Copy address', 'Copy token'])
    })

    it('marks the row just copied, for a moment', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } })
      // A button's tooltip, kept where it can be read.
      const tooltip = (element, { value }) => element.setAttribute('data-says', value)
      const { wrapper, open } = await mountOpen({}, { directives: { tooltip } })
      /** Which rows' buttons have a check, in place of the two sheets. */
      const marked = () =>
        open()
          .findAll('[data-setup]')
          .filter(row => row.find('[data-action="copy-setup"] .pi-check').exists())
          .map(row => row.attributes('data-setup'))
      /** What each row's button says of itself, hovered over. */
      const tips = () =>
        open()
          .findAll('[data-action="copy-setup"]')
          .map(button => button.attributes('data-says'))
      expect(marked()).toEqual([])
      expect(open().findAll('[data-action="copy-setup"] .pi-copy')).toHaveLength(3)
      expect(tips()).toEqual(['Copy', 'Copy', 'Copy'])

      await setup(open(), 'claude-code').find('[data-action="copy-setup"]').trigger('click')
      await flushPromises()
      expect(marked()).toEqual(['claude-code'])
      expect(tips()).toEqual(['Copied', 'Copy', 'Copy'])

      // Another copied takes the mark.
      await setup(open(), 'token').find('[data-action="copy-setup"]').trigger('click')
      await flushPromises()
      expect(marked()).toEqual(['token'])
      expect(tips()).toEqual(['Copy', 'Copy', 'Copied'])

      vi.advanceTimersByTime(1500)
      await wrapper.vm.$nextTick()
      expect(marked()).toEqual([])
      expect(tips()).toEqual(['Copy', 'Copy', 'Copy'])
    })

    it('says so when a row couldn’t be copied, and marks nothing', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
      const { open } = await mountOpen()

      await setup(open(), 'token').find('[data-action="copy-setup"]').trigger('click')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith("The token couldn't be copied.")
      expect(open().find('[data-action="copy-setup"] .pi-check').exists()).toBe(false)
    })
  })

  it('puts its plus beside the heading of the section it is in, and nothing else there', async () => {
    const heading = document.createElement('div')
    heading.id = 'apps-heading'
    document.body.appendChild(heading)
    try {
      const wrapper = await mountApps({ provide: { [SECTION_HEADING]: '#apps-heading' } })

      expect(
        [...heading.querySelectorAll('[data-action]')].map(one => one.getAttribute('data-action'))
      ).toEqual(['add-app'])
      expect(wrapper.find('[data-connected-apps] [data-action="add-app"]').exists()).toBe(false)

      heading.querySelector('[data-action="add-app"]').click()
      await flushPromises()
      expect(names(wrapper)).toEqual(['Claude Code'])
    } finally {
      heading.remove()
    }
  })

  describe('the server’s card', () => {
    /** What the card says the server is doing. */
    const status = wrapper => wrapper.find('[data-apps-status]').text()
    /** The line with the address an app is given, where there is one. */
    const address = wrapper => wrapper.find('[data-apps-address]')
    const serverSwitch = wrapper => wrapper.find('[data-apps-enabled] input')

    /** The port's popup, which is over the page and not in the section. */
    const popup = () => {
      const element = document.body.querySelector('[data-apps-port]')
      return element ? new DOMWrapper(element) : null
    }
    const portField = () => popup().find('[data-field="apps-port"]')
    /** Open the port's popup from the cog on the card. */
    const openPort = async wrapper => {
      await wrapper.find('[data-action="apps-port"]').trigger('click')
      await flushPromises()
    }

    it('is there before any app is: running, with the address an app is given', async () => {
      const wrapper = await mountApps()

      expect(status(wrapper)).toBe('Status: Running')
      expect(address(wrapper).text()).toBe('Reachable at http://127.0.0.1:4657/mcp')
      expect(serverSwitch(wrapper).element.checked).toBe(true)
      // No list of apps under it yet.
      expect(wrapper.find('[data-list="apps"]').exists()).toBe(false)
    })

    it('stands above the apps', async () => {
      native.has()
      const wrapper = await mountApps()
      const html = wrapper.html()

      expect(html.indexOf('data-apps-server')).toBeLessThan(html.indexOf('data-list="apps"'))
    })

    it('says Stopped, and gives no address, for a server that is off', async () => {
      native.kept.enabled = false
      native.has()
      const wrapper = await mountApps()

      expect(status(wrapper)).toBe('Status: Stopped')
      expect(address(wrapper).exists()).toBe(false)
      expect(serverSwitch(wrapper).element.checked).toBe(false)
    })

    it('says in red what keeps the server from its port, and gives no address', async () => {
      native.has()
      native.kept.problem = 'Port 4657 is in use by something else.'
      const wrapper = await mountApps()

      expect(status(wrapper)).toBe('Status: Port 4657 is in use by something else.')
      const said = wrapper.find('[data-apps-status] span:last-child')
      expect(said.classes().some(name => name.includes('red'))).toBe(true)
      expect(address(wrapper).exists()).toBe(false)
      // Running is not said in red.
      native.kept.problem = null
      const fine = await mountApps()
      expect(
        fine
          .find('[data-apps-status] span:last-child')
          .classes()
          .some(name => name.includes('red'))
      ).toBe(false)
    })

    it('stops the server and starts it from its switch, the address going and coming with it', async () => {
      native.has()
      const wrapper = await mountApps()

      await serverSwitch(wrapper).setValue(false)
      await flushPromises()
      expect(native.platform.setAppsEnabled).toHaveBeenLastCalledWith(false)
      expect(status(wrapper)).toBe('Status: Stopped')
      expect(address(wrapper).exists()).toBe(false)

      await serverSwitch(wrapper).setValue(true)
      await flushPromises()
      expect(native.platform.setAppsEnabled).toHaveBeenLastCalledWith(true)
      expect(status(wrapper)).toBe('Status: Running')
      expect(address(wrapper).exists()).toBe(true)
    })

    it('says so when the server couldn’t be stopped, and shows the switch as it was', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      native.platform.setAppsEnabled.mockRejectedValueOnce(
        new Error('The file couldn’t be written.')
      )
      native.has()
      const wrapper = await mountApps()

      await serverSwitch(wrapper).setValue(false)
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith("The server couldn't be stopped.")
      expect(serverSwitch(wrapper).element.checked).toBe(true)
      expect(status(wrapper)).toBe('Status: Running')
    })

    it('says so when it couldn’t be started', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      native.kept.enabled = false
      native.platform.setAppsEnabled.mockRejectedValueOnce(
        new Error('The file couldn’t be written.')
      )
      const wrapper = await mountApps()

      await serverSwitch(wrapper).setValue(true)
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith("The server couldn't be started.")
      expect(status(wrapper)).toBe('Status: Stopped')
    })

    it('names its switch and its cog for a screen reader', async () => {
      const wrapper = await mountApps()

      expect(serverSwitch(wrapper).attributes('aria-label')).toBe('MCP server')
      expect(wrapper.find('[data-action="apps-port"]').attributes('aria-label')).toBe('Port')
      expect(wrapper.find('[data-action="copy-address"]').attributes('aria-label')).toBe(
        'Copy address'
      )
    })

    it('copies the address, and marks its button for a moment', async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      const writeText = vi.fn(async () => {})
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
      const wrapper = await mountApps()
      const copied = () => wrapper.find('[data-action="copy-address"] .pi-check').exists()

      await wrapper.find('[data-action="copy-address"]').trigger('click')
      await flushPromises()
      expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:4657/mcp')
      expect(copied()).toBe(true)

      vi.advanceTimersByTime(1500)
      await flushPromises()
      expect(copied()).toBe(false)
    })

    it('says so when the address couldn’t be copied', async () => {
      const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
      const wrapper = await mountApps()

      await wrapper.find('[data-action="copy-address"]').trigger('click')
      await flushPromises()

      expect(toast.error).toHaveBeenCalledWith("The address couldn't be copied.")
      expect(wrapper.find('[data-action="copy-address"] .pi-check').exists()).toBe(false)
    })

    describe('its port, behind the cog', () => {
      it('opens from the cog, with the port the server is on', async () => {
        const wrapper = await mountApps()
        expect(popup()).toBeNull()

        await openPort(wrapper)

        expect(portField().element.value).toBe('4657')
        const label = popup().find('label')
        expect(label.text()).toBe('Port')
        expect(label.attributes('for')).toBe(portField().attributes('id'))
      })

      it('moves the server to the port typed as the field is left, and on Enter', async () => {
        native.has()
        const wrapper = await mountApps()
        await openPort(wrapper)

        await portField().setValue('5000')
        await portField().trigger('blur')
        await flushPromises()
        expect(native.platform.setAppsPort).toHaveBeenLastCalledWith(5000)
        // The address on the card follows, and the one each app is set up with.
        expect(address(wrapper).text()).toBe('Reachable at http://127.0.0.1:5000/mcp')

        await portField().setValue(' 5001 ')
        await portField().trigger('keydown', { key: 'Enter' })
        await flushPromises()
        expect(native.platform.setAppsPort).toHaveBeenLastCalledWith(5001)
        expect(portField().element.value).toBe('5001')
      })

      it('leaves the port as it was on Escape, whatever was typed', async () => {
        const wrapper = await mountApps()
        await openPort(wrapper)

        await portField().setValue('5000')
        await portField().trigger('keydown', { key: 'Escape' })
        // The popup shuts on Escape, which takes the caret out of the field.
        await portField().trigger('blur')
        await flushPromises()

        expect(native.platform.setAppsPort).not.toHaveBeenCalled()
        expect(native.kept.port).toBe(4657)
      })

      it('asks nothing for what isn’t a number, or for the port it is on, and shows the port again', async () => {
        const wrapper = await mountApps()
        await openPort(wrapper)

        for (const typed of ['', 'eighty', '50.5', '4657']) {
          await portField().setValue(typed)
          await portField().trigger('blur')
          await flushPromises()
          expect(portField().element.value).toBe('4657')
        }
        expect(native.platform.setAppsPort).not.toHaveBeenCalled()
        expect(toast.error).not.toHaveBeenCalled()
      })

      it('says a port can’t be used where it can’t, with the ports that can, and shows the one it is on', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        const wrapper = await mountApps()
        await openPort(wrapper)

        await portField().setValue('80')
        await portField().trigger('blur')
        await flushPromises()

        expect(native.platform.setAppsPort).toHaveBeenCalledWith(80)
        expect(toast.error).toHaveBeenCalledWith(
          "That port can't be used. Choose a number from 1024 to 65535."
        )
        expect(portField().element.value).toBe('4657')
      })

      it('can be changed while the server is off, for when it is started', async () => {
        native.kept.enabled = false
        const wrapper = await mountApps()
        await openPort(wrapper)

        expect(portField().attributes('disabled')).toBeUndefined()
        await portField().setValue('5000')
        await portField().trigger('blur')
        await flushPromises()

        expect(native.platform.setAppsPort).toHaveBeenCalledWith(5000)
        expect(portField().element.value).toBe('5000')
      })
    })
  })
})
