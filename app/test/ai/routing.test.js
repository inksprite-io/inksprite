import { describe, it, expect } from 'vitest'
import {
  ROUTING_DEFAULTS,
  resolveRouting,
  isRoutingOverridden,
  buildProviderRouting,
  isClosedWeights,
} from '@/ai/routing.js'

/** An OpenRouter connection carrying `routing`. */
const openRouter = routing => ({ type: 'openrouter', routing })

describe('resolveRouting', () => {
  it('fills a missing record out to the defaults', () => {
    expect(resolveRouting(undefined)).toEqual(ROUTING_DEFAULTS)
  })

  it('keeps knobs a partial record does carry', () => {
    // Records written before a knob existed simply don't have it.
    expect(resolveRouting({ only: ['deepinfra'] })).toEqual({
      ...ROUTING_DEFAULTS,
      only: ['deepinfra'],
    })
  })

  it('gives a record from before the floor the floor', () => {
    // A connection saved when routing had no privacy knobs is not a decision
    // to allow data collection; it gets the default like any other missing knob.
    expect(resolveRouting({ only: [] }).zdr).toBe(true)
    expect(resolveRouting({ only: [] }).dataCollection).toBe('deny')
    expect(resolveRouting({ only: [] }).quantizations).toEqual(ROUTING_DEFAULTS.quantizations)
  })

  it('keeps a floor that was lowered on purpose', () => {
    // The panel writes the whole policy, so a lowered floor is stored as the
    // permissive value and stays lowered — including an emptied precision
    // list, which means any precision, not the default list.
    expect(resolveRouting({ zdr: false, dataCollection: 'allow', quantizations: [] })).toEqual({
      ...ROUTING_DEFAULTS,
      zdr: false,
      dataCollection: 'allow',
      quantizations: [],
    })
  })

  it('drops junk out of the slug lists', () => {
    // Routing crosses the backup boundary, where a hand-edited file can put
    // anything in these arrays. A malformed `only` must not narrow routing.
    const resolved = resolveRouting({ only: ['deepinfra', '', null, 42, 'together'] })

    expect(resolved.only).toEqual(['deepinfra', 'together'])
  })

  it('treats a non-array list as unset', () => {
    expect(resolveRouting({ only: 'deepinfra' }).only).toEqual([])
    expect(resolveRouting({ ignore: 'deepinfra' }).ignore).toEqual(ROUTING_DEFAULTS.ignore)
  })

  it('leaves Morph out of a connection with no ignore list, and keeps one a writer set', () => {
    // Morph returned responses of nothing but repeated tool calls on GLM 5.2.
    expect(resolveRouting(undefined).ignore).toEqual(['morph'])
    expect(resolveRouting({ ignore: [] }).ignore).toEqual([])
    expect(resolveRouting({ ignore: ['deepinfra'] }).ignore).toEqual(['deepinfra'])
  })
})

describe('isRoutingOverridden', () => {
  it('is false for an untouched connection', () => {
    for (const key of Object.keys(ROUTING_DEFAULTS)) {
      expect(isRoutingOverridden(undefined, key)).toBe(false)
    }
  })

  it('reports a list that differs from its default as overridden', () => {
    expect(isRoutingOverridden({ only: ['deepinfra'] }, 'only')).toBe(true)
    expect(isRoutingOverridden({ only: [] }, 'only')).toBe(false)
    // The precision list's default is not empty, so emptying it is a change.
    expect(isRoutingOverridden({ quantizations: ['fp8'] }, 'quantizations')).toBe(true)
    expect(isRoutingOverridden({ quantizations: [] }, 'quantizations')).toBe(true)
    expect(
      isRoutingOverridden({ quantizations: ROUTING_DEFAULTS.quantizations }, 'quantizations')
    ).toBe(false)
  })

  it('reports a flipped scalar as overridden', () => {
    expect(isRoutingOverridden({ dataCollection: 'allow' }, 'dataCollection')).toBe(true)
    expect(isRoutingOverridden({ zdr: false }, 'zdr')).toBe(true)
    expect(isRoutingOverridden({ allowFallbacks: false }, 'allowFallbacks')).toBe(true)
  })

  it('does not report the privacy floor as overridden', () => {
    // The floor is the default, so a record that carries it explicitly — the
    // panel writes the whole policy — is at rest.
    expect(isRoutingOverridden({ dataCollection: 'deny', zdr: true }, 'zdr')).toBe(false)
    expect(isRoutingOverridden({ dataCollection: 'deny', zdr: true }, 'dataCollection')).toBe(false)
  })
})

