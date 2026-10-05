import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PanelToggle from '@/components/writer/layout/PanelToggle.vue'

const mountToggle = props => mount(PanelToggle, { props, global: { directives: { tooltip: {} } } })

describe('PanelToggle', () => {
  it('names the neighbour and what a press does to it', () => {
    const hiding = mountToggle({ panel: 'chat', side: 'right', showing: true })
    expect(hiding.attributes('aria-label')).toBe('Hide chat')
    expect(hiding.attributes('aria-pressed')).toBe('false')

    const showing = mountToggle({ panel: 'chat', side: 'right', showing: false })
    expect(showing.attributes('aria-label')).toBe('Show chat')
    // Pressed is this panel spread out over the neighbour's room.
    expect(showing.attributes('aria-pressed')).toBe('true')
  })

  it('points toward a neighbour it would push off, and back to let it in', () => {
    const icon = props => mountToggle(props).find('i').classes()

    expect(icon({ panel: 'chat', side: 'right', showing: true })).toContain('pi-angle-double-right')
    expect(icon({ panel: 'chat', side: 'right', showing: false })).toContain('pi-angle-double-left')
    expect(icon({ panel: 'editor', side: 'left', showing: true })).toContain('pi-angle-double-left')
    expect(icon({ panel: 'editor', side: 'left', showing: false })).toContain(
      'pi-angle-double-right'
    )
  })

  it('asks for the toggle', async () => {
    const wrapper = mountToggle({ panel: 'chat', side: 'right', showing: true })
    await wrapper.trigger('click')
    expect(wrapper.emitted('toggle')).toHaveLength(1)
  })
})
