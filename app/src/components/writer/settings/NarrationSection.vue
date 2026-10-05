<template>
  <div class="flex flex-col">
    <div class="flex flex-col gap-1 px-2 pt-1 pb-2">
      <label class="text-xs font-medium text-surface-700 dark:text-surface-200" for="tts-endpoint">
        Speech server
      </label>
      <InputText
        id="tts-endpoint"
        :model-value="connection.endpoint"
        placeholder="http://localhost:8880/v1"
        class="w-full dark:!bg-surface-900"
        size="small"
        data-tts-endpoint
        @update:model-value="setNarration({ endpoint: String($event ?? '').trim() })"
      />
      <p class="text-xs text-surface-500 dark:text-surface-400">
        An OpenAI-compatible text-to-speech endpoint. Kokoro-FastAPI answers at this address when
        run with its docker-compose, and is what the voices and mixes are written for.
      </p>
    </div>

    <div class="flex flex-col gap-1 px-2 pt-1 pb-2">
      <label class="text-xs font-medium text-surface-700 dark:text-surface-200" for="tts-key">
        API key (optional)
      </label>
      <InputText
        id="tts-key"
        :model-value="connection.apiKey"
        type="password"
        placeholder="Not needed for a local server"
        class="w-full dark:!bg-surface-900"
        size="small"
        data-tts-key
        @update:model-value="setNarration({ apiKey: String($event ?? '').trim() })"
      />
    </div>

    <div class="flex flex-col gap-1 px-2 pt-1 pb-2">
      <label class="text-xs font-medium text-surface-700 dark:text-surface-200" for="tts-model">
        Model
      </label>
      <InputText
        id="tts-model"
        :model-value="connection.model"
        placeholder="kokoro"
        class="w-full dark:!bg-surface-900"
        size="small"
        data-tts-model
        @update:model-value="setNarration({ model: String($event ?? '').trim() })"
      />
      <p class="text-xs text-surface-500 dark:text-surface-400">
        <code>kokoro</code> for Kokoro-FastAPI; <code>tts-1</code> for OpenAI.
      </p>
    </div>

    <div class="flex items-center gap-2 px-2 pt-1 pb-2">
      <Button
        type="button"
        label="Test connection"
        icon="pi pi-link"
        size="small"
        severity="secondary"
        :loading="testing"
        :disabled="!connection.endpoint"
        data-action="test-connection"
        @click="test"
      />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { useApplicationState } from '@/composables/useApplicationState'
import { useToast } from '@/composables/useToast'
import { describeFailure, listVoices } from '@/tts/client.js'

/**
 * Where documents are read aloud. App-wide, like the theme: a speech server
 * is something the machine has, not something a project has.
 */

const { narration: connection, setNarration } = useApplicationState()
const toast = useToast()
const testing = ref(false)

/**
 * Ask the server what it offers. A server that lists voices is there and
 * answering; one that lists none may still speak, and is told apart from
 * one that could not be reached at all.
 */
const test = async () => {
  testing.value = true
  try {
    const voices = await listVoices(connection.value)
    if (voices.length > 0) toast.success(`Connected. ${voices.length} voices available.`)
    else toast.success('Connected. The server lists no voices; type them by name.')
  } catch (error) {
    toast.error(describeFailure(error, connection.value), { title: 'Connection failed' })
  } finally {
    testing.value = false
  }
}
</script>
