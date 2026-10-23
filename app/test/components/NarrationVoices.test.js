import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import NarrationVoices from '@/components/writer/narration/NarrationVoices.vue'

const narrator = { id: 'narrator', name: 'Narrator', voice: 'af_heart', speed: 1 }
const riley = { id: 'riley', name: 'Riley', voice: 'af_nicole', speed: 1.1 }

const mountVoices = props =>
  mount(NarrationVoices, {
    props: { voices: [narrator, riley], defaultVoiceId: 'narrator', ...props },
    global: { plugins: [PrimeVue], directives: { tooltip: {} } },
  })

describe('NarrationVoices', () => {
  it('opens on the narrator', () => {
    const wrapper = mountVoices()
    expect(wrapper.find('[data-voice-name]').element.value).toBe('Narrator')
    expect(wrapper.find('[data-voice-string]').element.value).toBe('af_heart')
    expect(wrapper.find('[data-action="set-default"]').exists()).toBe(false)
  })

  it('writes a change as it is typed', async () => {
    const wrapper = mountVoices()
    await wrapper.find('[data-voice-name]').setValue('Reader')
    await wrapper.find('[data-voice-string]').setValue(' af_sky ')
    expect(wrapper.emitted('update')).toEqual([
      ['narrator', { name: 'Reader' }],
      ['narrator', { voice: 'af_sky' }],
    ])
  })

  it('gives a voice left nameless a name', async () => {
    const wrapper = mountVoices({ voices: [{ ...narrator, name: '' }, riley] })
    await wrapper.find('[data-voice-name]').trigger('blur')
    expect(wrapper.emitted('update')).toEqual([['narrator', { name: 'Untitled voice' }]])
  })

  it('asks for a voice to be added, and edits the one that arrives', async () => {
    const wrapper = mountVoices()
    await wrapper.find('[data-action="add-voice"]').trigger('click')
    expect(wrapper.emitted('add')).toHaveLength(1)

    const cody = { id: 'cody', name: 'Cody', voice: 'am_michael' }
    await wrapper.setProps({ voices: [narrator, riley, cody] })
    expect(wrapper.find('[data-voice-name]').element.value).toBe('Cody')
    expect(wrapper.find('[data-action="set-default"]').exists()).toBe(true)
  })

  it('removes the voice being edited, but never the last', async () => {
    const wrapper = mountVoices()
    await wrapper.find('[data-action="remove-voice"]').trigger('click')
    expect(wrapper.emitted('remove')).toEqual([['narrator']])

    const last = mountVoices({ voices: [narrator] })
    expect(last.find('[data-action="remove-voice"]').attributes('disabled')).toBeDefined()
  })

  it('settles on the narrator when the voice being edited goes', async () => {
    const wrapper = mountVoices()
    await wrapper.setProps({ voices: [narrator, riley, { id: 'cody', name: 'Cody', voice: 'x' }] })
    expect(wrapper.find('[data-voice-name]').element.value).toBe('Cody')
    await wrapper.setProps({ voices: [narrator, riley] })
    expect(wrapper.find('[data-voice-name]').element.value).toBe('Narrator')
  })

  it('offers what the server has, to mix in', async () => {
    const wrapper = mountVoices({ serverVoices: ['af_heart', 'af_nicole'], mixes: true })
    expect(wrapper.find('[data-voice-string]').attributes('placeholder')).toBe(
      'af_heart+af_nicole(2)'
    )
    expect(wrapper.find('[data-voice-mix]').exists()).toBe(true)
    // The select's own picker is PrimeVue's; what matters is the join.
    wrapper.findComponent({ name: 'Select', props: { placeholder: 'Add a voice to the mix…' } })
    const mix = wrapper.findAllComponents({ name: 'Select' }).at(-1)
    await mix.vm.$emit('update:modelValue', 'af_nicole')
    expect(wrapper.emitted('update')).toEqual([['narrator', { voice: 'af_heart+af_nicole' }]])
  })

  it("marks the voices in a mix the model doesn't list, once its voices are known", async () => {
    const mixed = { ...narrator, voice: 'af_heart+af_nicole(2)+Kore' }
    const wrapper = mountVoices({ voices: [mixed, riley], mixes: true })
    expect(wrapper.find('[data-voice-unknown]').exists()).toBe(false)

    await wrapper.setProps({ serverVoices: ['af_heart', 'af_nicole'] })
    expect(wrapper.find('[data-voice-unknown]').text()).toBe('This model has no voice called Kore.')

    await wrapper.setProps({ serverVoices: ['af_heart', 'af_nicole', 'Kore'] })
    expect(wrapper.find('[data-voice-unknown]').exists()).toBe(false)
  })

  it('gives a model that takes one voice its voices to pick from, and nothing to mix', async () => {
    const wrapper = mountVoices({ serverVoices: ['alloy', 'nova'] })
    expect(wrapper.find('[data-voice-string]').exists()).toBe(false)
    expect(wrapper.find('[data-voice-mix]').exists()).toBe(false)
    expect(wrapper.find('[data-voice-unknown]').text()).toBe(
      'This model has no voice called af_heart.'
    )

    const pick = wrapper.findAllComponents({ name: 'Select' }).at(-1)
    expect(pick.attributes('data-voice-pick')).toBeDefined()
    await pick.vm.$emit('update:modelValue', 'nova')
    expect(wrapper.emitted('update')).toEqual([['narrator', { voice: 'nova' }]])
  })

  it('calls a mix one unknown voice to a model that takes one', () => {
    const mixed = { ...narrator, voice: 'alloy+nova' }
    const wrapper = mountVoices({ voices: [mixed, riley], serverVoices: ['alloy', 'nova'] })
    expect(wrapper.find('[data-voice-unknown]').text()).toBe(
      'This model has no voice called alloy+nova.'
    )
  })

  it('has a voice typed for a model whose voices are not known', () => {
    const wrapper = mountVoices()
    expect(wrapper.find('[data-voice-string]').attributes('placeholder')).toBeUndefined()
    expect(wrapper.find('[data-voice-pick]').exists()).toBe(false)
  })

  it('calls the voice that reads the rest the default', async () => {
    const wrapper = mountVoices()
    expect(wrapper.text()).toContain('Default')
    expect(wrapper.text()).not.toContain('narrator')

    const select = wrapper.findComponent({ name: 'Select' })
    await select.vm.$emit('update:modelValue', 'riley')
    expect(wrapper.find('[data-action="set-default"]').text()).toBe('Use as default')
  })

  it('gives a voice a colour, or none', async () => {
    const wrapper = mountVoices({ voices: [{ ...narrator, color: '#ef4444' }, riley] })
    expect(wrapper.find('[data-color="#ef4444"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.find('[data-color=""]').attributes('aria-pressed')).toBe('false')

    await wrapper.find('[data-color="#3b82f6"]').trigger('click')
    await wrapper.find('[data-color=""]').trigger('click')
    expect(wrapper.emitted('update')).toEqual([
      ['narrator', { color: '#3b82f6' }],
      ['narrator', { color: undefined }],
    ])
  })

  it('previews the voice, and makes one the default', async () => {
    const wrapper = mountVoices()
    await wrapper.find('[data-action="preview"]').trigger('click')
    expect(wrapper.emitted('preview')).toEqual([[narrator]])

    const select = wrapper.findComponent({ name: 'Select' })
    await select.vm.$emit('update:modelValue', 'riley')
    await wrapper.find('[data-action="set-default"]').trigger('click')
    expect(wrapper.emitted('set-default')).toEqual([['riley']])
  })
})
