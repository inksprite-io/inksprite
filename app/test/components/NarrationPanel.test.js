import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { computed, reactive, ref } from 'vue'
import PrimeVue from 'primevue/config'
import NarrationPanel from '@/components/writer/narration/NarrationPanel.vue'
import { blocksOf } from '@/tts/script.js'
import { utterancesOf } from '@/tts/reading.js'

const narrator = { id: 'narrator', name: 'Narrator', voice: 'af_heart' }

const blocks = blocksOf('Riley walked in.\n\n"You pick," she said.\n\nNobody moved.')
const plan = speakers => utterancesOf(blocks, speakers, [narrator], 'narrator', [])

const state = reactive({
  configured: true,
  speakers: [null, null, null],
  reading: null,
  inStep: true,
})

const narration = {
  connection: computed(() => ({ endpoint: 'http://localhost:8880/v1', apiKey: '', model: '' })),
  configured: computed(() => state.configured),
  voices: computed(() => [narrator]),
  defaultVoiceId: computed(() => 'narrator'),
  hints: computed(() => ''),
  serverVoices: ref([]),
  watching: ref(0),
  loadServerVoices: vi.fn(async () => []),
  addVoice: vi.fn(),
  updateVoice: vi.fn(),
  removeVoice: vi.fn(),
  setDefaultVoice: vi.fn(),
  setHints: vi.fn(),
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
}
vi.mock('@/composables/useNarration', () => ({ useNarration: () => narration }))

vi.mock('@/composables/useDocuments', () => ({
  useDocuments: () => ({
    init: vi.fn(async () => {}),
    get: id => (id === 'doc_1' ? { id, title: 'Dinner' } : null),
    displayTitle: doc => doc?.title || 'Untitled',
  }),
}))

const openSettings = vi.fn()
vi.mock('@/composables/useSettingsPanel.js', () => ({
  useSettingsPanel: () => ({ open: openSettings }),
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
const passthrough = { template: '<div><slot /></div>' }

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
        NarrationHints: { template: '<div data-hints />' },
        ExpandableSection: passthrough,
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
    highlightSpeakers.value = true
    Object.assign(state, {
      configured: true,
      speakers: [null, null, null],
      reading: null,
      inStep: true,
    })
  })

  afterEach(() => vi.useRealTimers())

  it('says when there is no server, and where to set one up', async () => {
    state.configured = false
    const wrapper = mountPanel()
    expect(wrapper.find('[data-notice="unconfigured"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="narrate"]').attributes('disabled')).toBeDefined()
    expect(scriptOfPanel(wrapper).attributes('data-busy')).toBe('true')

    await wrapper.find('[data-notice="unconfigured"] button').trigger('click')
    expect(openSettings).toHaveBeenCalledWith('narration')
  })

  it('shows the document in the editor as blocks, and reads it on request', async () => {
    const wrapper = mountPanel()
    expect(wrapper.find('[data-document-title]').text()).toBe('Dinner')
    expect(wrapper.find('[data-block-count]').text()).toBe('3 blocks')
    expect(scriptOfPanel(wrapper).attributes('data-count')).toBe('3')
    expect(scriptOfPanel(wrapper).attributes('data-states')).toBe('missing,missing,missing')

    await wrapper.find('[data-action="narrate"]').trigger('click')
    expect(narration.narrate).toHaveBeenCalledWith('doc_1', {})
  })

  it('asks the writer to open a document when none is', () => {
    const wrapper = mountPanel({ documentId: '' })
    expect(wrapper.find('[data-notice="no-document"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="narrate"]').exists()).toBe(false)
    // The voices and the hints are the project's, and can still be kept.
    expect(wrapper.find('[data-voices]').exists()).toBe(true)
    expect(wrapper.find('[data-hints]').exists()).toBe(true)
  })

  it('passes a speaker on to the document', async () => {
    const wrapper = mountPanel()
    await wrapper.findComponent(Script).vm.$emit('assign', [1, 2], 'riley')
    expect(narration.setSpeaker).toHaveBeenCalledWith('doc_1', [1, 2], 'riley')
  })

  it('reads the blocks selected, and lets the selection go', async () => {
    const wrapper = mountPanel()
    await wrapper.findComponent(Script).vm.$emit('update:selection', [1, 2])
    expect(scriptOfPanel(wrapper).attributes('data-selection')).toBe('1,2')
    expect(wrapper.find('[data-action="narrate"]').text()).toBe('Narrate 2 selected')

    await wrapper.find('[data-action="narrate"]').trigger('click')
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

  it('reads one block on its own', async () => {
    const wrapper = mountPanel()
    await wrapper.findComponent(Script).vm.$emit('generate', 2)
    expect(narration.narrate).toHaveBeenCalledWith('doc_1', { blocks: [2] })
  })

  it('shows the run as it goes, and offers to stop it', async () => {
    state.reading = allRead({ status: 'running', done: 1, total: 2, url: null, track: null })
    const wrapper = mountPanel()
    expect(wrapper.find('[data-action="narrate"]').exists()).toBe(false)
    expect(wrapper.find('[data-progress]').text()).toBe('Reading 2 of 2…')
    expect(scriptOfPanel(wrapper).attributes('data-busy')).toBe('true')

    await wrapper.find('[data-action="stop"]').trigger('click')
    expect(narration.stop).toHaveBeenCalledWith('doc_1')
  })

  it('says what has been read, and offers to read it all again', async () => {
    state.reading = allRead()
    const wrapper = mountPanel()
    expect(wrapper.find('[data-block-count]').text()).toBe('3 of 3 blocks read')
    expect(scriptOfPanel(wrapper).attributes('data-states')).toBe('ready,ready,ready')
    expect(wrapper.find('[data-action="narrate"]').text()).toBe('Narrate again')
    expect(wrapper.find('[data-player]').attributes('data-url')).toBe('blob:track')
    expect(scriptOfPanel(wrapper).attributes('data-playable')).toBe('true')

    await wrapper.find('[data-action="download"]').trigger('click')
    expect(narration.download).toHaveBeenCalledWith('doc_1')
  })

  it('says a download is partial when it is', () => {
    state.reading = readingWith([plan(state.speakers)[0].signature])
    const wrapper = mountPanel()
    expect(wrapper.find('[data-block-count]').text()).toBe('1 of 3 blocks read')
    expect(wrapper.find('[data-action="narrate"]').text()).toBe('Narrate')
    expect(wrapper.find('[data-action="download"]').attributes('aria-label')).toBe(
      'Download what has been read (1 of 3) as WAV'
    )
  })

  it('follows the track through the blocks, and plays from one', async () => {
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
    expect(toggle.attributes('aria-pressed')).toBe('true')
    await toggle.trigger('click')
    expect(setHighlightSpeakers).toHaveBeenCalledWith(false)
    expect(toggle.attributes('aria-pressed')).toBe('false')

    wrapper.unmount()
    expect(narration.watching.value).toBe(0)
  })

  it('opens the settings on the speech server', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-action="narration-settings"]').trigger('click')
    expect(openSettings).toHaveBeenCalledWith('narration')
  })
})
