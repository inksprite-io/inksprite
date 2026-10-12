/* global Event */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import NarrationPlayer from '@/components/writer/narration/NarrationPlayer.vue'

const mountPlayer = (props = { url: 'blob:track' }) =>
  mount(NarrationPlayer, {
    props,
    global: { plugins: [PrimeVue] },
  })

/**
 * The track as the browser would have it: jsdom plays nothing, so the
 * element says what it is told and fires what a browser would.
 * @param {HTMLAudioElement} audio
 */
const fake = audio => {
  let paused = true
  Object.defineProperty(audio, 'paused', { get: () => paused })
  Object.defineProperty(audio, 'duration', { value: 75, configurable: true })
  audio.play = vi.fn(async () => {
    paused = false
    audio.dispatchEvent(new Event('play'))
  })
  audio.pause = vi.fn(() => {
    paused = true
    audio.dispatchEvent(new Event('pause'))
  })
  audio.dispatchEvent(new Event('loadedmetadata'))
}

describe('NarrationPlayer', () => {
  let wrapper
  let audio

  beforeEach(async () => {
    wrapper = mountPlayer()
    audio = wrapper.find('audio').element
    fake(audio)
    await wrapper.vm.$nextTick()
  })

  it('has its own controls rather than the browser’s', () => {
    expect(wrapper.find('audio').attributes('controls')).toBeUndefined()
    expect(wrapper.find('[data-time]').text()).toBe('0:00 / 1:15')
  })

  it('plays and pauses from one button', async () => {
    const button = wrapper.find('[data-action="toggle-play"]')
    expect(button.attributes('aria-label')).toBe('Play')

    await button.trigger('click')
    expect(audio.play).toHaveBeenCalled()
    expect(button.attributes('aria-label')).toBe('Pause')

    await button.trigger('click')
    expect(audio.pause).toHaveBeenCalled()
    expect(button.attributes('aria-label')).toBe('Play')
  })

  it('says where it is as it plays', async () => {
    audio.currentTime = 65
    audio.dispatchEvent(new Event('timeupdate'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-time]').text()).toBe('1:05 / 1:15')
    expect(wrapper.emitted('time').at(-1)).toEqual([65])
  })

  it('goes where it is scrubbed to, and says where that is', async () => {
    await wrapper.find('[data-scrubber]').setValue(30)
    expect(audio.currentTime).toBe(30)
    expect(wrapper.emitted('time').at(-1)).toEqual([30])
    expect(wrapper.find('[data-scrubber]').attributes('aria-valuetext')).toBe('0:30 of 1:15')
    expect(wrapper.find('[data-scrubber]').attributes('style')).toContain('--played: 40%')
  })

  it('mutes and unmutes, with no volume of its own', async () => {
    const mute = wrapper.find('[data-action="toggle-mute"]')
    expect(mute.attributes('aria-label')).toBe('Mute')

    await mute.trigger('click')
    audio.dispatchEvent(new Event('volumechange'))
    await wrapper.vm.$nextTick()
    expect(audio.muted).toBe(true)
    expect(mute.attributes('aria-label')).toBe('Unmute')
    expect(mute.attributes('aria-pressed')).toBe('true')

    await mute.trigger('click')
    audio.dispatchEvent(new Event('volumechange'))
    await wrapper.vm.$nextTick()
    expect(audio.muted).toBe(false)
    expect(wrapper.findAll('input')).toHaveLength(1)
  })

  it('can be sent to a moment, and plays from there', () => {
    wrapper.vm.seek(12)
    expect(audio.currentTime).toBe(12)
    expect(audio.play).toHaveBeenCalled()
  })

  it('starts over when the track is joined again', async () => {
    await wrapper.find('[data-action="toggle-play"]').trigger('click')
    audio.dispatchEvent(new Event('emptied'))
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-action="toggle-play"]').attributes('aria-label')).toBe('Play')
    expect(wrapper.find('[data-time]').text()).toBe('0:00 / 0:00')
    expect(wrapper.emitted('time').at(-1)).toEqual([0])
  })

  it('is greyed out with nothing to play, and wakes when a track comes', async () => {
    const empty = mountPlayer({})
    expect(empty.find('[data-player]').attributes('data-empty')).toBeDefined()
    expect(empty.find('audio').exists()).toBe(false)
    expect(empty.find('[data-action="toggle-play"]').attributes('disabled')).toBeDefined()
    expect(empty.find('[data-action="toggle-mute"]').attributes('disabled')).toBeDefined()
    expect(empty.find('[data-scrubber]').attributes('disabled')).toBeDefined()
    expect(empty.find('[data-time]').text()).toBe('0:00 / 0:00')

    await empty.setProps({ url: 'blob:track' })
    expect(empty.find('[data-player]').attributes('data-empty')).toBeUndefined()
    expect(empty.find('audio').attributes('src')).toBe('blob:track')
    expect(empty.find('[data-action="toggle-play"]').attributes('disabled')).toBeUndefined()
  })

  it('starts over when the track goes', async () => {
    await wrapper.find('[data-action="toggle-play"]').trigger('click')
    audio.currentTime = 30
    audio.dispatchEvent(new Event('timeupdate'))

    await wrapper.setProps({ url: '' })
    expect(wrapper.find('audio').exists()).toBe(false)
    expect(wrapper.find('[data-action="toggle-play"]').attributes('aria-label')).toBe('Play')
    expect(wrapper.find('[data-action="toggle-play"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-time]').text()).toBe('0:00 / 0:00')
    expect(wrapper.emitted('time').at(-1)).toEqual([0])
  })
})
