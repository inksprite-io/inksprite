import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { PRICES_PATH, priceListResponse } from './src/ai/prices.js'

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

/**
 * vuedraggable's bundle finds the global object with `new Function`, which
 * the page's Content-Security-Policy (index.html) refuses. It falls back to
 * `window`, so nothing breaks, but every load logs the refusal as an error.
 * `globalThis` is what it means.
 * @type {import('vite').Plugin}
 */
const draggableWithoutEval = {
  name: 'draggable-without-eval',
  transform(code, id) {
    if (!id.includes('vuedraggable')) return null
    return code.replace(/new Function\(\s*["']return this["']\s*\)\(\)/g, 'globalThis')
  },
}

/** Whether this build takes the service worker away (below). */
let removeServiceWorker = false

/**
 * The service worker (`sw.js`), written by Workbox from the build once it is
 * out: it keeps the build's files, so that the app opens offline and a tab
 * left open across a deploy can still load the parts it hasn't yet. Kept are
 * the page, the scripts and the styles, and the one font format browsers
 * load; not the pictures and the manifest under static/, which only the
 * browser itself asks for, and not oauth/, which only authorization servers
 * read. Harper's WebAssembly (16 MB) is kept when the spelling checker first
 * loads it, not up front. A new build waits until the page reloads into it
 * (`platform/serviceWorker.js`). The desktop app and the dev server have none.
 *
 * Built with VITE_REMOVE_SERVICE_WORKER=true, `sw.js` is `sw-remove.js`
 * instead, which takes the writers' worker away, and the page registers none.
 * @type {import('vite').Plugin}
 */
const serviceWorker = {
  name: 'service-worker',
  apply: 'build',
  configResolved(config) {
    removeServiceWorker = config.env.VITE_REMOVE_SERVICE_WORKER === 'true'
  },
  async writeBundle({ dir }) {
    if (!dir) return
    if (removeServiceWorker) {
      await copyFile(new URL('./sw-remove.js', import.meta.url), `${dir}/sw.js`)
      return
    }
    // Only here, so that the dev server never loads Workbox.
    const { generateSW } = await import('workbox-build')
    const { warnings } = await generateSW({
      globDirectory: dir,
      globPatterns: ['index.html', 'assets/**/*.{js,mjs,css,woff2}'],
      // The app's main chunk is near 3 MB, over Workbox's 2 MB default.
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      // Their names change with their contents.
      dontCacheBustURLsMatching: /^assets\//,
      swDest: `${dir}/sw.js`,
      navigateFallback: 'index.html',
      navigateFallbackDenylist: [/^\/oauth\//],
      runtimeCaching: [
        {
          urlPattern: /\/assets\/[^/]+\.wasm$/,
          handler: 'CacheFirst',
          options: { cacheName: 'webassembly', expiration: { maxEntries: 4 } },
        },
      ],
      cleanupOutdatedCaches: true,
      clientsClaim: true,
      skipWaiting: false,
      inlineWorkboxRuntime: true,
      sourcemap: false,
    })
    for (const warning of warnings) this.warn(warning)
  },
}

/**
 * The names the dev server answers to besides localhost: whoever runs it
 * says which, as `DEV_ALLOWED_HOSTS` in app/.env.local, a comma between
 * them, and none is written here. The test server's container is given the
 * file's values as it is made; a dev server run by hand reads the file.
 *
 * @returns {string[]}
 */
function allowedHosts() {
  const here = fileURLToPath(new URL('.', import.meta.url))
  const named =
    process.env.DEV_ALLOWED_HOSTS ?? loadEnv('development', here, 'DEV_').DEV_ALLOWED_HOSTS ?? ''
  return named
    .split(',')
    .map(host => host.trim())
    .filter(Boolean)
}

/**
 * The site's price list (api/prices.js), answered by the dev server as the
 * site answers it, so a model's price shows here as it does there.
 * @type {import('vite').Plugin}
 */
const priceList = {
  name: 'inksprite-price-list',
  configureServer(server) {
    server.middlewares.use(PRICES_PATH, async (_request, response) => {
      const answer = await priceListResponse()
      response.statusCode = answer.status
      answer.headers.forEach((value, name) => response.setHeader(name, value))
      response.end(await answer.text())
    })
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss(), draggableWithoutEval, serviceWorker, priceList],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion()),
  },
  server: {
    port: 8002,
    host: '127.0.0.1',
    allowedHosts: allowedHosts(),
    // The desktop app's main process, and its packages, which are large.
    watch: { ignored: ['**/electron/**'] },
  },
  // Harper, the spelling checker, finds its WebAssembly next to its own
  // module (`new URL(…, import.meta.url)`), which bundling it beforehand
  // would move away from. Its worker is a module, and built as one.
  optimizeDeps: { exclude: ['harper.js'] },
  worker: { format: 'es' },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
    },
  },
})
