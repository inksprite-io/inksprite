import { describe, it, expect, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ProfileNoticeHost from '@/components/common/ProfileNoticeHost.vue'
import { useProfileNotice } from '@/composables/useProfileNotice.js'
import { getBuiltInProfile, ROLEPLAY_NSFW_PROFILE_ID } from '@/ai/profiles/index.js'

const Dialog = {
  props: ['visible', 'header'],
  template:
    '<div v-if="visible" data-dialog><h2>{{ header }}</h2><slot /><slot name="footer" /></div>',
}

const mountHost = () =>
  mount(ProfileNoticeHost, { global: { plugins: [PrimeVue], stubs: { Dialog } } })

describe('ProfileNoticeHost', () => {
  const notice = useProfileNotice()

  beforeEach(() => {
    window.localStorage.clear()
    notice.dismiss()
  })

  it('shows nothing while no notice is waiting', () => {
    expect(mountHost().find('[data-dialog]').exists()).toBe(false)
  })

  it('shows the waiting notice, a paragraph at a time', async () => {
    const wrapper = mountHost()
    notice.noticeFor(ROLEPLAY_NSFW_PROFILE_ID)
    await flushPromises()

    const { header, message } = getBuiltInProfile(ROLEPLAY_NSFW_PROFILE_ID).notice
    expect(wrapper.find('h2').text()).toBe(header)
    expect(wrapper.findAll('p').map(p => p.text())).toEqual(message.split('\n\n'))
  })

  it('puts it away when the writer has read it', async () => {
    const wrapper = mountHost()
    notice.noticeFor(ROLEPLAY_NSFW_PROFILE_ID)
    await flushPromises()

    await wrapper.find('button').trigger('click')

    expect(notice.pending.value).toBeNull()
    expect(wrapper.find('[data-dialog]').exists()).toBe(false)
  })
})
