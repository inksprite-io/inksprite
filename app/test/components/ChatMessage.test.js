import { describe, it, expect, vi, afterEach } from 'vitest'
import { ref, computed, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ChatMessage from '../../src/components/writer/chats/ChatMessage.vue'

/** The message being shown, as the mocked chats API holds it. */
const stored = ref(null)

vi.mock('../../src/composables/useChats', () => ({
  useChats: () => ({ getMessageById: () => computed(() => stored.value) }),
}))

/** The project's documents, for a result saved into them. */
const savedDocuments = vi.hoisted(() => ({
  open: vi.fn(),
  createTextDocument: vi.fn((parentId, title) => ({ id: 'd_saved', parentId, title })),
}))
vi.mock('../../src/composables/useDocuments.js', () => ({
  useDocuments: () => ({
    root: { value: { title: 'Design docs' } },
    childrenOf: () => [],
    uniqueTitle: (parentId, title) => title,
    createTextDocument: savedDocuments.createTextDocument,
    pathOf: id => (id === 'd_saved' ? 'References/ENG-123' : ''),
    open: savedDocuments.open,
  }),
}))

/**
 * Show a message part-way through a turn that called tools: it thought, stopped
 * thinking once, and has written something.
 *
 * @param {Object} fields - What else the message holds
 * @param {'running'|'waiting'|'thinking'|'writing'|null} phase - What the turn is doing
 */
const show = (fields = {}, phase = null) => {
  stored.value = {
    id: 'm1',
    chatId: 'chat_1',
    role: 'assistant',
    content: 'I will read the notes.',
    reasoningContent: 'The writer wants a review.',
    streamingStartTime: 1000,
    thinkingFinishTime: 3700,
    ...fields,
  }
  return mount(ChatMessage, {
    props: {
      messageId: 'm1',
      storyId: 'story_1',
      activity: phase ? { messageId: 'm1', phase, since: Date.now() } : null,
    },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })
}

describe('ChatMessage while its turn runs', () => {
  it('says it is thinking when the turn thinks again after its first thought', () => {
    // Thinking first stopped at 3700, and the turn is thinking once more.
    const wrapper = show({}, 'thinking')

    expect(wrapper.text()).toContain('Thinking…')
    expect(wrapper.text()).not.toContain('Thought for')
  })

  it('says how long it thought once the turn is not thinking', () => {
    const wrapper = show({}, 'writing')

    expect(wrapper.text()).not.toContain('Thinking…')
    expect(wrapper.text()).toContain('Thought for')
  })

  it('shows every stretch thought for, added up', () => {
    const wrapper = show({ thinkingTime: 12000 })

    expect(wrapper.text()).toContain('Thought for 12')
  })

  it('reads a turn from before the total was kept by when thinking first stopped', () => {
    const wrapper = show()

    expect(wrapper.text()).toContain('Thought for 2.7')
  })

  const box = wrapper => wrapper.find('[data-thinking-box]')

  it('shows the status in the thinking box while the turn waits, in place of the time', () => {
    for (const phase of ['running', 'waiting']) {
      const wrapper = show({}, phase)
      expect(box(wrapper).find('[data-chat-status]').exists()).toBe(true)
      expect(box(wrapper).text()).not.toContain('Thought for')
    }
    expect(show({}, 'writing').find('[data-chat-status]').exists()).toBe(false)
    expect(show({}, null).find('[data-chat-status]').exists()).toBe(false)
  })

  it('shows the status nowhere else in the message', () => {
    const wrapper = show({}, 'waiting')

    expect(wrapper.findAll('[data-chat-status]')).toHaveLength(1)
  })

  it('gives a model that does not think the box only while it waits', async () => {
    const waiting = show({ reasoningContent: null, thinkingFinishTime: null }, 'waiting')
    expect(box(waiting).exists()).toBe(true)
    // Nothing to open onto: the box is only a status.
    await box(waiting).find('button').trigger('click')
    expect(box(waiting).find('.prose').exists()).toBe(false)

    expect(box(show({ reasoningContent: null }, 'writing')).exists()).toBe(false)
  })

  it('shows the status line in place of the empty state, not beside it', () => {
    const wrapper = show({ content: '', reasoningContent: null }, 'waiting')

    expect(box(wrapper).find('[data-chat-status]').exists()).toBe(true)
    expect(wrapper.findAll('.typing-dot')).toHaveLength(0)
  })

  it('grows only the calls with prose in the message, and says the rest in the status', () => {
    const wrapper = show(
      {
        pendingToolCalls: [
          { id: 'c1', name: 'search_documents', arguments: '{"query": "night"}' },
          { id: 'c2', name: 'create_document', arguments: '{"path": "Notes", "content": "The' },
        ],
      },
      'calling'
    )

    // A chip that came and went with every search made the turn jump.
    expect(wrapper.text()).not.toContain('search_documents')
    expect(wrapper.text()).toContain('Creating')
  })

  it('shows no dots under the box while it thinks with nothing written yet', () => {
    // They came back with every thought and went with every call, and the
    // turn jumped each time.
    const wrapper = show({ content: '', thinkingFinishTime: null }, 'thinking')

    expect(box(wrapper).text()).toContain('Thinking…')
    expect(wrapper.findAll('.typing-dot')).toHaveLength(0)
  })

  it('keeps the empty state for a message with no turn running', () => {
    const wrapper = show({ content: '', reasoningContent: null })

    expect(wrapper.find('[data-chat-status]').exists()).toBe(false)
    expect(wrapper.findAll('.typing-dot')).toHaveLength(3)
  })
})

describe('ChatMessage with the request that opened its turn', () => {
  const context = [
    { role: 'system', content: 'You are a writing partner.' },
    { role: 'user', content: 'Read the notes.' },
    {
      role: 'assistant',
      content: '',
      tool_calls: [{ id: 'c1', function: { name: 'read_document', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'c1', content: 'The notes.' },
  ]

  /** @param {import('@vue/test-utils').VueWrapper} wrapper */
  const header = wrapper =>
    wrapper.findAll('button').find(button => button.text().includes('Context sent'))

  it('says how much was sent without opening it', () => {
    const wrapper = show({ metadata: { context } })
    const calls = JSON.stringify(context[2].tool_calls, null, 2).length
    const characters = 26 + 15 + calls + 10

    expect(header(wrapper).text()).toContain(`4 messages · ${characters} characters`)
  })

  it('leaves the request out of the page until it is opened', async () => {
    // A long chat keeps one of these on every turn, and all of them in the
    // page at once came to tens of megabytes of text nobody was reading.
    const wrapper = show({ metadata: { context } })
    expect(wrapper.findAll('pre')).toHaveLength(0)

    await header(wrapper).trigger('click')

    const shown = wrapper.findAll('pre').map(pre => pre.text())
    expect(shown).toContain('You are a writing partner.')
    expect(shown).toContain('The notes.')
    expect(wrapper.text()).toContain('tool (c1)')
  })

  it('shows no panel for a turn that kept no request', () => {
    const wrapper = show({ metadata: {} })

    expect(header(wrapper)).toBeUndefined()
  })
})

describe('ChatMessage with the skills its turn consulted', () => {
  const call = (id, name, args = '{}') => ({
    id,
    type: 'function',
    function: { name, arguments: args },
  })

  /** A turn that asked the Director, and then the oracle itself. */
  const consulted = (directorResult = {}) => ({
    metadata: {
      apiTrajectory: [
        { role: 'assistant', content: null, tool_calls: [call('call_d', 'director')] },
        {
          role: 'tool',
          tool_call_id: 'call_d',
          content: '{"direction":"Have it open."}',
          _consultation: {
            thinking: 'Is the door locked?',
            calls: [
              { name: 'oracle', arguments: '{"question":"Locked?"}', result: '{"answer":"No"}' },
            ],
          },
          ...directorResult,
        },
        {
          role: 'assistant',
          content: null,
          tool_calls: [call('call_o', 'oracle', '{"question":"Is anyone home?"}')],
        },
        { role: 'tool', tool_call_id: 'call_o', content: '{"answer":"Yes"}' },
      ],
    },
  })

  const blocks = wrapper => wrapper.findAll('[data-consultation]')

  it('shows each skill as a block of its own, with the gist of its answer, folded', () => {
    const wrapper = show(consulted())

    expect(blocks(wrapper)).toHaveLength(1)
    expect(blocks(wrapper)[0].text()).toContain('Director')
    expect(blocks(wrapper)[0].find('[data-consultation-summary]').text()).toBe('Have it open.')
    expect(blocks(wrapper)[0].find('[data-consultation-body]').attributes('style')).toContain(
      'display: none'
    )
  })

  it('leaves the skills out of the tool calls', () => {
    const wrapper = show(consulted())

    expect(wrapper.text()).toContain('1 tool call')
    expect(wrapper.text()).not.toContain('2 tool calls')
  })

  it('opens onto what the skill thought, the tools it called and what it answered', async () => {
    const wrapper = show(consulted())

    await blocks(wrapper)[0].find('button').trigger('click')

    const body = blocks(wrapper)[0].find('[data-consultation-body]')
    expect(body.attributes('style') || '').not.toContain('display: none')
    expect(body.text()).toContain('Is the door locked?')
    expect(body.text()).toContain('oracle')
    expect(body.text()).toContain('Locked?')
    expect(body.text()).toContain('Have it open.')
  })

  it('shows what a skill that takes an argument was asked', async () => {
    const wrapper = show({
      metadata: {
        apiTrajectory: [
          {
            role: 'assistant',
            content: null,
            tool_calls: [call('call_i', 'interpret', '{"question":"What does she fear?"}')],
          },
          {
            role: 'tool',
            tool_call_id: 'call_i',
            content: '{"interpretation":"Being found out."}',
            _consultation: { calls: [] },
          },
        ],
      },
    })

    await blocks(wrapper)[0].find('button').trigger('click')

    expect(blocks(wrapper)[0].text()).toContain('Interpret')
    expect(blocks(wrapper)[0].text()).toContain('What does she fear?')
    expect(blocks(wrapper)[0].text()).toContain('Being found out.')
  })

  it('shows a skill the skill called as a block inside its own', async () => {
    const wrapper = show(
      consulted({
        _consultation: {
          calls: [
            {
              name: 'interpret',
              arguments: '{"question":"Who is inside?"}',
              result: '{"interpretation":"A stranger."}',
              consultation: { calls: [] },
            },
          ],
        },
      })
    )

    await blocks(wrapper)[0].find('button').trigger('click')

    expect(blocks(wrapper)).toHaveLength(2)
    expect(blocks(wrapper)[1].find('[data-consultation-summary]').text()).toBe('A stranger.')
  })

  it('says a skill wrote the reply rather than showing the reply twice', () => {
    const wrapper = show({
      content: 'The door opens on a hall.',
      metadata: {
        apiTrajectory: [
          { role: 'assistant', content: null, tool_calls: [call('call_s', 'scene')] },
          {
            role: 'tool',
            tool_call_id: 'call_s',
            content: '{"reply":"Written as the reply."}',
            _consultation: { calls: [], reply: true },
          },
        ],
      },
    })

    expect(blocks(wrapper)).toHaveLength(1)
    expect(blocks(wrapper)[0].text()).toContain('Scene')
    expect(blocks(wrapper)[0].find('[data-consultation-summary]').text()).toBe('Wrote the reply')
  })

  it('shows a skill still running by its name, before there is any answer', () => {
    const wrapper = show({
      pendingToolCalls: [{ id: 'call_d', name: 'director', arguments: '{}' }],
    })

    expect(blocks(wrapper)).toHaveLength(1)
    expect(blocks(wrapper)[0].text()).toContain('Director…')
  })

  it('shows the note a turn from before kept for the Director as the same block', () => {
    const wrapper = show({ metadata: { director: { direction: 'Cut to the docks.' } } })

    expect(blocks(wrapper)).toHaveLength(1)
    expect(blocks(wrapper)[0].find('[data-consultation-summary]').text()).toBe('Cut to the docks.')
  })
})

describe('ChatMessage with a server’s tool waiting on the writer', () => {
  const wiki = {
    id: 'mcp_wiki',
    name: 'Wiki',
    prefix: 'wiki',
    url: 'https://wiki.example/mcp',
    tools: [{ name: 'edit', title: 'Edit a page', exposed: 'wiki__edit', inputSchema: {} }],
    prompts: [],
    profiles: [],
    allowed: [],
    created: 1,
    updated: 1,
  }

  const call = {
    id: 'c1',
    type: 'function',
    function: { name: 'wiki__edit', arguments: '{"page":"Kenning"}' },
  }

  afterEach(async () => {
    const { setServers } = await import('../../src/mcp/servers.js')
    const { denyWaiting } = await import('../../src/composables/useToolApprovals.js')
    denyWaiting()
    setServers([])
  })

  it('names the server and the tool, shows what it was asked, and runs it on Allow', async () => {
    const { setServers } = await import('../../src/mcp/servers.js')
    const { askApproval } = await import('../../src/composables/useToolApprovals.js')
    setServers([wiki])
    const decided = askApproval('m1', call)

    const wrapper = show()
    await nextTick()
    const block = wrapper.find('[data-approval]')
    expect(block.text()).toContain('Wiki wants to run')
    expect(block.text()).toContain('Edit a page')
    expect(block.text()).toContain('"page": "Kenning"')

    await block.find('[data-action="allow"]').trigger('click')

    expect(await decided).toBe('allow')
    expect(wrapper.find('[data-approval]').exists()).toBe(false)
  })

  it('offers to always allow the tool, or everything from the server', async () => {
    const { setServers } = await import('../../src/mcp/servers.js')
    const { askApproval } = await import('../../src/composables/useToolApprovals.js')
    setServers([wiki])
    const decided = askApproval('m1', call)
    const wrapper = show()
    await nextTick()

    await wrapper.find('[data-approval] [data-action="always"]').trigger('click')
    const choices = wrapper.findComponent({ name: 'Menu' }).props('model')

    expect(choices.map(choice => choice.label)).toEqual(['This tool', 'Everything from Wiki'])
    choices[1].command()
    expect(await decided).toBe('always-server')
  })

  it('shows nothing for a call another message is waiting on', async () => {
    const { askApproval } = await import('../../src/composables/useToolApprovals.js')
    askApproval('m2', call)

    expect(show().find('[data-approval]').exists()).toBe(false)
  })
})

describe('ChatMessage with a server’s answer to keep', () => {
  const linear = {
    id: 'mcp_linear',
    name: 'Linear',
    prefix: 'linear',
    url: 'https://mcp.linear.app/mcp',
    tools: [{ name: 'get_issue', exposed: 'linear__get_issue', inputSchema: {} }],
    prompts: [],
    profiles: [],
    allowed: [],
    created: 1,
    updated: 1,
  }

  /** A turn that called these tools and got these answers. */
  const called = calls => ({
    metadata: {
      apiTrajectory: calls.flatMap(([id, name, content]) => [
        {
          role: 'assistant',
          content: null,
          tool_calls: [{ id, type: 'function', function: { name, arguments: '{"id":"ENG-123"}' } }],
        },
        { role: 'tool', tool_call_id: id, content },
      ]),
    },
  })

  const rows = wrapper => wrapper.findAll('[data-saved-result]')

  afterEach(async () => {
    const { setServers } = await import('../../src/mcp/servers.js')
    setServers([])
    savedDocuments.open.mockClear()
  })

  it('offers to save a server’s answer, and not the app’s tools or a failure', async () => {
    const { setServers } = await import('../../src/mcp/servers.js')
    setServers([linear])

    const wrapper = show(
      called([
        ['c1', 'linear__get_issue', 'ENG-123: Auth rework'],
        ['c2', 'read_document', '{"content":"x"}'],
        ['c3', 'linear__get_issue', '{"error":"It needs you to sign in."}'],
      ])
    )

    expect(rows(wrapper)).toHaveLength(1)
    expect(rows(wrapper)[0].find('[data-action="save-to-project"]').exists()).toBe(true)
  })

  it('still offers it for a server since removed, by its tools’ prefix', () => {
    const wrapper = show(called([['c1', 'linear__get_issue', 'ENG-123: Auth rework']]))

    expect(rows(wrapper)).toHaveLength(1)
  })

  it('saves it from the dialog, then says where it went and opens it', async () => {
    const { setServers } = await import('../../src/mcp/servers.js')
    setServers([linear])
    const wrapper = show(called([['c1', 'linear__get_issue', 'ENG-123: Auth rework']]))

    await rows(wrapper)[0].find('[data-action="save-to-project"]').trigger('click')
    await nextTick()
    // The dialog is teleported to the page, outside the message.
    document.body.querySelector('[data-action="save-result"]').click()
    await nextTick()

    expect(savedDocuments.createTextDocument).toHaveBeenCalled()
    expect(rows(wrapper)[0].text()).toContain('Saved as References/ENG-123')
    await rows(wrapper)[0].find('[data-action="open-saved"]').trigger('click')
    expect(savedDocuments.open).toHaveBeenCalledWith('d_saved')
  })
})
