import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { computed } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ConnectionsSection from '@/components/writer/settings/ConnectionsSection.vue'
import { useMcpServerStore } from '@/stores/mcpServerStore.js'
import { SIGN_IN_NEEDED } from '@/mcp/client.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { SECTION_HEADING } from '@/components/common/sectionHeading.js'

vi.mock('@/stores/db', () => ({
  default: {
    mcpServers: { toArray: vi.fn(async () => []) },
    webSearch: { get: vi.fn(async () => undefined) },
  },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn(), start: () => false }),
}))

const listServer = vi.hoisted(() => vi.fn())
vi.mock('@/mcp/client.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  listServer,
}))

/** Which addresses are signed in, as the stubbed sign-in keeps them. */
const signed = vi.hoisted(() => new Set())
vi.mock('@/mcp/auth.js', async importOriginal => ({
  .../** @type {any} */ (await importOriginal()),
  signedIn: url => signed.has(url),
  signOut: url => signed.delete(url),
  // Signing in comes straight back signed in: the tab and the server's page
  // are the end-to-end test's, in test/mcp/auth.test.js.
  startSignIn: vi.fn(async url => {
    signed.add(url)
    return 'AUTHORIZED'
  }),
}))

vi.stubGlobal(
  'BroadcastChannel',
  class {
    postMessage() {}
    close() {}
  }
)

vi.mock('@/composables/useProfiles', () => ({
  useProfiles: () => ({
    profiles: computed(() => [
      { id: 'builtin_profile_chat', name: 'Chat', readOnly: true },
      { id: 'builtin_profile_roleplay', name: 'Roleplay', readOnly: true },
    ]),
  }),
}))

/** What the test server offers, as listing it would read. */
const offered = {
  serverName: 'Test',
  instructions: '',
  tools: [
    {
      name: 'look_up',
      description: 'Look up a term.',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
    },
    { name: 'save_note', description: 'Save a note.', inputSchema: { type: 'object' } },
  ],
  prompts: [],
}

const mountSection = async () => {
  const wrapper = mount(ConnectionsSection, {
    props: { part: 'mcp' },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })
  await flushPromises()
  return wrapper
}

/** Open the form, type an address, and connect. */
const connectTo = async (wrapper, url) => {
  await wrapper.find('[data-action="add-server"]').trigger('click')
  await wrapper.find('[data-field="url"]').setValue(url)
  await wrapper.find('[data-action="connect"]').trigger('click')
  await flushPromises()
}

