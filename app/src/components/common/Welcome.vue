<template>
  <Dialog
    :visible="visible"
    header="Welcome"
    modal
    :closable="false"
    :draggable="false"
    class="w-[min(60rem,95vw)] h-[min(44rem,90vh)]"
    :pt="{
      content: { class: 'flex-1 min-h-0 !p-0 overflow-hidden' },
      footer: { class: 'border-t border-surface-200 dark:border-surface-700 !pt-3 !pb-3' },
    }"
    @update:visible="$emit('update:visible', $event)"
  >
    <SectionLayout
      v-model="activeId"
      :sections="sections"
      label="Welcome sections"
      class="h-full"
    />
    <template #footer>
      <div class="flex items-center justify-end gap-4">
        <p class="text-xs text-surface-500 dark:text-surface-400" data-terms-agreement>
          By using inksprite, you agree to our
          <button type="button" :class="LINK" @click="show('terms')">Terms of Service</button>.
        </p>
        <Button label="Start writing" size="small" class="shrink-0" @click="handleClose" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import SectionLayout from '@/components/common/SectionLayout.vue'
import WelcomeSection from './welcome/WelcomeSection.vue'
import MarkdownSection from './welcome/MarkdownSection.vue'
import MagicBookAltIcon from '@/components/icons/MagicBookAltIcon.vue'
import BooksIcon from '@/components/icons/BooksIcon.vue'
import CommentIcon from '@/components/icons/CommentIcon.vue'
import BookIcon from '@/components/icons/BookIcon.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { LINK } from './welcome/markdown.js'
import gettingStarted from './welcome/getting-started.md?raw'
import feedback from './welcome/feedback.md?raw'
import terms from './welcome/terms.md?raw'

/**
 * What a first visit opens on, laid out as the settings are: what inksprite
 * is and where it keeps the work, where the guide is, where to report a bug
 * or say what's wanted, and the terms, which the footer says using it agrees
 * to. The AI is set up from the chat, the first time it is used.
 *
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

const activeId = ref('welcome')

/** @param {string} id */
const show = id => (activeId.value = id)

const sections = [
  {
    id: 'welcome',
    label: 'Welcome',
    title: 'Welcome to inksprite',
    icon: MagicBookAltIcon,
    component: WelcomeSection,
  },
  {
    id: 'getting-started',
    label: 'Getting started',
    icon: BooksIcon,
    component: MarkdownSection,
    props: { source: gettingStarted },
  },
  {
    id: 'feedback',
    label: 'Feedback',
    icon: CommentIcon,
    component: MarkdownSection,
    props: { source: feedback },
  },
  {
    id: 'terms',
    label: 'Terms of Service',
    icon: BookIcon,
    component: MarkdownSection,
    // The docs' About page has them too, and a test fails when the two differ.
    props: { source: terms },
  },
]

/**
 * Handle close button click
 */
function handleClose() {
  appState.setShowWelcomeDialog(false)
}
</script>
