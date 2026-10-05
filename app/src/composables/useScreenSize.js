import { ref, onMounted, onUnmounted } from 'vue'

/**
 * Composable to detect screen size and check if it matches Tailwind's md breakpoint
 * @returns {{ isMobile: import('vue').Ref<boolean> }}
 */
export function useScreenSize() {
  const isMobile = ref(false)

  const checkScreenSize = () => {
    // Tailwind's md breakpoint is 768px
    isMobile.value = window.innerWidth < 768
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
  }
}