describe('ConnectionsSection', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    listServer.mockReset()
    signed.clear()
    vi.spyOn(window, 'open').mockReturnValue(null)
  })

  it('shows what a server offers — what the model will be told — before keeping it', async () => {
    listServer.mockResolvedValue(offered)
    const wrapper = await mountSection()

    await connectTo(wrapper, 'https://mcp.example.com/mcp')

    const candidate = () => wrapper.find('[data-candidate]')
    expect(candidate().text()).toContain('Example')
    expect(candidate().text()).toContain('2 tools')
    expect(candidate().text()).not.toContain('look_up')
    expect(wrapper.find('[data-action="keep"]').text()).toBe('Keep it')
    expect(wrapper.find('[data-action="connect"]').exists()).toBe(false)

    await candidate().find('[data-candidate-summary]').trigger('click')
    expect(candidate().text()).toContain('look_up · Reads only — Look up a term.')
    expect(useMcpServerStore().getAllServers()).toEqual([])
  })

  it('lists it again after the address changes, so Keep keeps what was shown', async () => {
    listServer.mockResolvedValue(offered)
    const wrapper = await mountSection()

    await connectTo(wrapper, 'https://mcp.example.com/mcp')
    await wrapper.find('[data-field="url"]').setValue('https://mcp.example.org/mcp')

    expect(wrapper.find('[data-candidate]').exists()).toBe(false)
    expect(wrapper.find('[data-action="keep"]').exists()).toBe(false)
    await wrapper.find('[data-action="connect"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-action="keep"]').trigger('click')

    expect(useMcpServerStore().getAllServers()[0].url).toBe('https://mcp.example.org/mcp')
  })

  it('keeps it, named for the model, saying nothing of which chats use it', async () => {
    listServer.mockResolvedValue(offered)
    const wrapper = await mountSection()

    await connectTo(wrapper, 'https://mcp.example.com/mcp')
    await wrapper.find('[data-action="keep"]').trigger('click')

    const [server] = useMcpServerStore().getAllServers()
    expect(server).toMatchObject({
      name: 'Example',
      prefix: 'example',
      url: 'https://mcp.example.com/mcp',
      allowed: [],
    })
    // Each chat's tools say: it is on in every one that has not switched it off.
    expect(server.profiles).toBeUndefined()
    expect(server.tools.map(tool => tool.exposed)).toEqual([
      'example__look_up',
      'example__save_note',
    ])
    expect(wrapper.find('[data-adding]').exists()).toBe(false)
    expect(wrapper.find(`[data-server="${server.id}"]`).text()).toContain('2 tools')
  })

  it('sends the header it was given, and keeps it', async () => {
    listServer.mockResolvedValue(offered)
    const wrapper = await mountSection()

    await wrapper.find('[data-action="add-server"]').trigger('click')
    await wrapper.find('[data-field="url"]').setValue('https://mcp.example.com/mcp')
    await wrapper.find('[data-field="header-name"]').setValue('Authorization')
    await wrapper.find('[data-field="header-value"]').setValue('Bearer k')
    await wrapper.find('[data-action="connect"]').trigger('click')
    await flushPromises()
    await wrapper.find('[data-action="keep"]').trigger('click')

    expect(listServer).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { Authorization: 'Bearer k' } })
    )
    expect(useMcpServerStore().getAllServers()[0].headers).toEqual({ Authorization: 'Bearer k' })
  })

  it('says a key a backup left out is missing, and lists the server again once entered', async () => {
    listServer.mockResolvedValue(offered)
    const wrapper = await mountSection()
    await connectTo(wrapper, 'https://mcp.example.com/mcp')
    await wrapper.find('[data-action="keep"]').trigger('click')
    const store = useMcpServerStore()
    const [kept] = store.getAllServers()
    // As a backup without keys restores it.
    store.updateServer(kept.id, { headers: { Authorization: '' } })
    await flushPromises()

    const row = () => wrapper.find(`[data-server="${kept.id}"]`)
    expect(row().find('[data-key-missing]').exists()).toBe(true)
    // Refused for want of its key, which a sign-in would not give it.
    store.updateServer(kept.id, { error: SIGN_IN_NEEDED })
    await flushPromises()
    expect(row().find('[data-action="sign-in"]').exists()).toBe(false)

    await row().find('button').trigger('click')
    expect(row().find('[data-field="server-header-name"]').element.value).toBe('Authorization')
    expect(row().find('[data-action="save-headers"]').exists()).toBe(false)
    await row().find('[data-field="server-header-value"]').setValue('Bearer again')
    listServer.mockClear()
    await row().find('[data-action="save-headers"]').trigger('click')
    await flushPromises()

    expect(store.getServer(kept.id).headers).toEqual({ Authorization: 'Bearer again' })
    expect(listServer).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { Authorization: 'Bearer again' } })
    )
    expect(row().find('[data-key-missing]').exists()).toBe(false)
  })

  it('adds a header to a kept server that had none', async () => {
    listServer.mockResolvedValue(offered)
    const wrapper = await mountSection()
    await connectTo(wrapper, 'https://mcp.example.com/mcp')
    await wrapper.find('[data-action="keep"]').trigger('click')
    const store = useMcpServerStore()
    const [kept] = store.getAllServers()
    const row = () => wrapper.find(`[data-server="${kept.id}"]`)

    await row().find('button').trigger('click')
    await row().find('[data-field="server-header-name"]').setValue('X-Api-Key')
    await row().find('[data-field="server-header-value"]').setValue('k')
    await row().find('[data-action="save-headers"]').trigger('click')
    await flushPromises()

    expect(store.getServer(kept.id).headers).toEqual({ 'X-Api-Key': 'k' })
  })

  it('says why one could not be reached, and keeps nothing', async () => {
    listServer.mockRejectedValue(new TypeError('Failed to fetch'))
    const wrapper = await mountSection()

    await connectTo(wrapper, 'https://mcp.example.com/mcp')

    expect(wrapper.find('[data-candidate]').text()).toMatch(/CORS/)
    expect(wrapper.find('[data-action="keep"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="connect"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Used in chats on')
  })

  it('opens a new server ready to take its address', async () => {
    const wrapper = mount(ConnectionsSection, {
      props: { part: 'mcp' },
      global: { plugins: [PrimeVue], directives: { tooltip: {} } },
      attachTo: document.body,
    })
    await flushPromises()

    await wrapper.find('[data-action="add-server"]').trigger('click')
    await flushPromises()

    expect(document.activeElement).toBe(wrapper.find('[data-field="url"]').element)
    wrapper.unmount()
  })

  it('refuses an address that is not a web address, at the field, without trying it', async () => {
    const wrapper = await mountSection()

    await connectTo(wrapper, 'not a url')

    expect(wrapper.find('[data-address-problem]').text()).toBe('That isn’t a web address.')
    expect(listServer).not.toHaveBeenCalled()
    expect(wrapper.find('[data-candidate]').exists()).toBe(false)

    await wrapper.find('[data-field="url"]').setValue('https://mcp.example.com/mcp')
    expect(wrapper.find('[data-address-problem]').exists()).toBe(false)
  })

  it('keeps a pasted server that runs as a program, as needing a bridge', async () => {
    listServer.mockResolvedValue(offered)
    const wrapper = await mountSection()

    await wrapper.find('[data-action="add-server"]').trigger('click')
    await wrapper.find('[data-mode="json"]').trigger('click')
    await wrapper
      .find('[data-field="json"]')
      .setValue(
        '{"mcpServers":{"wiki":{"url":"https://wiki.example/mcp"},"files":{"command":"npx"}}}'
      )
    await wrapper.find('[data-action="connect"]').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-candidate]')).toHaveLength(2)
    expect(listServer).toHaveBeenCalledTimes(1)
    await wrapper.find('[data-action="keep"]').trigger('click')

    const kept = useMcpServerStore().getAllServers()
    expect(kept.map(server => server.name)).toEqual(['wiki', 'files'])
    expect(kept[1]).toMatchObject({ command: 'npx', tools: [] })
    expect(wrapper.text()).toContain('needs a bridge')
  })

  it('always allows a tool, and removes the server, from its row', async () => {
    listServer.mockResolvedValue(offered)
    const wrapper = await mountSection()
    await connectTo(wrapper, 'https://mcp.example.com/mcp')
    await wrapper.find('[data-action="keep"]').trigger('click')
    const store = useMcpServerStore()
    const [server] = store.getAllServers()

    await wrapper.find(`[data-server="${server.id}"] button`).trigger('click')
    const toggle = label =>
      wrapper
        .findAllComponents({ name: 'ToggleSwitch' })
        .find(one => one.props('ariaLabel') === label)

    await toggle('Always allow save_note').vm.$emit('update:modelValue', true)
    expect(store.getServer(server.id).allowed).toEqual(['save_note'])
    expect(wrapper.text()).not.toContain('Used in chats on')

    await wrapper.find('[data-action="remove"]').trigger('click')
    expect(store.getAllServers()).toEqual([])
  })

  it('offers to sign in to a server that wants it, and lists it once signed in', async () => {
    listServer.mockImplementation(async server => {
      if (!signed.has(server.url)) throw { data: { status: 401 } }
      return offered
    })
    const wrapper = await mountSection()

    await connectTo(wrapper, 'https://mcp.linear.app/mcp')
    expect(wrapper.find('[data-candidate]').text()).toContain('Sign in to see what it offers')
    expect(wrapper.find('[data-action="keep"]').exists()).toBe(false)

    await wrapper.find('[data-action="sign-in"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-candidate]').text()).toContain('2 tools')
    await wrapper.find('[data-action="keep"]').trigger('click')
    expect(useMcpServerStore().getAllServers()[0]).toMatchObject({ auth: 'oauth' })
  })

  it('says a server is signed in, signs out of it, and offers to sign in again', async () => {
    signed.add('https://mcp.linear.app/mcp')
    listServer.mockResolvedValue(offered)
    const wrapper = await mountSection()
    await connectTo(wrapper, 'https://mcp.linear.app/mcp')
    await wrapper.find('[data-action="keep"]').trigger('click')
    const [server] = useMcpServerStore().getAllServers()
    const row = () => wrapper.find(`[data-server="${server.id}"]`)

    expect(row().find('[data-signed-in]').exists()).toBe(true)
    await row().find('button').trigger('click')
    await row().find('[data-action="sign-out"]').trigger('click')

    expect(signed.has('https://mcp.linear.app/mcp')).toBe(false)
    expect(row().find('[data-signed-in]').exists()).toBe(false)
    expect(row().find('[data-action="sign-in"]').exists()).toBe(true)
  })

  it('forgets a server’s sign-in when the server is removed', async () => {
    signed.add('https://mcp.linear.app/mcp')
    listServer.mockResolvedValue(offered)
    const wrapper = await mountSection()
    await connectTo(wrapper, 'https://mcp.linear.app/mcp')
    await wrapper.find('[data-action="keep"]').trigger('click')
    const [server] = useMcpServerStore().getAllServers()

    await wrapper.find(`[data-server="${server.id}"] button`).trigger('click')
    await wrapper.find('[data-action="remove"]').trigger('click')

    expect(signed.size).toBe(0)
  })

  it('lists the server’s prompts, with the command for each one the menu offers', async () => {
    listServer.mockResolvedValue({
      ...offered,
      prompts: [
        {
          name: 'outline',
          description: 'An outline.',
          arguments: [{ name: 'topic', required: true }],
        },
        {
          name: 'compare',
          arguments: [
            { name: 'a', required: true },
            { name: 'b', required: true },
          ],
        },
      ],
    })
    const wrapper = await mountSection()
    await connectTo(wrapper, 'https://mcp.example.com/mcp')
    await wrapper.find('[data-action="keep"]').trigger('click')
    const [server] = useMcpServerStore().getAllServers()

    await wrapper.find(`[data-server="${server.id}"] button`).trigger('click')
    const prompts = wrapper.findAll('[data-prompt]').map(one => one.text())

    expect(wrapper.find(`[data-server="${server.id}"]`).text()).toContain('2 tools · 2 prompts')
    expect(prompts[0]).toContain('/example:outline <topic>')
    expect(prompts[1]).toMatch(/needs 2 arguments/)
  })
})

