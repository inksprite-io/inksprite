import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

/**
 * The version Settings › About shows: a release build's from its tag
 * (.github/workflows/release.yml), any other build's the newest release in
 * the changelog. The test server's container has no changelog, so it shows
 * none.
 * @returns {string}
 */
function appVersion() {
  if (process.env.VITE_APP_VERSION) return process.env.VITE_APP_VERSION
  try {
    const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
    return changelog.match(/^## v(\S+)/m)?.[1] ?? ''
  } catch {
    return ''
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion()),
  },
  server: {
    port: 8002,
    host: '127.0.0.1',
    allowedHosts: ['inksprite.shimmerspire.io'],
    // The desktop app's main process, and its packages, which are large.
    watch: { ignored: ['**/electron/**'] },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
    },
  },
})
