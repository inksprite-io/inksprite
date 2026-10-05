import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { computed } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ConnectionsSection from '@/components/writer/settings/ConnectionsSection.vue'
import { useMcpServerStore } from '@/stores/mcpServerStore.js'
import { CHAT_PROFILE_ID } from '@/ai/profiles/index.js'

vi.mock('@/stores/db', () => ({
  default: { mcpServers: { toArray: vi.fn(async () => []) } },
}))
vi.mock('@/stores/syncStore', () => ({
  useSyncStore: () => ({ trackChange: vi.fn(), trackDelete: vi.fn() }),
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

    const candidate = wrapper.find('[data-candidate]')
    expect(candidate.text()).toContain('Example')
    expect(candidate.text()).toContain('2 tools')
    expect(candidate.text()).toContain('look_up · reads only — Look up a term.')
    expect(useMcpServerStore().getAllServers()).toEqual([])
  })

  it('keeps it, named for the model, and used in chats on the default profile', async () => {
    listServer.mockResolvedValue(offered)
    const wrapper = await mountSection()

    await connectTo(wrapper, 'https://mcp.example.com/mcp')
    await wrapper.find('[data-action="keep"]').trigger('click')

    const [server] = useMcpServerStore().getAllServers()
    expect(server).toMatchObject({
      name: 'Example',
      prefix: 'example',
      url: 'https://mcp.example.com/mcp',
      profiles: [CHAT_PROFILE_ID],
      allowed: [],
    })
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

  it('says why one could not be reached, and keeps nothing', async () => {
    listServer.mockRejectedValue(new TypeError('Failed to fetch'))
    const wrapper = await mountSection()

    await connectTo(wrapper, 'https://mcp.example.com/mcp')

    expect(wrapper.find('[data-candidate]').text()).toMatch(/CORS/)
    expect(wrapper.find('[data-action="keep"]').attributes('disabled')).toBeDefined()
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

  it('always allows a tool, uses it on another profile, and removes it, from its row', async () => {
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

    await toggle('Use Example in chats on Roleplay').vm.$emit('update:modelValue', true)
    expect(store.getServer(server.id).profiles).toEqual([
      CHAT_PROFILE_ID,
      'builtin_profile_roleplay',
    ])

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
    expect(wrapper.find('[data-candidate]').text()).toContain('needs you to sign in')
    expect(wrapper.find('[data-action="keep"]').attributes('disabled')).toBeDefined()

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
    expect(prompts[1]).toMatch(/needs 2 things filled in/)
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
