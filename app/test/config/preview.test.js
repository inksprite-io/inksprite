import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { PREVIEWS, inPreview, previewsNamed } from '@/config/preview.js'

describe('previewsNamed', () => {
  it('reads names separated by commas, spaces, or both', () => {
    expect([...previewsNamed('explore,research')]).toEqual(['explore', 'research'])
    expect([...previewsNamed(' explore  research ')]).toEqual(['explore', 'research'])
    expect([...previewsNamed('explore, research')]).toEqual(['explore', 'research'])
  })

  it('reads nothing from an empty or missing value', () => {
    expect(previewsNamed('').size).toBe(0)
    expect(previewsNamed(undefined).size).toBe(0)
  })
})

describe('inPreview', () => {
  beforeEach(() => {
    PREVIEWS.sample = '2026-10-18'
    PREVIEWS.other = '2026-10-18'
  })

  afterEach(() => {
    delete PREVIEWS.sample
    delete PREVIEWS.other
    vi.unstubAllEnvs()
  })

  it('is off in a build that names no preview', () => {
    vi.stubEnv('VITE_PREVIEW', '')
    expect(inPreview('sample')).toBe(false)
  })

  it('is on for the previews the build names, and only those', () => {
    vi.stubEnv('VITE_PREVIEW', 'sample')
    expect(inPreview('sample')).toBe(true)
    expect(inPreview('other')).toBe(false)
  })

  it('is on for every preview in a build with all', () => {
    vi.stubEnv('VITE_PREVIEW', 'all')
    expect(inPreview('sample')).toBe(true)
    expect(inPreview('other')).toBe(true)
  })

  it('refuses a name that is not in preview', () => {
    vi.stubEnv('VITE_PREVIEW', 'all')
    expect(() => inPreview('sampel')).toThrow('No feature named "sampel" is in preview')
  })
})

describe('PREVIEWS', () => {
  it('gives each preview the day it went in', () => {
    for (const [name, day] of Object.entries(PREVIEWS)) {
      expect(day, name).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})
