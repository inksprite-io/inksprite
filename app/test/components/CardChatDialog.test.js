import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import CardChatDialog from '@/components/writer/tree/CardChatDialog.vue'

const Dialog = { template: '<div><slot /><slot name="footer" /></div>' }

const card = (greetings = [{ id: 'g1', title: 'Greeting', content: 'Well?' }]) => ({
  title: 'Elara',
  name: 'Elara',
  greetings,
  pinnedIds: [],
  hiddenIds: [],
  shownIds: [],
  rules: '',
  systemPrompt: '',
})

const mountDialog = props =>
  mount(CardChatDialog, {
    props: { visible: true, card: card(), ...props },
    global: { plugins: [PrimeVue], stubs: { Dialog } },
  })

const start = wrapper => wrapper.find('button[aria-label="Start chat"]')

describe('CardChatDialog', () => {
  it('does not start a chat without a name', async () => {
    const wrapper = mountDialog()

    expect(start(wrapper).attributes('disabled')).toBeDefined()
    await wrapper.find('[data-user-name]').setValue('   ')
    expect(start(wrapper).attributes('disabled')).toBeDefined()
  })

  it('starts one with the name given', async () => {
    const wrapper = mountDialog()

    await wrapper.find('[data-user-name]').setValue(' Riley ')
    await start(wrapper).trigger('click')

    expect(wrapper.emitted('confirm')).toEqual([[{ userName: 'Riley', greeting: 0 }]])
  })

  it('starts from the name given last', () => {
    const wrapper = mountDialog({ lastUserName: 'Sam' })

    expect(wrapper.find('[data-user-name]').element.value).toBe('Sam')
  })

  it('asks which greeting only when there is more than one', async () => {
    expect(mountDialog().text()).not.toContain('Opening')

    const wrapper = mountDialog({
      card: card([
        { id: 'g1', title: 'Greeting', content: 'Well?' },
        { id: 'g2', title: 'Greeting 2', content: 'At last.' },
      ]),
      lastUserName: 'Sam',
    })
    expect(wrapper.text()).toContain('Opening')

    await wrapper
      .findAll('button')
      .find(button => button.text().includes('At last.'))
      .trigger('click')
    await start(wrapper).trigger('click')
    expect(wrapper.emitted('confirm')).toEqual([[{ userName: 'Sam', greeting: 1 }]])
  })
})
