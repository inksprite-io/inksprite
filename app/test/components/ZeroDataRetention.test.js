import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ToggleSwitch from 'primevue/toggleswitch'
import ZeroDataRetention from '@/components/writer/settings/ai/ZeroDataRetention.vue'

/** @param {Record<string, any>} props */
const mountSwitch = props =>
  mount(ZeroDataRetention, {
    props,
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })

const reset = wrapper => wrapper.find('button[aria-label="Reset Zero data retention"]')

describe('ZeroDataRetention', () => {
  it('shows whether it is on, by its name', () => {
    const on = mountSwitch({ modelValue: true })
    expect(on.text()).toContain('Zero data retention')
    expect(on.findComponent(ToggleSwitch).props()).toMatchObject({
      modelValue: true,
      ariaLabel: 'Zero data retention',
    })

    expect(mountSwitch({ modelValue: false }).findComponent(ToggleSwitch).props('modelValue')).toBe(
      false
    )
  })

  it('says what it is switched to, keeping nothing itself', async () => {
    const wrapper = mountSwitch({ modelValue: true })

    await wrapper.findComponent(ToggleSwitch).vm.$emit('update:modelValue', false)

    expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
    expect(wrapper.findComponent(ToggleSwitch).props('modelValue')).toBe(true)
  })

  it('offers the reset only while it is off its default', async () => {
    const wrapper = mountSwitch({ modelValue: true })
    expect(reset(wrapper).exists()).toBe(false)

    await wrapper.setProps({ modelValue: false, overridden: true })
    await reset(wrapper).trigger('click')

    expect(wrapper.emitted('reset')).toHaveLength(1)
  })
})