describe('ConnectionsSection, a server always allowed', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    listServer.mockReset()
    signed.clear()
  })

  it('allows every tool of a server from one switch, and says so on each', async () => {
    listServer.mockResolvedValue(offered)
    const wrapper = await mountSection()
    await connectTo(wrapper, 'https://mcp.example.com/mcp')
    await wrapper.find('[data-action="keep"]').trigger('click')
    const store = useMcpServerStore()
    const [server] = store.getAllServers()

    await wrapper.find(`[data-server="${server.id}"] button`).trigger('click')
    await wrapper
      .findAllComponents({ name: 'ToggleSwitch' })
      .find(one => one.attributes('data-allow-all') !== undefined)
      .vm.$emit('update:modelValue', true)

    expect(store.getServer(server.id).allowAll).toBe(true)
    // The tool that asked before says it is allowed, in place of its own switch.
    expect(wrapper.find(`[data-server="${server.id}"]`).text()).toContain('Allowed')
  })

  it('is always allowed from a chat by any of its tools', async () => {
    listServer.mockResolvedValue(offered)
    const wrapper = await mountSection()
    await connectTo(wrapper, 'https://mcp.example.com/mcp')
    await wrapper.find('[data-action="keep"]').trigger('click')
    const store = useMcpServerStore()
    const [server] = store.getAllServers()

    const { useMcpServers } = await import('@/composables/useMcpServers.js')
    useMcpServers().allowServer('example__save_note')

    expect(store.getServer(server.id).allowAll).toBe(true)
  })
})

