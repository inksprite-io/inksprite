import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import AiConnections from '@/components/writer/connections/AiConnections.vue'
import ConnectionDialog from '@/components/writer/connections/ConnectionDialog.vue'
import { SECTION_HEADING } from '@/components/common/sectionHeading.js'

const ROWS = [
  { id: 'provider_openrouter_default', name: 'OpenRouter', type: 'openrouter', apiKey: 'sk-or' },
  { id: 'provider_box', name: 'Box', type: 'generic', endpoint: 'http://box:1234/v1' },
]
/** The writer's connections. */
const rows = [...ROWS]
const STATES = { provider_openrouter_default: 'connected', provider_box: 'unreachable' }
/** How each answered when it was last asked. */
const states = { ...STATES }
const remove = vi.fn()
vi.mock('@/composables/useConnections.js', () => ({
  STATE_LABELS: { connected: 'Connected', key: 'Key not accepted', unreachable: "Can't reach it" },
  hostOf: endpoint => (endpoint ? new URL(endpoint).host : ''),
  useConnections: () => ({
    connections: { value: rows },
    stateOf: id => states[id] ?? null,
    remove,
  }),
}))
/** What the last confirm asked. */
let asked = null
vi.mock('primevue/useconfirm', () => ({
  useConfirm: () => ({ require: options => (asked = options) }),
}))
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ getProvider: id => rows.find(row => row.id === id) ?? null }),
}))

/** The connection's form, as the dialog shows it. */
const ConnectionForm = {
  name: 'ConnectionForm',
  props: ['mode', 'providerId', 'showState'],
  emits: ['shown'],
  mounted() {
    this.$emit('shown', this.providerId)
  },
  template: '<div />',
}
const stubs = {
  ConnectionForm,
  ProviderRouting: { name: 'ProviderRouting', template: '<div data-routing />' },
  Dialog: { template: '<div><slot /><slot name="footer" /></div>' },
  ExpandableSection: { template: '<div><slot name="actions" /><slot /></div>' },
}

