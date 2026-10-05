import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ICON_CREDITS, OWN_ICONS, iconUrl } from '@/config/credits.js'

/**
 * The credits are a promise to the people whose icons the app draws: every
 * downloaded icon and every icon component is either credited or ours, and
 * CREDITS.md says the same as the app does. These fail when an icon arrives
 * without its credit, which is the moment to add it.
 */

// Paths from app/, where the tests run.
const ICONS_DIR = 'public/static/icons'
const COMPONENTS_DIR = 'src/components/icons'
const CREDITS_MD = '../CREDITS.md'

const downloaded = readdirSync(ICONS_DIR).filter(name => /^noun[-_]/.test(name))
const components = readdirSync(COMPONENTS_DIR)
  .filter(name => name.endsWith('.vue'))
  .map(name => name.replace(/\.vue$/, ''))

describe('icon credits', () => {
  it('credits every icon downloaded from the Noun Project, once', () => {
    const credited = ICON_CREDITS.map(credit => credit.file)
    expect([...credited].sort()).toEqual([...downloaded].sort())
  })

  it('numbers each credit as its file is numbered', () => {
    for (const credit of ICON_CREDITS) {
      expect(credit.file).toMatch(new RegExp(`[-_]${credit.id}\\.svg$`))
    }
  })

  it('accounts for every icon component, as credited or as ours', () => {
    const credited = ICON_CREDITS.flatMap(credit => credit.usedAs)
    for (const name of components) {
      expect(credited.includes(name) || OWN_ICONS.includes(name), name).toBe(true)
    }
  })

  it('names only icon components and files that exist', () => {
    for (const use of ICON_CREDITS.flatMap(credit => credit.usedAs)) {
      if (use.endsWith('.svg')) expect(existsSync(join(ICONS_DIR, use)), use).toBe(true)
      else expect(components, use).toContain(use)
    }
    for (const name of OWN_ICONS) expect(components).toContain(name)
  })

  it('lists the same icons in CREDITS.md, with their creators', () => {
    const markdown = readFileSync(CREDITS_MD, 'utf8')
    for (const credit of ICON_CREDITS) {
      const row = markdown.split('\n').find(line => line.includes(iconUrl(credit.id)))
      expect(row, credit.file).toBeDefined()
      expect(row).toContain(credit.creator)
    }
  })
})
