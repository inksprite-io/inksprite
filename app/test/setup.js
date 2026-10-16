// Global test setup
import { afterEach } from 'vitest'
import { enableAutoUnmount } from '@vue/test-utils'

// Every component a test mounts is unmounted when it ends. One left mounted
// re-renders in a later test when a setting it reads changes, and in doing so
// makes its own Pinia the active one again, so the later test's stores are
// not the ones its components write to.
enableAutoUnmount(afterEach)
