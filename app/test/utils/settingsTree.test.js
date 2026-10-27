import { describe, it, expect } from 'vitest'
import {
  leavesOf,
  pickedSettings,
  selectionKeys,
  settingsTree,
  tickedLeaves,
} from '@/utils/settingsTree.js'

const SETTINGS = [
  { key: 'aiProviders/provider_proxy', kind: 'aiProviders', name: 'Team proxy' },
  { key: 'aiProviders/provider_home', kind: 'aiProviders', name: 'Home server' },
  {
    key: 'aiProfiles/profile_team',
    kind: 'aiProfiles',
    name: 'Team',
    needs: ['aiProviders/provider_proxy'],
  },
  { key: 'settings/preferences', kind: 'settings', name: 'Preferences' },
]

/** The labels of a tree, nested as it is. */
const shape = nodes =>
  nodes.map(node => (node.children ? { [node.label]: shape(node.children) } : node.label))

describe('settingsTree', () => {
  it('has a heading for each kind there is any of, in the kinds’ order', () => {
    expect(shape(settingsTree(SETTINGS))).toEqual([
      { Connections: ['Team proxy', 'Home server'] },
      { Presets: ['Team'] },
      { 'App settings': ['Preferences'] },
    ])
    expect(settingsTree([])).toEqual([])
  })

  it('has a leaf for each setting', () => {
    expect(leavesOf(settingsTree(SETTINGS))).toEqual([
      'setting:aiProviders/provider_proxy',
      'setting:aiProviders/provider_home',
      'setting:aiProfiles/profile_team',
      'setting:settings/preferences',
    ])
  })
})

describe('selectionKeys', () => {
  it('checks a heading when all under it is ticked, and partly when some is', () => {
    const nodes = settingsTree(SETTINGS)
    const keys = selectionKeys(
      nodes,
      new Set(['setting:aiProviders/provider_proxy', 'setting:aiProfiles/profile_team'])
    )
    expect(keys['kind:aiProviders']).toEqual({ checked: false, partialChecked: true })
    expect(keys['kind:aiProfiles']).toEqual({ checked: true, partialChecked: false })
    expect(keys['kind:settings']).toBeUndefined()
  })
})

describe('tickedLeaves', () => {
  it('reads the leaves back, and ticks what a setting newly ticked needs', () => {
    const nodes = settingsTree(SETTINGS)
    const ticked = tickedLeaves(
      nodes,
      { 'setting:aiProfiles/profile_team': { checked: true, partialChecked: false } },
      new Set(),
      SETTINGS
    )
    expect([...ticked].sort()).toEqual(
      ['setting:aiProfiles/profile_team', 'setting:aiProviders/provider_proxy'].sort()
    )
  })

  it('leaves a need unticked by hand once the setting was ticked before', () => {
    const nodes = settingsTree(SETTINGS)
    const before = new Set(['setting:aiProfiles/profile_team'])
    const ticked = tickedLeaves(
      nodes,
      { 'setting:aiProfiles/profile_team': { checked: true, partialChecked: false } },
      before,
      SETTINGS
    )
    expect([...ticked]).toEqual(['setting:aiProfiles/profile_team'])
  })
})

describe('pickedSettings', () => {
  it('is the items’ keys', () => {
    expect(
      pickedSettings(new Set(['setting:settings/preferences', 'setting:aiProviders/provider_home']))
    ).toEqual(new Set(['settings/preferences', 'aiProviders/provider_home']))
  })
})
