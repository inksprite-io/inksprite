import { describe, it, expect } from 'vitest'
import { allowedProvidersToPresets } from '@/stores/migrations/allowedProviders.js'
import { upgradeTables } from '@/utils/backup.js'

const connection = (id, routing) => ({ id, type: 'openrouter', routing })

describe('allowedProvidersToPresets', () => {
  it('moves a connection’s list onto every preset that uses it', () => {
    const { providers, presets, moved } = allowedProvidersToPresets(
      [connection('or', { only: ['deepinfra'], zdr: true }), connection('other', { zdr: true })],
      [
        { id: 'a', providerId: 'or', model: 'glm' },
        { id: 'b', providerId: 'or', model: 'kimi' },
        { id: 'c', providerId: 'other', model: 'glm' },
      ]
    )

    expect(moved).toBe(1)
    expect(providers[0].routing).toEqual({ zdr: true })
    expect(presets.map(p => p.allowedProviders)).toEqual([['deepinfra'], ['deepinfra'], undefined])
  })

  it('leaves a preset with a list of its own alone', () => {
    const { presets } = allowedProvidersToPresets(
      [connection('or', { only: ['deepinfra'] })],
      [{ id: 'a', providerId: 'or', allowedProviders: ['novita'] }]
    )

    expect(presets[0].allowedProviders).toEqual(['novita'])
  })

  it('takes an empty list off and gives the presets nothing', () => {
    const { providers, presets, moved } = allowedProvidersToPresets(
      [connection('or', { only: [], zdr: false })],
      [{ id: 'a', providerId: 'or' }]
    )

    expect(moved).toBe(1)
    expect(providers[0].routing).toEqual({ zdr: false })
    expect(presets[0]).not.toHaveProperty('allowedProviders')
  })

  it('drops junk from the list on the way across', () => {
    const { presets } = allowedProvidersToPresets(
      [connection('or', { only: ['deepinfra', '', null, 3] })],
      [{ id: 'a', providerId: 'or' }]
    )

    expect(presets[0].allowedProviders).toEqual(['deepinfra'])
  })

  it('leaves rows already moved as they are, so it can run twice', () => {
    const provider = connection('or', { zdr: true })
    const preset = { id: 'a', providerId: 'or', allowedProviders: ['deepinfra'] }
    const unrouted = { id: 'local', type: 'llamacpp' }
    const { providers, presets, moved } = allowedProvidersToPresets([provider, unrouted], [preset])

    expect(moved).toBe(0)
    expect(providers[0]).toBe(provider)
    expect(providers[1]).toBe(unrouted)
    expect(presets[0]).toBe(preset)
  })

  it('runs on a backup from before', () => {
    const tables = upgradeTables(
      {
        aiProviders: [connection('or', { only: ['deepinfra'], zdr: true })],
        aiProfiles: [{ id: 'a', providerId: 'or', model: 'glm' }],
      },
      23,
      24
    )

    expect(tables.aiProviders[0].routing).toEqual({ zdr: true })
    expect(tables.aiProfiles[0].allowedProviders).toEqual(['deepinfra'])
  })
})
