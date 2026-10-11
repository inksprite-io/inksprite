import { ref, onMounted, onUnmounted } from 'vue'

/**
 * The window width, in pixels, below which the desktop layout's sidebar,
 * editor and chat do not fit side by side: the outline is cut to a few
 * letters and the chat to a column. See shownLayout in the writer's layout.
 */
export const NARROW_WIDTH = 1100

/**
 * Composable to detect screen size and check if it matches Tailwind's md breakpoint
 * @returns {{ isMobile: import('vue').Ref<boolean>, isNarrow: import('vue').Ref<boolean> }}
 */
export function useScreenSize() {
  const isMobile = ref(false)
  // Wide enough for the desktop layout, but not for all three of its panels.
  const isNarrow = ref(false)

  const checkScreenSize = () => {
    // Tailwind's md breakpoint is 768px
    isMobile.value = window.innerWidth < 768
    isNarrow.value = window.innerWidth < NARROW_WIDTH
  }

  onMounted(() => {
    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)
  })

  onUnmounted(() => {
    window.removeEventListener('resize', checkScreenSize)
  })

  return {
    isMobile,
    isNarrow,
  }
}