describe('ConnectionsSection, a part at a time', () => {
  const AiConnections = { name: 'AiConnections', template: '<div data-ai-connections />' }
  const WebSearchConnection = { name: 'WebSearchConnection', template: '<div data-web-search />' }

  /** @param {string} [part] */
  const mountPart = async part => {
    const wrapper = mount(ConnectionsSection, {
      props: part ? { part } : {},
      global: {
        plugins: [PrimeVue],
        directives: { tooltip: {} },
        stubs: { AiConnections, WebSearchConnection },
      },
    })
    await flushPromises()
    return wrapper
  }

  /** Which of the three is showing. */
  const showing = wrapper => ({
    providers: wrapper.find('[data-ai-connections]').exists(),
    mcp: wrapper.find('[data-heading="mcp"]').exists(),
    web: wrapper.find('[data-web-search]').exists(),
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    listServer.mockReset()
    useApplicationState().resetState()
  })

  afterEach(() => useApplicationState().resetState())

  it('shows the AI providers alone, and first', async () => {
    expect(showing(await mountPart())).toEqual({ providers: true, mcp: false, web: false })
    expect(showing(await mountPart('providers'))).toEqual({
      providers: true,
      mcp: false,
      web: false,
    })
  })

  it('shows the MCP servers alone', async () => {
    const wrapper = await mountPart('mcp')

    expect(showing(wrapper)).toEqual({ providers: false, mcp: true, web: false })
    expect(wrapper.find('[data-connections-section]').attributes('data-part')).toBe('mcp')
  })

  it('shows web search’s services alone, and moves from part to part as told', async () => {
    const wrapper = await mountPart('web')
    expect(showing(wrapper)).toEqual({ providers: false, mcp: false, web: true })

    await wrapper.setProps({ part: 'providers' })
    expect(showing(wrapper)).toEqual({ providers: true, mcp: false, web: false })
  })

  it('has web search’s services only while its extension is on', async () => {
    useApplicationState().setExtension('web', false)
    const wrapper = await mountPart('web')
    expect(showing(wrapper).web).toBe(false)

    useApplicationState().setExtension('web', true)
    await flushPromises()
    expect(showing(wrapper)).toEqual({ providers: false, mcp: false, web: true })
  })

  it('has none of them with the AI off', async () => {
    useApplicationState().setAiEnabled(false)
    expect(showing(await mountPart('web')).web).toBe(false)
  })
})

