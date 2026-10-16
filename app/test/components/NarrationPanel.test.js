import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, reactive, ref } from 'vue'
import PrimeVue from 'primevue/config'
import NarrationPanel from '@/components/writer/narration/NarrationPanel.vue'
import { blocksOf } from '@/tts/script.js'
import { utterancesOf } from '@/tts/reading.js'
import { parseFilters } from '@/tts/filters.js'

const narrator = { id: 'narrator', name: 'Narrator', voice: 'af_heart' }

const blocks = blocksOf('Riley walked in.\n\n"You pick," she said.\n\nNobody moved.')
const plan = speakers =>
  utterancesOf(blocks, speakers, [narrator], 'narrator', [], parseFilters(state.filters))

const state = reactive({
  configured: true,
  speakers: [null, null, null],
  reading: null,
  inStep: true,
  filters: '',
  choice: { providerId: 'provider_kokoro_default', model: 'kokoro' },
})

const narration = {
  choice: computed(() => state.choice),
  choose: vi.fn(),
  restore: vi.fn(async () => {}),
  connection: computed(() => ({ endpoint: 'http://localhost:8880/v1', apiKey: '', model: '' })),
  configured: computed(() => state.configured),
  voices: computed(() => [narrator]),
  defaultVoiceId: computed(() => 'narrator'),
  hints: computed(() => ''),
  filters: computed(() => state.filters),
  filterPatterns: computed(() => parseFilters(state.filters)),
  serverVoices: ref([]),
  mixes: ref(true),
  watching: ref(0),
  loadServerVoices: vi.fn(async () => []),
  addVoice: vi.fn(),
  updateVoice: vi.fn(),
  removeVoice: vi.fn(),
  setDefaultVoice: vi.fn(),
  setHints: vi.fn(),
  setFilters: vi.fn(),
  blocksOf: vi.fn(() => blocks),
  speakersOf: vi.fn(() => state.speakers),
  utterancesOf: vi.fn(() => plan(state.speakers)),
  setSpeaker: vi.fn(),
  readingOf: vi.fn(() => state.reading),
  inStep: vi.fn(() => state.inStep),
  narrate: vi.fn(async () => {}),
  refreshTrack: vi.fn(),
  stop: vi.fn(),
  download: vi.fn(),
  preview: vi.fn(async () => {}),
  previewHints: vi.fn(async () => {}),
}
vi.mock('@/composables/useNarration', () => ({ useNarration: () => narration }))

vi.mock('@/composables/useDocuments', () => ({
  useDocuments: () => ({
    init: vi.fn(async () => {}),
    get: id => (id === 'doc_1' ? { id, title: 'Dinner' } : null),
    displayTitle: doc => doc?.title || 'Untitled',
  }),
}))

const highlightSpeakers = ref(true)
const setHighlightSpeakers = vi.fn(value => (highlightSpeakers.value = value))
vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => ({ highlightSpeakers, setHighlightSpeakers }),
}))

const toast = { error: vi.fn(), success: vi.fn() }
vi.mock('@/composables/useToast', () => ({ useToast: () => toast }))

const Script = {
  name: 'NarrationScript',
  props: [
    'blocks',
    'speakers',
    'states',
    'voices',
    'defaultVoiceId',
    'selection',
    'playing',
    'playable',
    'busy',
  ],
  emits: ['assign', 'play', 'generate', 'update:selection'],
  template:
    '<div data-script :data-count="blocks.length" :data-states="states.join()" :data-playable="playable" :data-busy="busy" :data-playing="playing ?? \'\'" :data-selection="selection.join()" />',
}
const Player = {
  name: 'NarrationPlayer',
  props: ['url'],
  emits: ['time'],
  template: '<div data-player :data-url="url" />',
  methods: { seek: vi.fn() },
}
const Hints = {
  name: 'NarrationHints',
  props: ['hints', 'previewing'],
  emits: ['update:hints', 'preview'],
  template: '<div data-hints :data-previewing="previewing" />',
}
const Filters = {
  name: 'NarrationFilters',
  props: ['filters'],
  emits: ['update:filters'],
  template: '<div data-filters :data-text="filters" />',
}
const passthrough = { template: '<div><slot /></div>' }
const expand = vi.fn()
const Section = {
  props: ['title'],
  template: '<div :data-section-title="title"><slot /></div>',
  methods: { expand },
}
const Model = {
  name: 'NarrationModel',
  props: ['choice'],
  emits: ['choose'],
  template: '<div data-model />',
}

