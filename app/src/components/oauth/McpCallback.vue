<template>
  <div class="callback-container" data-mcp-callback>
    <div class="callback-content">
      <template v-if="status === 'processing'">
        <div class="spinner"></div>
        <h2>Signing in…</h2>
        <p>Finishing the sign-in to your server.</p>
      </template>

      <template v-else-if="status === 'success'">
        <div class="success-icon">✓</div>
        <h2>Signed in</h2>
        <p class="close-message">You can close this tab and go back to inksprite.</p>
      </template>

      <template v-else>
        <div class="error-icon">✗</div>
        <h2>Sign-in didn’t finish</h2>
        <p class="error-message">{{ errorMessage }}</p>
        <p class="close-message">You can close this tab and try again from Settings.</p>
      </template>
    </div>
  </div>
</template>

<script setup>
/* global URLSearchParams, BroadcastChannel */

/**
 * Where an MCP server's authorization server sends the writer back: trade the
 * code for tokens, tell the tab that started the sign-in, and close. See
 * mcp/auth.js.
 */

import { onMounted, ref } from 'vue'
import { finishSignIn, SIGN_IN_CHANNEL } from '@/mcp/auth.js'

/** @type {import('vue').Ref<'processing'|'success'|'error'>} */
const status = ref('processing')
const errorMessage = ref('')

/** @param {Record<string, string>} message */
function announce(message) {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(SIGN_IN_CHANNEL)
  channel.postMessage(message)
  channel.close()
}

onMounted(async () => {
  try {
    const { url } = await finishSignIn(new URLSearchParams(window.location.search))
    status.value = 'success'
    announce({ url })
    window.close()
  } catch (error) {
    console.error('MCP sign-in failed:', error)
    status.value = 'error'
    errorMessage.value = error?.message || 'Something went wrong.'
    announce({ ...(error?.url ? { url: error.url } : {}), error: errorMessage.value })
  }
})
</script>

<style scoped>
.callback-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  padding: 2rem;
}

.callback-content {
  background: white;
  color: #1f2937;
  border-radius: 1rem;
  padding: 3rem;
  max-width: 500px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.spinner {
  width: 50px;
  height: 50px;
  border: 4px solid #f3f3f3;
  border-top: 4px solid #667eea;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin: 0 auto 1.5rem;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.success-icon,
.error-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
}

.success-icon {
  color: #10b981;
}

.error-icon {
  color: #ef4444;
}

.error-message {
  color: #ef4444;
}

.close-message {
  margin-top: 1rem;
  font-size: 0.875rem;
  color: #6b7280;
}
</style>
