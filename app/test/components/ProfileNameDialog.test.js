import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ProfileNameDialog from '@/components/writer/chats/ProfileNameDialog.vue'

/** The dialog, reduced to its header and what is in it. */
const Dialog = {
  props: ['visible', 'header'],
  emits: ['update:visible'],
  template: '<div v-if="visible" data-dialog :data-header="header"><slot /></div>',
}

const show = (props = {}) =>
  mount(ProfileNameDialog, {
    props: {
      visible: true,
      header: 'New profile',
      action: 'Create',
      name: 'New Profile',
      ...props,
    },
    attachTo: document.body,
    global: { plugins: [PrimeVue], stubs: { Dialog } },
  })

const field = wrapper => wrapper.find('[data-field="profile-name"]')
const save = wrapper => wrapper.find('[data-action="save-profile-name"]')

describe('ProfileNameDialog', () => {
  it('is headed and its button named for what it was opened for', () => {
    const creating = show()
    expect(creating.find('[data-dialog]').attributes('data-header')).toBe('New profile')
    expect(save(creating).text()).toBe('Create')

    const renaming = show({ header: 'Rename profile', action: 'Rename', name: 'Drafting' })
    expect(renaming.find('[data-dialog]').attributes('data-header')).toBe('Rename profile')
    expect(save(renaming).text()).toBe('Rename')
  })

  it('opens with the name it was given, selected once the field has the focus', async () => {
    const wrapper = show({ name: 'Drafting' })
    const input = /** @type {HTMLInputElement} */ (field(wrapper).element)

    expect(input.value).toBe('Drafting')
    expect(input.hasAttribute('autofocus')).toBe(true)

    input.setSelectionRange(0, 0)
    await field(wrapper).trigger('focus')
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 'Drafting'.length])
  })

  it('has nothing to save while the name is empty', async () => {
    const wrapper = show()

    await field(wrapper).setValue('   ')
    expect(save(wrapper).attributes('disabled')).toBeDefined()
    await wrapper.find('form').trigger('submit')
    expect(wrapper.emitted('save')).toBeUndefined()

    await field(wrapper).setValue('Editing')
    expect(save(wrapper).attributes('disabled')).toBeUndefined()
  })

  it('saves the name trimmed on Enter, and shuts', async () => {
    const wrapper = show()

    await field(wrapper).setValue('  Line edits ')
    // Enter in the field submits its form.
    await wrapper.find('form').trigger('submit')

    expect(wrapper.emitted('save')).toEqual([['Line edits']])
    expect(wrapper.emitted('update:visible')).toEqual([[false]])
  })

  it('shuts on Cancel, saving nothing', async () => {
    const wrapper = show()

    await field(wrapper).setValue('Editing')
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Cancel')
      .trigger('click')

    expect(wrapper.emitted('save')).toBeUndefined()
    expect(wrapper.emitted('update:visible')).toEqual([[false]])
  })

  it('opens again on the name given then, not on what was typed and left', async () => {
    const wrapper = show({ name: 'Drafting' })

    await field(wrapper).setValue('Half typed')
    await wrapper.setProps({ visible: false })
    await wrapper.setProps({ visible: true, name: 'Outlining' })

    expect(/** @type {HTMLInputElement} */ (field(wrapper).element).value).toBe('Outlining')
  })
})
