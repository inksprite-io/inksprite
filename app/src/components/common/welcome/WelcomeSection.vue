<template>
  <div class="flex flex-col gap-5 px-2 pt-2 pb-1 text-sm text-surface-700 dark:text-surface-200">
    <section class="flex flex-col gap-2">
      <p>
        inksprite is a writing app that runs locally in your browser or as a standalone desktop
        application. You do not need to make an account to use inksprite. Your work stays on your
        device.
      </p>
      <p>
        See the
        <a :href="GUIDE_URL" target="_blank" rel="noopener noreferrer" :class="LINK"
          >Getting Started guide</a
        >
        for a detailed walkthrough.
      </p>
      <p>
        inksprite is still in development. Please report bugs and issues on
        <a :href="ISSUES_URL" target="_blank" rel="noopener noreferrer" :class="LINK">GitHub</a>.
      </p>
    </section>

    <section class="flex flex-col gap-2">
      <h3 :class="HEADING">AI tools</h3>
      <p>You can use the built-in AI tools to:</p>
      <ul class="list-disc pl-5 flex flex-col gap-0.5">
        <li>Write and edit documents</li>
        <li>Research and brainstorm</li>
        <li>Generate audio narrations</li>
      </ul>
      <p v-if="!aiEnabled" data-ai-off>
        The AI tools are off. You can
        <button type="button" :class="LINK" @click="setAiEnabled(true)">turn them on</button>
        now or later in Settings.
      </p>
      <p v-else-if="!aiReady" data-connect-ai>
        To use these tools,
        <button type="button" :class="LINK" @click="$emit('show', 'ai')">
          connect an AI provider
        </button>
        now or later in Settings. If you'd rather write without them, you can
        <button type="button" :class="LINK" @click="setAiEnabled(false)">turn them off</button>.
      </p>
    </section>

    <section v-if="advice" class="flex flex-col gap-2">
      <h3 :class="HEADING">Browser storage</h3>
      <div data-storage-warning class="flex flex-col gap-2">
        <p>
          <strong class="text-red-600 dark:text-red-400"
            >Your work is stored only in this browser.</strong
          >
          If this site's data is cleared, it's gone.
        </p>
        <p>You can back up your data from Settings › System › Data.</p>
        <p v-if="advice.desktopApp">
          Alternatively, you can use the standalone
          <a :href="DESKTOP_URL" target="_blank" rel="noopener noreferrer" :class="LINK"
            >desktop app</a
          >.
        </p>
        <p v-if="advice.clearsAfterAWeek" data-safari-warning>
          <strong class="text-red-600 dark:text-red-400"
            >Safari clears a site's data after a week without a visit.</strong
          >
          <template v-if="advice.homeScreen">
            To keep it, add inksprite to your
            <a :href="HOME_SCREEN_URL" target="_blank" rel="noopener noreferrer" :class="LINK"
              >Home Screen</a
            >.
          </template>
        </p>
      </div>
    </section>
  </div>
</template>

<script setup>
/**
 * The welcome's first section: what inksprite is, what its AI can do, where
 * to connect it and a link to switch it off or on again, and where the work
 * is kept and what can take it away.
 */
import { isDesktop } from '@/platform/desktop.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { storageAdvice } from '@/platform/persistence.js'
import { DESKTOP_URL, GUIDE_URL, HEADING, ISSUES_URL, LINK } from './links.js'

defineProps({
  /** Whether the AI is set up already, so there is nothing to connect. */
  aiReady: { type: Boolean, default: false },
})

defineEmits({
  /** Open another of the welcome's sections. */
  show: (/** @type {string} */ id) => typeof id === 'string',
})

const { aiEnabled, setAiEnabled } = useApplicationState()

const HOME_SCREEN_URL =
  'https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios#iph4f9a47bbc'

/** What the writer is told about keeping their work; nothing in the desktop app, which keeps it on disk. */
const advice = isDesktop() ? null : storageAdvice()
</script>