const mountPanel = props =>
  mount(NarrationPanel, {
    props: { storyId: 'story_1', documentId: 'doc_1', ...props },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: {
        NarrationScript: Script,
        NarrationPlayer: Player,
        NarrationVoices: { template: '<div data-voices />' },
        NarrationHints: Hints,
        NarrationFilters: Filters,
        NarrationModel: Model,
        ExpandableSection: Section,
        ScrollPanel: passthrough,
      },
    },
  })

/** A reading with audio for some of what the document asks for. */
const readingWith = (signatures, fields = {}) => ({
  status: 'done',
  done: signatures.length,
  total: signatures.length,
  current: null,
  failed: null,
  error: null,
  clips: new Set(signatures),
  track: {
    segments: [
      { start: 0, end: 1, index: 0 },
      { start: 1.4, end: 2.4, index: 1 },
      { start: 2.8, end: 3.8, index: 2 },
    ],
    duration: 3.8,
    key: 'k',
  },
  url: 'blob:track',
  ...fields,
})
const allRead = fields =>
  readingWith(
    plan(state.speakers).map(u => u.signature),
    fields
  )

const scriptOfPanel = wrapper => wrapper.find('[data-script]')

describe('NarrationPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    narration.watching.value = 0
    state.choice = { providerId: 'provider_kokoro_default', model: 'kokoro' }
    highlightSpeakers.value = true
    Object.assign(state, {
      configured: true,
      speakers: [null, null, null],
      reading: null,
      inStep: true,
      filters: '',
    })
  })

  afterEach(() => vi.useRealTimers())

  it('says when there is no server, and where to set one up', async () => {
    state.configured = false
    const wrapper = mountPanel()
    expect(wrapper.find('[data-notice="unconfigured"]').exists()).toBe(true)
    for (const action of ['generate', 'generate-sample', 'regenerate-all']) {
      expect(wrapper.find(`[data-action="${action}"]`).attributes('disabled')).toBeDefined()
    }
    expect(scriptOfPanel(wrapper).attributes('data-busy')).toBe('true')

    await wrapper.find('[data-notice="unconfigured"] button').trigger('click')
    expect(expand).toHaveBeenCalledTimes(1)
  })

  it('shows the document in the editor as segments, and generates them on request', async () => {
    const wrapper = mountPanel()
    expect(wrapper.find('[data-document-title]').text()).toBe('Dinner')
    expect(wrapper.find('[data-block-count]').text()).toBe('3 segments')
    expect(scriptOfPanel(wrapper).attributes('data-count')).toBe('3')
    expect(scriptOfPanel(wrapper).attributes('data-states')).toBe('missing,missing,missing')

    const generate = wrapper.find('[data-action="generate"]')
    expect(generate.attributes('aria-label')).toBe('Generate')
    expect(generate.text()).toBe('')
    await generate.trigger('click')
    expect(narration.narrate).toHaveBeenCalledWith('doc_1', {})
  })

  it('stays the same with no document open, with nothing in it', () => {
    const wrapper = mountPanel({ documentId: '' })
    expect(wrapper.find('[data-document-title]').text()).toBe('No open document')
    expect(wrapper.find('[data-block-count]').text()).toBe('0 segments')
    for (const action of ['generate', 'generate-sample', 'regenerate-all']) {
      expect(wrapper.find(`[data-action="${action}"]`).attributes('disabled')).toBeDefined()
    }
    expect(wrapper.find('[data-action="download"]').exists()).toBe(false)
    expect(wrapper.find('[data-player]').attributes('data-url')).toBe('')
    expect(scriptOfPanel(wrapper).attributes('data-count')).toBe('0')
    // The voices and the hints are the project's, and can still be kept.
    expect(wrapper.find('[data-voices]').exists()).toBe(true)
    expect(wrapper.find('[data-hints]').exists()).toBe(true)
    expect(narration.blocksOf).not.toHaveBeenCalled()
  })

  it('keeps the project’s filters, and counts only the segments that are read', async () => {
    state.filters = '^Nobody.*'
    const wrapper = mountPanel()
    expect(wrapper.find('[data-filters]').attributes('data-text')).toBe('^Nobody.*')
    await wrapper.findComponent(Filters).vm.$emit('update:filters', '^Page \\d+$')
    expect(narration.setFilters).toHaveBeenCalledWith('^Page \\d+$')

    expect(wrapper.find('[data-block-count]').text()).toBe('2 segments')
    expect(scriptOfPanel(wrapper).attributes('data-states')).toBe('missing,missing,skipped')
    await wrapper.find('[data-action="generate-sample"]').trigger('click')
    expect(narration.narrate).toHaveBeenCalledWith('doc_1', { blocks: [0, 1] })

    // What is read has all been generated, and the skipped segment is not missed.
    state.reading = readingWith(
      plan(state.speakers)
        .slice(0, 2)
        .map(u => u.signature)
    )
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-block-count]').text()).toBe('2 of 2 segments generated')
    expect(wrapper.find('[data-action="generate"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-action="download"]').attributes('aria-label')).toBe(
      'Download as WAV'
    )
  })

  it('passes a speaker on to the document', async () => {
    const wrapper = mountPanel()
    await wrapper.findComponent(Script).vm.$emit('assign', [1, 2], 'riley')
    expect(narration.setSpeaker).toHaveBeenCalledWith('doc_1', [1, 2], 'riley')
  })

  it('generates the segments selected, and lets the selection go', async () => {
    state.reading = allRead()
    const wrapper = mountPanel()
    await wrapper.findComponent(Script).vm.$emit('update:selection', [1, 2])
    expect(scriptOfPanel(wrapper).attributes('data-selection')).toBe('1,2')
    expect(wrapper.find('[data-block-count]').text()).toBe('3 of 3 segments generated · 2 selected')
    const generate = wrapper.find('[data-action="generate"]')
    expect(generate.attributes('aria-label')).toBe('Generate 2 selected segments')
    // Though every segment has audio, the selection is generated again.
    expect(generate.attributes('disabled')).toBeUndefined()

    await generate.trigger('click')
    expect(narration.narrate).toHaveBeenCalledWith('doc_1', { blocks: [1, 2] })
    expect(scriptOfPanel(wrapper).attributes('data-selection')).toBe('')
  })

  it('clears a selection without reading it', async () => {
    const wrapper = mountPanel()
    await wrapper.findComponent(Script).vm.$emit('update:selection', [0])
    await wrapper.find('[data-action="clear-selection"]').trigger('click')
    expect(scriptOfPanel(wrapper).attributes('data-selection')).toBe('')
    expect(narration.narrate).not.toHaveBeenCalled()
  })

  it('generates one segment on its own', async () => {
    const wrapper = mountPanel()
    await wrapper.findComponent(Script).vm.$emit('generate', 2)
    expect(narration.narrate).toHaveBeenCalledWith('doc_1', { blocks: [2] })
  })

  it('shows the run as it goes, and offers to stop it', async () => {
    state.reading = allRead({ status: 'running', done: 1, total: 2, url: null, track: null })
    const wrapper = mountPanel()
    expect(wrapper.find('[data-action="generate"]').exists()).toBe(false)
    expect(wrapper.find('[data-progress]').text()).toBe('Generating 2 of 2…')
    expect(wrapper.find('[data-action="generate-sample"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-action="regenerate-all"]').attributes('disabled')).toBeDefined()
    expect(scriptOfPanel(wrapper).attributes('data-busy')).toBe('true')

    await wrapper.find('[data-action="stop"]').trigger('click')
    expect(narration.stop).toHaveBeenCalledWith('doc_1')
  })

  it('says what has been generated, and offers to regenerate it all', async () => {
    state.reading = allRead()
    const wrapper = mountPanel()
    expect(wrapper.find('[data-block-count]').text()).toBe('3 of 3 segments generated')
    expect(scriptOfPanel(wrapper).attributes('data-states')).toBe('ready,ready,ready')
    // Nothing is left to generate, and nothing to sample.
    expect(wrapper.find('[data-action="generate"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-action="generate-sample"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-player]').attributes('data-url')).toBe('blob:track')
    expect(scriptOfPanel(wrapper).attributes('data-playable')).toBe('true')

    await wrapper.find('[data-action="regenerate-all"]').trigger('click')
    expect(narration.narrate).toHaveBeenCalledWith('doc_1', { blocks: [0, 1, 2] })

    await wrapper.find('[data-action="download"]').trigger('click')
    expect(narration.download).toHaveBeenCalledWith('doc_1')
  })

  it('has nothing to regenerate or play before anything is generated', () => {
    const wrapper = mountPanel()
    expect(wrapper.find('[data-action="regenerate-all"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-action="download"]').exists()).toBe(false)
    // The player stays, with nothing in it.
    expect(wrapper.find('[data-player]').attributes('data-url')).toBe('')
  })

  it('generates a sample from the opening, of what has no audio', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-action="generate-sample"]').trigger('click')
    expect(narration.narrate).toHaveBeenCalledWith('doc_1', { blocks: [0, 1, 2] })

    state.reading = readingWith([plan(state.speakers)[0].signature])
    await wrapper.vm.$nextTick()
    await wrapper.find('[data-action="generate-sample"]').trigger('click')
    expect(narration.narrate).toHaveBeenLastCalledWith('doc_1', { blocks: [1, 2] })
  })

  it('says a download is partial when it is', () => {
    state.reading = readingWith([plan(state.speakers)[0].signature])
    const wrapper = mountPanel()
    expect(wrapper.find('[data-block-count]').text()).toBe('1 of 3 segments generated')
    expect(wrapper.find('[data-action="generate"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.find('[data-action="download"]').attributes('aria-label')).toBe(
      'Download what has been generated (1 of 3) as WAV'
    )
  })

  it('follows the track through the segments, and plays from one', async () => {
    state.reading = allRead()
    const wrapper = mountPanel()
    const player = wrapper.findComponent(Player)

    await player.vm.$emit('time', 1.5)
    expect(scriptOfPanel(wrapper).attributes('data-playing')).toBe('1')
    await player.vm.$emit('time', 0.2)
    expect(scriptOfPanel(wrapper).attributes('data-playing')).toBe('0')

    await wrapper.findComponent(Script).vm.$emit('play', 2)
    expect(Player.methods.seek).toHaveBeenCalledWith(2.8)
  })

  it('stops leading and following while the track is out of step, and joins it again', async () => {
    state.reading = allRead()
    state.inStep = false
    const wrapper = mountPanel()
    expect(scriptOfPanel(wrapper).attributes('data-playable')).toBe('false')
    expect(scriptOfPanel(wrapper).attributes('data-playing')).toBe('')

    // The document changes under the panel; once it rests, the track is
    // joined again to match.
    state.speakers = [null, 'riley', null]
    await wrapper.vm.$nextTick()
    expect(narration.refreshTrack).not.toHaveBeenCalled()
    vi.advanceTimersByTime(500)
    expect(narration.refreshTrack).toHaveBeenCalledWith('doc_1')
  })

  it('leaves the track alone while a run is under way', async () => {
    state.reading = allRead({ status: 'running' })
    const wrapper = mountPanel()
    state.speakers = [null, 'riley', null]
    await wrapper.vm.$nextTick()
    vi.advanceTimersByTime(500)
    expect(narration.refreshTrack).not.toHaveBeenCalled()
  })

  it('says why a run failed, keeping what was read', () => {
    state.reading = allRead({ status: 'failed', error: 'Voice not found' })
    const wrapper = mountPanel()
    expect(wrapper.find('[data-notice="failed"]').text()).toBe('Voice not found')
    expect(wrapper.find('[data-player]').exists()).toBe(true)
  })

  it('says a run was stopped', () => {
    state.reading = allRead({ status: 'stopped', done: 1, total: 2 })
    const wrapper = mountPanel()
    expect(wrapper.find('[data-notice="stopped"]').text()).toBe('Stopped after 1 of 2.')
  })

  it('has the editor colour speakers while it is showing, unless switched off', async () => {
    const wrapper = mountPanel()
    expect(narration.watching.value).toBe(1)

    const toggle = wrapper.find('[data-action="toggle-highlight"]')
    expect(toggle.element.tagName).toBe('BUTTON')
    expect(toggle.attributes('aria-pressed')).toBe('true')
    await toggle.trigger('click')
    expect(setHighlightSpeakers).toHaveBeenCalledWith(false)
    expect(toggle.attributes('aria-pressed')).toBe('false')
    // Its name stays put; whether it is on is what it says pressed.
    expect(toggle.attributes('aria-label')).toBe('Colour speakers in the editor')

    wrapper.unmount()
    expect(narration.watching.value).toBe(0)
  })

  it('has its title and buttons in the header', () => {
    const wrapper = mountPanel()
    const header = wrapper.findComponent({ name: 'PanelHeader' })
    expect(header.props('title')).toBe('Narration')
    expect(header.findAll('button').map(b => b.attributes('data-action'))).toEqual([
      'toggle-highlight',
    ])
  })

  it('reads the hinted words out on request, and says why it cannot', async () => {
    const wrapper = mountPanel()
    const hints = wrapper.findComponent(Hints)
    await hints.vm.$emit('preview')
    expect(narration.previewHints).toHaveBeenCalledTimes(1)

    narration.previewHints.mockRejectedValueOnce(new Error('Voice not found'))
    await hints.vm.$emit('preview')
    await vi.waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))
    expect(hints.attributes('data-previewing')).toBe('false')
  })

  it('chooses what the project is read through at the top of Voices', async () => {
    const wrapper = mountPanel()
    const model = wrapper.findComponent(Model)
    expect(model.props('choice')).toEqual({
      providerId: 'provider_kokoro_default',
      model: 'kokoro',
    })
    expect(model.element.parentElement.dataset.sectionTitle).toBe('Voices')

    await model.vm.$emit('choose', { model: 'other' })
    expect(narration.choose).toHaveBeenCalledWith({ model: 'other' })
  })

  it("reads back what was kept of the document's narration, and again for another model", async () => {
    mountPanel()
    expect(narration.restore).toHaveBeenCalledWith('doc_1')
    await vi.runAllTimersAsync()
    expect(narration.loadServerVoices).toHaveBeenCalledTimes(1)

    state.choice = { providerId: 'provider_openrouter_default', model: 'hexgrad/kokoro-82m' }
    await Promise.resolve()
    expect(narration.restore).toHaveBeenCalledTimes(2)
    expect(narration.loadServerVoices).toHaveBeenCalledTimes(2)
  })

  it('reads nothing back with no document open', () => {
    mountPanel({ documentId: '' })
    expect(narration.restore).not.toHaveBeenCalled()
  })
})
