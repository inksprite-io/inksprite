import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref } from 'vue'
import { useJumpToBottom } from '@/composables/useJumpToBottom'

describe('useJumpToBottom', () => {
  /** A panel 600 tall over 6000 of content, scrolled wherever a test puts it. */
  let panel
  /** @type {ReturnType<typeof useJumpToBottom>} */
  let jump

  /** The writer scrolls the panel to here. */
  const scrollTo = top => {
    panel.scrollTop = top
    jump.onScroll()
  }

  beforeEach(() => {
    vi.useFakeTimers()
    panel = { scrollTop: 0, scrollHeight: 6000, clientHeight: 600 }
    jump = useJumpToBottom(() => panel)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('is not offered to begin with', () => {
    expect(jump.visible.value).toBe(false)
  })

  it('is offered to somebody far from the end who scrolls towards it', () => {
    scrollTo(1000)
    scrollTo(1100)

    expect(jump.visible.value).toBe(true)
  })

  it('is not offered to somebody scrolling away from the end, however far it is', () => {
    scrollTo(3000)
    scrollTo(2000)

    // They are going back to read something. A button appearing under the
    // pointer as they do is offering to undo what they are in the middle of.
    expect(jump.visible.value).toBe(false)
  })

  it('is taken back when they turn round', () => {
    scrollTo(1000)
    scrollTo(1100)
    scrollTo(1050)

    expect(jump.visible.value).toBe(false)
  })

  it('is not offered near the end, where the wheel is as quick', () => {
    // The end is 5400. Less than a panel's height short of it is near.
    scrollTo(4700)
    scrollTo(4900)

    expect(jump.visible.value).toBe(false)
  })

  it('goes away as they arrive', () => {
    scrollTo(1000)
    scrollTo(1100)
    expect(jump.visible.value).toBe(true)

    scrollTo(5000)

    expect(jump.visible.value).toBe(false)
  })

  it('stays while they keep going and are still far', () => {
    scrollTo(1000)
    scrollTo(1100)
    scrollTo(2500)

    expect(jump.visible.value).toBe(true)
  })

  it('is unmoved by a scroll event that went nowhere', () => {
    scrollTo(1000)
    scrollTo(1100)

    // Something inside the panel scrolled, or the panel was resized.
    jump.onScroll()

    expect(jump.visible.value).toBe(true)
  })

  it('does not count room that is not content as distance to the end', () => {
    // Six hundred of the six thousand is room kept under a summary being
    // written. The content ends at 5400, so from 4300 the end is 500 away.
    const spare = ref(600)
    jump = useJumpToBottom(() => panel, spare)

    scrollTo(4200)
    scrollTo(4300)

    expect(jump.visible.value).toBe(false)
  })

  describe('when the chat moves the panel itself', () => {
    it("is not taken for the writer's scrolling", () => {
      scrollTo(1000)

      jump.hush()
      scrollTo(1400)
      scrollTo(1800)

      expect(jump.visible.value).toBe(false)
    })

    it('takes the offer back, since what it was offered over has moved', () => {
      scrollTo(1000)
      scrollTo(1100)

      jump.hush()

      expect(jump.visible.value).toBe(false)
    })

    it("hears the writer's scrolling again once it has settled", () => {
      jump.hush()
      scrollTo(1000)
      vi.advanceTimersByTime(1100)

      scrollTo(1100)

      expect(jump.visible.value).toBe(true)
    })
  })

  describe('jump', () => {
    // A frame drawn at once, so a jump settles inside the test.
    beforeEach(() => vi.stubGlobal('requestAnimationFrame', callback => callback()))
    afterEach(() => vi.unstubAllGlobals())

    it('goes to the end of the content at once', async () => {
      scrollTo(1000)

      await jump.jump()

      expect(panel.scrollTop).toBe(5400)
    })

    it('stops short of room that is not content', async () => {
      jump = useJumpToBottom(() => panel, ref(600))

      await jump.jump()

      expect(panel.scrollTop).toBe(4800)
    })

    it('goes again when the end moves as the turns passed are laid out', async () => {
      // The turns on the way stood at a guess, and come out taller.
      let frames = 0
      vi.stubGlobal('requestAnimationFrame', callback => {
        if (++frames === 2) panel.scrollHeight = 7000
        callback()
      })

      await jump.jump()

      expect(panel.scrollTop).toBe(6400)
    })

    it('goes again when the panel gets shorter under it', async () => {
      let frames = 0
      vi.stubGlobal('requestAnimationFrame', callback => {
        if (++frames === 2) panel.clientHeight = 560
        callback()
      })

      await jump.jump()

      expect(panel.scrollTop).toBe(5440)
    })

    it('takes the offer away, and does not make it again on the way down', async () => {
      scrollTo(1000)
      scrollTo(1100)

      await jump.jump()
      scrollTo(2000)
      scrollTo(3000)

      expect(jump.visible.value).toBe(false)
    })
  })

  describe('far', () => {
    it('is the end being more than a panel below what can be seen', () => {
      // The end is 5400, and the panel is 600 tall.
      panel.scrollTop = 4799
      expect(jump.far()).toBe(true)

      panel.scrollTop = 4800
      expect(jump.far()).toBe(false)
    })

    it('says so whichever way they were heading, and whoever moved the panel', () => {
      scrollTo(3000)
      scrollTo(2000)
      jump.hush()

      expect(jump.visible.value).toBe(false)
      expect(jump.far()).toBe(true)
    })

    it('does not count room that is not content', () => {
      jump = useJumpToBottom(() => panel, ref(600))

      panel.scrollTop = 4300
      expect(jump.far()).toBe(false)
    })
  })

  it('does nothing before there is a panel', async () => {
    jump = useJumpToBottom(() => null)

    expect(() => jump.onScroll()).not.toThrow()
    await expect(jump.jump()).resolves.toBeUndefined()
    expect(jump.visible.value).toBe(false)
    expect(jump.far()).toBe(false)
  })
})
