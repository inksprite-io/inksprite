import { describe, it, expect, beforeEach, vi } from 'vitest'
import { computed, reactive } from 'vue'

const mockClient = vi.hoisted(() => ({ listVoices: vi.fn() }))
vi.mock('@/tts/client.js', async importOriginal => ({
  ...(await importOriginal()),
  listVoices: mockClient.listVoices,
}))

const choice = reactive({ providerId: 'provider_kokoro_default', model: 'kokoro' })
vi.mock('@/composables/useApplicationState', () => ({
  useApplicationState: () => ({ narration: computed(() => ({ ...choice })) }),
}))

/** @type {Record<string, Record<string, any>>} */
const providers = reactive({})
vi.mock('@/composables/useAIConfig', () => ({
  useAIConfig: () => ({ getProvider: id => providers[id] ?? null }),
}))

const listModels = vi.fn()
vi.mock('@/composables/useAIService', () => ({ useAIService: () => ({ listModels }) }))

/** @type {typeof import('@/composables/useSpeechServer.js').useSpeechServer} */
let useSpeechServer

const KOKORO = {
  id: 'provider_kokoro_default',
  name: 'Kokoro',
  type: 'generic',
  endpoint: 'http://localhost:8880/v1',
}
const OPENROUTER = { id: 'provider_openrouter_default', name: 'OpenRouter', type: 'openrouter' }

describe('useSpeechServer', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    for (const id of Object.keys(providers)) delete providers[id]
    providers[KOKORO.id] = { ...KOKORO }
    providers[OPENROUTER.id] = { ...OPENROUTER, apiKey: 'sk-or' }
    providers.provider_anthropic_default = {
      id: 'provider_anthropic_default',
      type: 'anthropic',
      apiKey: 'sk-ant',
    }
    Object.assign(choice, { providerId: KOKORO.id, model: 'kokoro' })
    listModels.mockImplementation(async (id, kind) =>
      id === OPENROUTER.id && kind === 'speech'
        ? [
            { id: 'hexgrad/kokoro-82m', name: 'Kokoro 82M', voices: ['af_heart', 'bm_george'] },
            { id: 'google/gemini-tts', name: 'Gemini TTS', voices: ['Kore'], inputLimit: 4096 },
          ]
        : [{ id: 'kokoro', name: 'kokoro' }]
    )
    // What a server offers is the app's, kept between uses: a fresh module
    // for each test.
    vi.resetModules()
    ;({ useSpeechServer } = await import('@/composables/useSpeechServer.js'))
  })

  it('sends a request through the connection and model picked', () => {
    const server = useSpeechServer()
    expect(server.configured.value).toBe(true)
    expect(server.connection.value).toEqual({
      endpoint: 'http://localhost:8880/v1',
      model: 'kokoro',
      type: 'generic',
    })
    expect(server.via.value).toBe('provider_kokoro_default\nkokoro')
  })

  it('has nowhere to send one without a model, a connection that speaks, or a key', () => {
    const server = useSpeechServer()

    choice.model = null
    expect(server.configured.value).toBe(false)
    expect(server.connection.value).toBeNull()

    Object.assign(choice, { providerId: 'provider_anthropic_default', model: 'claude' })
    expect(server.configured.value).toBe(false)

    providers[OPENROUTER.id].apiKey = ''
    Object.assign(choice, { providerId: OPENROUTER.id, model: 'hexgrad/kokoro-82m' })
    expect(server.configured.value).toBe(false)
  })

  it('asks Kokoro for its voices once per address and key, after its models', async () => {
    mockClient.listVoices.mockResolvedValue(['af_heart', 'af_nicole'])
    const server = useSpeechServer()

    expect(await server.load()).toEqual(['af_heart', 'af_nicole'])
    await server.load()
    expect(listModels).toHaveBeenCalledWith(KOKORO.id, 'speech')
    expect(mockClient.listVoices).toHaveBeenCalledTimes(1)
    expect(mockClient.listVoices).toHaveBeenCalledWith({
      endpoint: 'http://localhost:8880/v1',
      model: 'kokoro',
      type: 'generic',
    })
    expect(server.voices.value).toEqual(['af_heart', 'af_nicole'])

    providers[KOKORO.id].endpoint = 'http://elsewhere:8880/v1'
    expect(server.voices.value).toEqual([])
    await server.load()
    providers[KOKORO.id].apiKey = 'sk-1'
    await server.load()
    expect(mockClient.listVoices).toHaveBeenCalledTimes(3)
  })

  it("takes OpenRouter's voices from its list of models, and its limit", async () => {
    Object.assign(choice, { providerId: OPENROUTER.id, model: 'hexgrad/kokoro-82m' })
    const server = useSpeechServer()

    expect(await server.load()).toEqual(['af_heart', 'bm_george'])
    expect(mockClient.listVoices).not.toHaveBeenCalled()

    choice.model = 'google/gemini-tts'
    expect(server.voices.value).toEqual(['Kore'])
    expect(server.connection.value).toMatchObject({
      endpoint: 'https://openrouter.ai/api/v1/',
      apiKey: 'sk-or',
      model: 'google/gemini-tts',
      type: 'openrouter',
      inputLimit: 4096,
    })
  })

  it('offers no voices when they cannot be asked for, and asks again next time', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockClient.listVoices.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    mockClient.listVoices.mockResolvedValueOnce(['af_heart'])
    const server = useSpeechServer()
    expect(await server.load()).toEqual([])
    expect(await server.load()).toEqual(['af_heart'])
  })

  it('asks nothing of a server with no address', async () => {
    providers[KOKORO.id].endpoint = ''
    expect(await useSpeechServer().load()).toEqual([])
    expect(listModels).not.toHaveBeenCalled()
    expect(mockClient.listVoices).not.toHaveBeenCalled()
  })
})
