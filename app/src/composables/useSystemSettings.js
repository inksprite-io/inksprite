import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useApplicationState } from './useApplicationState.js'

/**
 * The page's background in each theme (`main`'s surface-0 and surface-900),
 * which the installed app's title bar takes on.
 */
export const TITLE_BAR_COLORS = { light: '#ffffff', dark: '#18181b' }

/**
 * Apply the specified theme to the document.
 * @param {'light' | 'dark' | 'system'} themeValue - The theme to apply (e.g., "light", "dark", "system").
 */
export const applyTheme = themeValue => {
  const setDark = (/** @type {boolean} */ on) => {
    const root = document.documentElement
    root.classList.toggle('inksprite-dark', !!on) // for PrimeVue
    root.classList.toggle('dark', !!on) // for Tailwind
    // index.html has one for each of the system's themes; both take the
    // app's, whatever the system's is.
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.setAttribute('content', on ? TITLE_BAR_COLORS.dark : TITLE_BAR_COLORS.light)
    }
  }

  if (themeValue === 'system') {
    setDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
  } else if (themeValue === 'dark') {
    setDark(true)
  } else {
    setDark(false)
  }
}

/**
 * Keep the page in the writer's theme: as soon as it is chosen, and, while it
 * is System, whenever the system's changes. Once, in the app's root component.
 */
export function useTheme() {
  const { theme } = useApplicationState()
  watch(theme, applyTheme, { immediate: true })

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)')
  const followSystem = () => {
    if (theme.value === 'system') applyTheme('system')
  }
  onMounted(() => systemDark.addEventListener('change', followSystem))
  onBeforeUnmount(() => systemDark.removeEventListener('change', followSystem))
}
