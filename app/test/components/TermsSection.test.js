import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { mount } from '@vue/test-utils'
import TermsSection from '@/components/common/welcome/TermsSection.vue'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')

describe('TermsSection', () => {
  it("is the docs' Terms of Service, word for word", () => {
    const about = read('../../../docs/src/content/docs/about.md')
    const [, docs] = about.split(/^## Terms of Service\n/m)
    expect(docs, 'the docs About page has no Terms of Service section').toBeDefined()
    const section = docs.split(/^## /m)[0]
    expect(read('../../src/components/common/welcome/terms.md').trim()).toBe(section.trim())
  })

  it('renders the headings and lists', () => {
    const wrapper = mount(TermsSection)
    expect(wrapper.findAll('h3').map(h => h.text())).toContain('No Warranty')
    expect(wrapper.findAll('ul').length).toBeGreaterThan(0)
  })

  it('opens its links in a tab of their own', () => {
    const links = mount(TermsSection).findAll('a')
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      expect(link.attributes('target')).toBe('_blank')
      expect(link.attributes('rel')).toBe('noopener noreferrer')
    }
  })
})
