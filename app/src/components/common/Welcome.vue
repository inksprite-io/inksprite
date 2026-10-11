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
            <p>
              Welcome! No need to make an account or login. Just create a project and start writing.
            </p>
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
              Browser Storage
            </h3>
            <div
              data-storage-warning
              class="flex flex-col gap-2 text-surface-700 dark:text-surface-400"
            >
              <p>
                <strong class="text-red-600 dark:text-red-400">Warning:</strong> all data is stored
                in your browser. If this site's data is deleted, your work will be lost. Back up
                regularly from Settings › System.
              </p>
              <p>
                <template v-if="advice.desktopApp">
                  You can also try the
                  <a
                    href="https://github.com/inksprite-io/inksprite/releases/latest"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-primary-600 dark:text-primary-400 hover:underline font-medium"
                    >desktop version</a
                  >.
                </template>
              </p>
              <p v-if="advice.clearsAfterAWeek" data-safari-warning>
                <strong class="text-red-600 dark:text-red-400"
                  >Safari automatically clears site data after a week of inactivity.</strong
                >
                <template v-if="advice.homeScreen">
                  You can avoid this by adding inksprite to your
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

          <h3 class="text-md font-semibold text-surface-500 dark:text-surface-300">Getting Help</h3>
          <div class="flex flex-col text-surface-700 dark:text-surface-400 gap-3">
            <p>
              Report bugs and ask questions in the
              <a
                href="https://github.com/inksprite-io/inksprite/issues"
                target="_blank"
                rel="noopener noreferrer"
                class="text-primary-600 dark:text-primary-400 hover:underline font-medium"
                >GitHub issues</a
              >.
            </p>
          </div>

          <h3 class="text-md font-semibold text-surface-500 dark:text-surface-300">Open Beta</h3>
          <div class="flex flex-col text-surface-700 dark:text-surface-400 gap-3">
            <p>
              inksprite is still in development, so you should expect bugs. Let us know if you run
              into any issues!
            </p>
            <h3 class="text-md font-semibold text-surface-500 dark:text-surface-300">
              Legal Stuff
            </h3>
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
        <Button label="Start Writing!" @click="handleClose" />
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