describe('buildProviderRouting', () => {
  it('sends the floor for a connection nobody has configured', () => {
    // The floor is not what OpenRouter does on its own, so it has to be said.
    const floor = {
      ignore: ['morph'],
      data_collection: 'deny',
      zdr: true,
      quantizations: ROUTING_DEFAULTS.quantizations,
    }
    expect(buildProviderRouting(openRouter(undefined))).toEqual(floor)
    expect(buildProviderRouting(openRouter({ ...ROUTING_DEFAULTS }))).toEqual(floor)
  })

  it('omits the field for a connection with the floor lowered and nothing set', () => {
    // Every remaining value is what OpenRouter does anyway.
    expect(
      buildProviderRouting(
        openRouter({
          ...ROUTING_DEFAULTS,
          ignore: [],
          zdr: false,
          dataCollection: 'allow',
          quantizations: [],
        })
      )
    ).toBeUndefined()
  })

  it('omits the field for a non-OpenRouter provider', () => {
    // A local llama.cpp has no concept of upstream routing, and would reject
    // or ignore the field.
    expect(buildProviderRouting({ type: 'generic', routing: { zdr: true } })).toBeUndefined()
  })

  it('translates every knob to its wire name', () => {
    const field = buildProviderRouting(
      openRouter({
        only: ['anthropic'],
        ignore: ['together'],
        dataCollection: 'deny',
        zdr: true,
        quantizations: ['fp8', 'bf16'],
        allowFallbacks: false,
      })
    )

    expect(field).toEqual({
      only: ['anthropic'],
      ignore: ['together'],
      quantizations: ['fp8', 'bf16'],
      data_collection: 'deny',
      zdr: true,
      allow_fallbacks: false,
    })
  })

  it('sends only the knobs that constrain routing', () => {
    expect(
      buildProviderRouting(
        openRouter({
          zdr: true,
          dataCollection: 'allow',
          quantizations: [],
          only: ['anthropic'],
          ignore: [],
        })
      )
    ).toEqual({ zdr: true, only: ['anthropic'] })
  })

  it("doesn't send the permissive values of the boolean knobs", () => {
    // `zdr: false` and `allow_fallbacks: true` are what OpenRouter already
    // does; sending them adds noise without changing routing.
    expect(
      buildProviderRouting(
        openRouter({
          zdr: false,
          dataCollection: 'allow',
          quantizations: [],
          allowFallbacks: true,
          ignore: [],
        })
      )
    ).toBeUndefined()
  })

  it('leaves the quantization floor off a closed model, and keeps the rest of the policy', () => {
    const sent = buildProviderRouting(openRouter(undefined), 'anthropic/claude-sonnet-5')
    expect(sent).not.toHaveProperty('quantizations')
    expect(sent.data_collection).toBe('deny')
    expect(sent.zdr).toBe(true)

    expect(buildProviderRouting(openRouter(undefined), 'z-ai/glm-5.2')).toHaveProperty(
      'quantizations'
    )
    expect(isClosedWeights('openai/gpt-5')).toBe(true)
    expect(isClosedWeights('meta-llama/llama-4')).toBe(false)
    expect(isClosedWeights(undefined)).toBe(false)
  })
})
