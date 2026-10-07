import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // Not the app's own .env files: a test sees the same environment on every
  // machine, whatever a developer has put in .env.local. Nothing is kept here.
  envDir: './test',
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: './test/setup.js',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'test/', '*.config.js', 'docs/', 'dist/'],
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
    },
  },
})
