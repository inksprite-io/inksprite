<template>
  <div class="callback-container">
    <div class="callback-content">
      <template v-if="status === 'processing'">
        <div class="spinner"></div>
        <h2>Connecting to OpenRouter...</h2>
        <p>Please wait while we complete your connection.</p>
      </template>

      <template v-else-if="status === 'success'">
        <div class="success-icon">✓</div>
        <h2>Connected Successfully!</h2>
        <p>Your OpenRouter account has been connected.</p>
        <p class="close-message">You can now close this tab and return to inksprite.</p>
      </template>

      <template v-else-if="status === 'error'">
        <div class="error-icon">✗</div>
        <h2>Connection Failed</h2>
        <p class="error-message">{{ errorMessage }}</p>
        <p class="close-message">You can close this tab and try again.</p>
      </template>
    </div>
  </div>
</template>

<script setup>
/* global URLSearchParams */

import { ref, onMounted } from 'vue'
import { useOpenRouterSignIn } from '@/composables/useOpenRouterSignIn'

const status = ref('processing')
const errorMessage = ref('')

const openRouter = useOpenRouterSignIn()

onMounted(async () => {
  try {
    const providerId = await openRouter.finish(new URLSearchParams(window.location.search))

    status.value = 'success'

    // Notify the opener tab that OAuth completed successfully
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: 'oauth-success', provider: 'openrouter', providerId },
        window.location.origin
      )
    }

    window.close()
  } catch (error) {
    console.error('OAuth callback error:', error)
    status.value = 'error'
    errorMessage.value = error.message || 'An unexpected error occurred'
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
  0% {
    transform: rotate(0deg);
  }
  100% {
    transform: rotate(360deg);
  }
}

.success-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: #10b981;
  color: white;
  font-size: 3rem;
  line-height: 80px;
  margin: 0 auto 1.5rem;
  animation: scaleIn 0.3s ease-out;
}

.error-icon {
  width: 80px;
  height: 80px;
  border-radius: 50%;
  background: #ef4444;
  color: white;
  font-size: 3rem;
  line-height: 80px;
  margin: 0 auto 1.5rem;
  animation: scaleIn 0.3s ease-out;
}

@keyframes scaleIn {
  0% {
    transform: scale(0);
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    transform: scale(1);
  }
}

h2 {
  color: #1f2937;
  font-size: 1.75rem;
  margin-bottom: 1rem;
  font-weight: 600;
}

p {
  color: #6b7280;
  font-size: 1rem;
  line-height: 1.6;
  margin-bottom: 0.5rem;
}

.error-message {
  color: #ef4444;
  font-weight: 500;
  margin-top: 1rem;
  padding: 1rem;
  background: #fee2e2;
  border-radius: 0.5rem;
}

.close-message {
  margin-top: 1.5rem;
  color: #9ca3af;
  font-size: 0.875rem;
  font-style: italic;
}
</style>
