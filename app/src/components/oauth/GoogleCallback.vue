<template>
  <div class="callback-container" data-google-callback>
    <div class="callback-content">
      <div class="success-icon">✓</div>
      <h2>Back to inksprite</h2>
      <p class="close-message">You can close this window.</p>
    </div>
  </div>
</template>

<script setup>
/**
 * Where Google sends the Drive import's popup back to, with a token and the
 * picked files' ids in the fragment: take them out of the address, hand them
 * to the window that asked, and close. See drive/signIn.js.
 */

import { onMounted } from 'vue'
import { relayReturn } from '@/drive/signIn.js'

onMounted(() => {
  const fragment = window.location.hash.slice(1)
  // The token is in the address: out of it, and out of the history, first.
  window.history.replaceState(null, '', window.location.pathname)
  relayReturn(fragment)
  window.close()
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

.success-icon {
  font-size: 3rem;
  margin-bottom: 1rem;
  color: #10b981;
}

.close-message {
  margin-top: 1rem;
  font-size: 0.875rem;
  color: #6b7280;
}
</style>