describe('ConnectionsSection, the servers as cards', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    listServer.mockReset()
    signed.clear()
    vi.spyOn(window, 'open').mockReturnValue(null)
  })

  /** Keep the test server, and give back its row in the store. */
  const keep = async wrapper => {
    listServer.mockResolvedValue(offered)
    await connectTo(wrapper, 'https://mcp.example.com/mcp')
    await wrapper.find('[data-action="keep"]').trigger('click')
    await flushPromises()
    return useMcpServerStore().getAllServers()[0]
  }

  it('draws no box, and says nothing, with no servers', async () => {
    const wrapper = await mountSection()

    expect(wrapper.find('[data-card-list]').exists()).toBe(false)
    expect(wrapper.find('[data-heading="mcp"]').text()).toBe('')
    expect(wrapper.find('[data-action="add-server"]').attributes('aria-label')).toBe('Add a server')
  })

  it('opens a new server as an open card, put away by a click on its name or Cancel', async () => {
    const wrapper = await mountSection()

    await wrapper.find('[data-action="add-server"]').trigger('click')

    const adding = wrapper.find('[data-adding]')
    expect(adding.find('[data-card-toggle]').text()).toContain('New server')
    expect(adding.find('[data-card-toggle]').attributes('aria-expanded')).toBe('true')
    expect(adding.find('[data-card-body] [data-field="url"]').exists()).toBe(true)

    await adding.find('[data-card-toggle]').trigger('click')
    expect(wrapper.find('[data-adding]').exists()).toBe(false)

    await wrapper.find('[data-action="add-server"]').trigger('click')
    await wrapper.find('[data-action="cancel"]').trigger('click')
    expect(wrapper.find('[data-adding]').exists()).toBe(false)
  })

  it('lists a kept server as a card, by its name and address, saying nothing of one that was listed', async () => {
    const wrapper = await mountSection()
    const server = await keep(wrapper)

    const card = wrapper.find(`[data-list="servers"] [data-server="${server.id}"]`)
    expect(card.find('[data-card-toggle]').text()).toContain('Example')
    expect(card.find('[data-connection-address]').text()).toBe('https://mcp.example.com/mcp')
    expect(card.find('[data-status]').exists()).toBe(false)
    expect(card.text()).not.toContain('Connected')
  })

  it('says “Not connected”, with a red dot, only of one that couldn’t be listed', async () => {
    const wrapper = await mountSection()
    const server = await keep(wrapper)
    const store = useMcpServerStore()
    const status = () => wrapper.find(`[data-server="${server.id}"] [data-status]`)

    // The server refused, or couldn't be reached.
    store.updateServer(server.id, { error: 'The server could not be reached.' })
    await flushPromises()
    expect(status().text()).toBe('Not connected')
    expect(status().find('.bg-red-500').exists()).toBe(true)

    store.updateServer(server.id, { error: undefined })
    await flushPromises()
    expect(status().exists()).toBe(false)

    // Its key missing, as a backup without keys restores it.
    store.updateServer(server.id, { headers: { Authorization: '' } })
    await flushPromises()
    expect(status().text()).toBe('Not connected')
  })

  it('opens a server’s settings in its card, one at a time', async () => {
    const wrapper = await mountSection()
    const server = await keep(wrapper)
    const card = () => wrapper.find(`[data-server="${server.id}"]`)

    await card().find('[data-card-toggle]').trigger('click')
    expect(card().find('[data-connection-body] [data-action="remove"]').exists()).toBe(true)

    await card().find('[data-card-toggle]').trigger('click')
    expect(card().find('[data-connection-body]').exists()).toBe(false)
  })

  it('puts its plus beside the heading of the section it is in', async () => {
    const heading = document.createElement('div')
    heading.id = 'mcp-heading'
    document.body.appendChild(heading)
    const wrapper = mount(ConnectionsSection, {
      props: { part: 'mcp' },
      global: {
        plugins: [PrimeVue],
        directives: { tooltip: {} },
        provide: { [SECTION_HEADING]: '#mcp-heading' },
      },
      attachTo: document.body,
    })
    await flushPromises()

    expect(heading.querySelector('[data-action="add-server"]')).not.toBeNull()
    expect(wrapper.find('[data-heading="mcp"] [data-action="add-server"]').exists()).toBe(false)

    // Only while the servers are the part showing.
    await wrapper.setProps({ part: 'web' })
    await flushPromises()
    expect(heading.querySelector('[data-action="add-server"]')).toBeNull()
    wrapper.unmount()
    heading.remove()
  })
})
