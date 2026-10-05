import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AboutSection from '@/components/writer/settings/AboutSection.vue'
import { FONT_CREDITS, ICON_CREDITS, iconUrl } from '@/config/credits.js'

describe('AboutSection', () => {
  it('says what the app is released under and links its source', () => {
    const wrapper = mount(AboutSection)
    const hrefs = wrapper.findAll('a').map(link => link.attributes('href'))
    expect(wrapper.text()).toContain('GNU Affero General Public License')
    expect(hrefs).toContain('https://github.com/inksprite-io/inksprite')
  })

  it('credits every icon by title and creator, linked to its page', () => {
    const items = mount(AboutSection).findAll('[data-credits="icons"] li')
    expect(items).toHaveLength(ICON_CREDITS.length)
    ICON_CREDITS.forEach((credit, index) => {
      expect(items[index].text()).toBe(`${credit.title} by ${credit.creator}`)
      expect(items[index].find('a').attributes('href')).toBe(iconUrl(credit.id))
    })
  })

  it('credits the font and names its license', () => {
    const fonts = mount(AboutSection).find('[data-credits="fonts"]').text()
    for (const font of FONT_CREDITS) {
      expect(fonts).toContain(font.name)
      expect(fonts).toContain(font.license.name)
    }
  })
})
