/* global Blob */
import { describe, it, expect } from 'vitest'
import { asMade, asSent, idOf, settingsOf, settingsRows } from '@/cloud/setup.js'
import { DEFAULT_PRESET_ID } from '@/ai/defaults.js'

describe('the setup as sync sends it', () => {
  it('knows a skill’s wording by its skill’s name, and the rest by their ids', () => {
    expect(idOf('skillWordings', { name: 'interpret' })).toBe('interpret')
    expect(idOf('aiProviders', { id: 'provider_x' })).toBe('provider_x')
    expect(idOf('settings', { id: 'preferences' })).toBe('preferences')
  })

  it('leaves out a key not kept, why a server could not be listed, and a card’s picture', () => {
    expect(asSent('aiProviders', { id: 'p', apiKey: 'sk', rememberKey: false })).toEqual({
      id: 'p',
      rememberKey: false,
    })
    expect(asSent('aiProviders', { id: 'p', apiKey: 'sk', rememberKey: true }).apiKey).toBe('sk')
    expect(asSent('mcpServers', { id: 'm', error: 'Unreachable', tools: [] })).toEqual({
      id: 'm',
      tools: [],
    })
    expect(
      asSent('cardFiles', { id: 'c', card: { name: 'Vex' }, image: new Blob(), thumbnail: null })
    ).toEqual({ id: 'c', card: { name: 'Vex' } })
  })

  it('tells a built-in left as every install makes it from one the writer changed', () => {
    const builtIn = { id: 'provider_openrouter_default', type: 'openrouter' }
    expect(asMade('aiProviders', builtIn)).toBe(true)
    expect(asMade('aiProviders', { ...builtIn, apiKey: 'sk' })).toBe(false)
    expect(asMade('aiProviders', { id: 'provider_mine', type: 'generic' })).toBe(false)

    const preset = { id: DEFAULT_PRESET_ID, created: 1000, updated: 1001 }
    expect(asMade('aiProfiles', preset)).toBe(true)
    expect(asMade('aiProfiles', { ...preset, updated: 90_000 })).toBe(false)
    expect(asMade('aiProfiles', { ...preset, id: 'profile_mine' })).toBe(false)
  })

  it('makes a row of each group of settings, without the checker’s switch, and back', () => {
    const settings = /** @type {any} */ ({
      aiPreset: 'profile_work',
      theme: 'dark',
      applyEdits: 'ask',
      askBeforeExploring: false,
      spelling: { enabled: true, dialect: 'british', grammar: false, words: ['Vex'] },
    })
    const rows = settingsRows(settings)
    expect(rows.find(row => row.id === 'aiPreset')).toEqual({
      id: 'aiPreset',
      aiPreset: 'profile_work',
    })
    expect(rows.find(row => row.id === 'spelling')).toEqual({
      id: 'spelling',
      spelling: { dialect: 'british', grammar: false, words: ['Vex'] },
    })

    expect(rows.find(row => row.id === 'preferences')).toMatchObject({
      applyEdits: 'ask',
      askBeforeExploring: false,
    })

    const back = settingsOf(rows)
    expect(back.theme).toBe('dark')
    expect(back.askBeforeExploring).toBe(false)
    expect(back.spelling).toEqual({ dialect: 'british', grammar: false, words: ['Vex'] })
    expect(back).not.toHaveProperty('chatProfileId')
  })
})
