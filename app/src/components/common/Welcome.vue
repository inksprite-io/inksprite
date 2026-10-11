<template>
  <Dialog
    :visible="visible"
    class="w-screen md:w-[50rem]"
    modal
    :closable="false"
    :draggable="false"
    :header="'Welcome to inksprite!'"
    :pt="{
      root: { class: 'shadow-xl' },
      content: { class: 'h-full w-full bg-surface-50 dark:bg-surface-900' },
      header: { class: 'text-surface-700 dark:text-surface-200 text-2xl! font-semibold' },
    }"
    @update:visible="$emit('update:visible', $event)"
  >
    <div>
      <div
        class="flex flex-col gap-3 text-surface-700 font-medium dark:text-surface-400 min-h-[300px]"
      >
        <div class="flex gap-4 items-center justify-between">
          <div class="flex-1 max-w-[32rem] flex flex-col">
            <p>No account needed. Create a project and start writing.</p>
          </div>
          <img
            src="/static/icons/magic-books-light.svg"
            alt="Magic books"
            class="w-20 h-20 flex-shrink-0 opacity-60 dark:hidden"
          />
          <img
            src="/static/icons/magic-books-dark.svg"
            alt="Magic books"
            class="w-20 h-20 flex-shrink-0 opacity-60 hidden dark:block"
          />
        </div>

        <div class="flex flex-col gap-4">
          <template v-if="advice">
            <h3 class="text-md font-semibold text-surface-500 dark:text-surface-300">
              Browser storage
            </h3>
            <div
              data-storage-warning
              class="flex flex-col gap-2 text-surface-700 dark:text-surface-400"
            >
              <p>
                <strong class="text-red-600 dark:text-red-400">Warning:</strong> your work is stored
                only in this browser. If this site's data is cleared, it's gone. Back up from
                Settings › System.
              </p>
              <p>
                <template v-if="advice.desktopApp">
                  Or use the
                  <a
                    href="https://github.com/inksprite-io/inksprite/releases/latest"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-primary-600 dark:text-primary-400 hover:underline font-medium"
                    >desktop app</a
                  >.
                </template>
              </p>
              <p v-if="advice.clearsAfterAWeek" data-safari-warning>
                <strong class="text-red-600 dark:text-red-400"
                  >Safari clears a site's data after a week without a visit.</strong
                >
                <template v-if="advice.homeScreen">
                  To keep it, add inksprite to your
                  <a
                    href="https://support.apple.com/guide/iphone/bookmark-a-website-iph42ab2f3a7/ios#iph4f9a47bbc"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-primary-600 dark:text-primary-400 hover:underline font-medium"
                    >Home Screen</a
                  >.
                </template>
              </p>
            </div>
          </template>

          <h3 class="text-md font-semibold text-surface-500 dark:text-surface-300">Help</h3>
          <div class="flex flex-col text-surface-700 dark:text-surface-400 gap-3">
            <p>
              Report bugs and ask questions on
              <a
                href="https://github.com/inksprite-io/inksprite/issues"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary-600 dark:text-primary-400 hover:underline font-medium"
                >GitHub</a
              >.
            </p>
          </div>

          <h3 class="text-md font-semibold text-surface-500 dark:text-surface-300">Open beta</h3>
          <div class="flex flex-col text-surface-700 dark:text-surface-400 gap-3">
            <p>inksprite is still in development, so expect bugs.</p>
            <h3 class="text-md font-semibold text-surface-500 dark:text-surface-300">Legal</h3>
            <p>
              By using inksprite, you agree to our
              <a
                href="https://docs.inksprite.io/about"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary-600 dark:text-primary-400 hover:underline font-medium"
                >Terms of Service</a
              >.
            </p>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <div class="flex justify-end">
        <Button label="Start writing" @click="handleClose" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import { useApplicationState } from '@/composables/useApplicationState'
import { isDesktop } from '@/platform/desktop.js'
import { storageAdvice } from '@/platform/persistence.js'

/**
 * @typedef {Object} Props
 * @property {boolean} visible - Whether the dialog is visible
 */
defineProps({
  visible: {
    type: Boolean,
    required: true,
  },
})

defineEmits(['update:visible'])

const appState = useApplicationState()

/** What the writer is told about keeping their work; nothing in the desktop app, which keeps it on disk. */
const advice = isDesktop() ? null : storageAdvice()

/**
 * Handle close button click
 */
function handleClose() {
  appState.setShowWelcomeDialog(false)
}
</script>
