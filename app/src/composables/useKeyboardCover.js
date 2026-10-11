/**
 * @module composables/useKeyboardCover
 * @description How much of an element the on-screen keyboard covers.
 *
 * Android makes the page smaller when the keyboard comes up (the viewport's
 * `interactive-widget=resizes-content`), so nothing is covered there. iOS
 * leaves the page the size of the screen and shows less of it, so the bottom
 * of a full-height element sits behind the keyboard: what is visible is the
 * visual viewport, which this measures against.
 */

import { onMounted, onUnmounted, ref } from 'vue'

/**
 * How many pixels at the bottom of the element are behind the keyboard, kept
 * up as the keyboard comes and goes and the page is panned under it.
 *
 * @param {import('vue').Ref<HTMLElement|null>} element
 * @returns {import('vue').Ref<number>}
 */
export function useKeyboardCover(element) {
  const covered = ref(0)

  const measure = () => {
    const viewport = window.visualViewport
    const box = element.value?.getBoundingClientRect()
    covered.value =
      viewport && box
        ? Math.max(0, Math.round(box.bottom - (viewport.offsetTop + viewport.height)))
        : 0
  }

  onMounted(() => {
    measure()
    window.visualViewport?.addEventListener('resize', measure)
    window.visualViewport?.addEventListener('scroll', measure)
    window.addEventListener('resize', measure)
  })

  onUnmounted(() => {
    window.visualViewport?.removeEventListener('resize', measure)
    window.visualViewport?.removeEventListener('scroll', measure)
    window.removeEventListener('resize', measure)
  })

  return covered
}
