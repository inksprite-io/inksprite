import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AboutSection from '@/components/writer/settings/AboutSection.vue'
import { ICON_CREDITS, iconUrl } from '@/config/credits.js'

describe('AboutSection', () => {
  it('gives the copyright and license, and links the source and the issues', () => {
    const wrapper = mount(AboutSection)
    const hrefs = wrapper.findAll('a').map(link => link.attributes('href'))
    expect(wrapper.text()).toContain('Copyright © 2025–2026 The inksprite Authors.')
    expect(wrapper.text()).toContain('GNU Affero General Public License')
    expect(wrapper.text()).toContain('no warranty')
    expect(hrefs).toContain('https://github.com/inksprite-io/inksprite')
    expect(hrefs).toContain('https://github.com/inksprite-io/inksprite/issues')
  })

  it('names the release it is, when it was built as one', () => {
    expect(mount(AboutSection, { props: { version: '0.1.0-dev.8' } }).text()).toContain(
      'inksprite 0.1.0-dev.8'
    )
    expect(mount(AboutSection).find('[data-version]').exists()).toBe(false)
  })

  it('credits every icon by title and creator, linked to its page', () => {
    const items = mount(AboutSection).findAll('[data-credits="icons"] li')
    expect(items).toHaveLength(ICON_CREDITS.length)
    ICON_CREDITS.forEach((credit, index) => {
      expect(items[index].text()).toBe(`${credit.title} by ${credit.creator}`)
      expect(items[index].find('a').attributes('href')).toBe(iconUrl(credit.id))
    })
  })
})