describe('AiConnections', () => {
  beforeEach(() => {
    rows.splice(0, rows.length, ...ROWS)
    for (const id of Object.keys(states)) delete states[id]
    Object.assign(states, STATES)
  })

  const mountList = (options = {}) =>
    mount(AiConnections, {
      global: { plugins: [PrimeVue], stubs, directives: { tooltip: {} }, ...options.global },
      ...(options.attachTo ? { attachTo: options.attachTo } : {}),
    })

  const card = (wrapper, id) => wrapper.find(`[data-connection="${id}"]`)
  const openCard = (wrapper, id) => card(wrapper, id).find('button[aria-expanded]').trigger('click')

  it('lists each connection as a card, by its name and where it answers', () => {
    const wrapper = mountList()

    expect(
      wrapper.findAll('[data-connection]').map(one => one.attributes('data-connection'))
    ).toEqual(['provider_openrouter_default', 'provider_box'])
    const hosted = card(wrapper, 'provider_openrouter_default')
    expect(hosted.text()).toContain('OpenRouter')
    // A hosted service's row has no address: its own is said.
    expect(hosted.find('[data-connection-address]').text()).toBe('openrouter.ai')
    expect(card(wrapper, 'provider_box').find('[data-connection-address]').text()).toBe('box:1234')
  })

  it('says nothing of a connection that answered, or of one not asked yet', () => {
    delete states.provider_box
    const wrapper = mountList()

    expect(wrapper.find('[data-status]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Connected')
  })

  it('says what went wrong with one that didn’t, with a red dot', () => {
    states.provider_openrouter_default = 'key'
    const wrapper = mountList()

    const refused = card(wrapper, 'provider_openrouter_default').find('[data-status]')
    expect(refused.text()).toBe('Key not accepted')
    expect(refused.attributes('data-status')).toBe('bad')
    expect(refused.find('.bg-red-500').exists()).toBe(true)
    const away = card(wrapper, 'provider_box').find('[data-status]')
    expect(away.text()).toBe("Can't reach it")
    expect(away.find('.bg-red-500').exists()).toBe(true)
  })

  it('opens a connection’s settings in its card', async () => {
    const wrapper = mountList()

    await openCard(wrapper, 'provider_box')

    const body = card(wrapper, 'provider_box').find('[data-connection-body]')
    expect(body.findComponent({ name: 'ConnectionForm' }).props('providerId')).toBe('provider_box')
    expect(body.find('[data-routing]').exists()).toBe(false)
  })

  it('says how it answered on the card alone, not beside Connect too', async () => {
    const wrapper = mountList()
    await openCard(wrapper, 'provider_box')

    expect(wrapper.findComponent({ name: 'ConnectionForm' }).props('showState')).toBe(false)
  })

  it('opens one at a time, and shuts the one clicked again', async () => {
    const wrapper = mountList()

    await openCard(wrapper, 'provider_box')
    await openCard(wrapper, 'provider_openrouter_default')
    expect(wrapper.findAll('[data-connection-body]')).toHaveLength(1)
    expect(card(wrapper, 'provider_openrouter_default').find('[data-routing]').exists()).toBe(true)

    await openCard(wrapper, 'provider_openrouter_default')
    expect(wrapper.find('[data-connection-body]').exists()).toBe(false)
  })

  it('shuts the card of one removed', async () => {
    const wrapper = mountList()
    await openCard(wrapper, 'provider_box')

    await card(wrapper, 'provider_box').find('[data-action="remove-connection"]').trigger('click')
    asked.accept()
    await flushPromises()

    expect(remove).toHaveBeenCalledWith('provider_box')
    expect(wrapper.find('[data-connection-body]').exists()).toBe(false)
  })

  it('adds one from the plus, as an open card of its own over the rest', async () => {
    const wrapper = mountList()
    await openCard(wrapper, 'provider_box')
    expect(wrapper.find('[data-adding-connection]').exists()).toBe(false)

    await wrapper.find('[data-action="add-connection"]').trigger('click')

    const adding = wrapper.find('[data-adding-connection]')
    expect(adding.find('[data-card-toggle]').text()).toContain('New connection')
    expect(adding.find('[data-card-toggle]').attributes('aria-expanded')).toBe('true')
    expect(adding.findComponent({ name: 'ConnectionForm' }).props('mode')).toBe('add')
    // The one that was open is shut for it.
    expect(wrapper.find('[data-connection-body]').exists()).toBe(false)
    // In a box of its own, before the list's.
    const boxes = wrapper.findAll('[data-card-list]')
    expect(boxes).toHaveLength(2)
    expect(boxes[0].find('[data-adding-connection]').exists()).toBe(true)

    await adding.find('[data-action="done"]').trigger('click')
    expect(wrapper.find('[data-adding-connection]').exists()).toBe(false)
  })

  it('puts the new card away on a click on its name', async () => {
    const wrapper = mountList()
    await wrapper.find('[data-action="add-connection"]').trigger('click')

    await wrapper.find('[data-adding-connection] [data-card-toggle]').trigger('click')

    expect(wrapper.find('[data-adding-connection]').exists()).toBe(false)
  })

  it('shows the one being made in its own card, and among the rest once it is done', async () => {
    const wrapper = mountList()
    await wrapper.find('[data-action="add-connection"]').trigger('click')
    const adding = wrapper.find('[data-adding-connection]')

    // Its form made the connection it is on.
    await adding.findComponent({ name: 'ConnectionForm' }).vm.$emit('shown', 'provider_box')
    expect(card(wrapper, 'provider_box').exists()).toBe(false)

    await adding.find('[data-action="done"]').trigger('click')
    expect(card(wrapper, 'provider_box').exists()).toBe(true)
  })

  it('draws no box, and says nothing, with no connections', async () => {
    rows.length = 0
    const wrapper = mountList()

    expect(wrapper.find('[data-card-list]').exists()).toBe(false)
    expect(wrapper.find('[data-ai-connections]').text()).toBe('')
    // The plus is still there to make the first.
    expect(wrapper.find('[data-action="add-connection"]').attributes('aria-label')).toBe(
      'Add connection'
    )
  })

  it('puts its plus beside the heading of the section it is in', async () => {
    const heading = document.createElement('div')
    heading.id = 'ai-connections-heading'
    document.body.appendChild(heading)
    const wrapper = mountList({
      attachTo: document.body,
      global: { provide: { [SECTION_HEADING]: '#ai-connections-heading' } },
    })
    await flushPromises()

    expect(heading.querySelector('[data-action="add-connection"]')).not.toBeNull()
    expect(wrapper.find('[data-ai-connections] [data-action="add-connection"]').exists()).toBe(
      false
    )

    heading.querySelector('[data-action="add-connection"]').click()
    await flushPromises()
    expect(wrapper.find('[data-adding-connection]').exists()).toBe(true)
    wrapper.unmount()
    heading.remove()
  })
})

describe('ConnectionDialog', () => {
  beforeEach(() => vi.clearAllMocks())

  const mountDialog = providerId =>
    mount(ConnectionDialog, {
      props: { visible: true, providerId },
      global: { plugins: [PrimeVue], stubs },
      attachTo: document.body,
    })

  it('has OpenRouter’s routing floor, and removes a connection once asked', async () => {
    const wrapper = mountDialog('provider_openrouter_default')
    await flushPromises()
    expect(wrapper.find('[data-routing]').exists()).toBe(true)
    expect(wrapper.find('[data-field="concurrency"]').exists()).toBe(true)

    await wrapper.find('[data-action="remove-connection"]').trigger('click')
    expect(asked.message).toBe("Remove OpenRouter? Its key can't be brought back.")
    expect(remove).not.toHaveBeenCalled()

    asked.accept()
    expect(remove).toHaveBeenCalledWith('provider_openrouter_default')
    expect(wrapper.emitted('close')?.[0]).toEqual([null])
    wrapper.unmount()
  })

  it('has no routing for a server, and says which connection it was on as it closes', async () => {
    const wrapper = mountDialog('provider_box')
    await flushPromises()
    expect(wrapper.find('[data-routing]').exists()).toBe(false)
    // Nothing else here says how it answered, so the form does, beside Connect.
    expect(wrapper.findComponent({ name: 'ConnectionForm' }).props('showState')).toBe(true)

    await wrapper.find('[data-action="done"]').trigger('click')
    expect(wrapper.emitted('close')?.[0]).toEqual(['provider_box'])
    wrapper.unmount()
  })
})
