/**
 * Apply the specified theme to the document.
 * @param {'light' | 'dark' | 'system'} themeValue - The theme to apply (e.g., "light", "dark", "system").
 */
export const applyTheme = themeValue => {
  const setDark = (/** @type {boolean} */ on) => {
    const root = document.documentElement
    root.classList.toggle('inksprite-dark', !!on) // for PrimeVue
    root.classList.toggle('dark', !!on) // for Tailwind
  }

  if (themeValue === 'system') {
    setDark(window.matchMedia('(prefers-color-scheme: dark)').matches)
  } else if (themeValue === 'dark') {
    setDark(true)
  } else {
    setDark(false)
  }
}
