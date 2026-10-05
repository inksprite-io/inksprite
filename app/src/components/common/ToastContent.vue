<template>
  <!-- What PrimeVue draws, under its own class names so the theme styles it
       the same — and, for a toast with an action, the action under it. -->
  <component :is="icon" class="p-toast-message-icon" />
  <div class="p-toast-message-text min-w-0" :data-p="message.severity">
    <!-- Only when there is one. An empty title still takes the gap under it,
         and a toast that is all detail then sits below its own icon. -->
    <span v-if="message.summary" class="p-toast-summary" :data-p="message.severity">
      {{ message.summary }}
    </span>
    <div v-if="message.detail" class="p-toast-detail" :data-p="message.severity">
      {{ message.detail }}
    </div>

    <template v-if="message.action">
      <!-- Links in the toast's own colour rather than buttons in the app's:
           the toast is already the thing asking. -->
      <div class="flex items-center gap-4 text-sm">
        <button
          v-if="changes.length"
          type="button"
          class="flex items-center gap-1 opacity-75 hover:opacity-100 cursor-pointer"
          :aria-expanded="open"
          data-action="toast-changes"
          @click="toggleChanges"
        >
          {{ open ? 'Hide changes' : 'What changed?' }}
          <i :class="['pi text-xs', open ? 'pi-chevron-up' : 'pi-chevron-down']" />
        </button>
        <!-- At the far end whether or not there are changes to look at. -->
        <button
          type="button"
          class="ml-auto font-semibold hover:underline cursor-pointer"
          data-action="toast-action"
          @click="act"
        >
          {{ message.action.label }}
        </button>
      </div>

      <!-- The lines that changed, a run per place: what went, then what came.
           Tinted over the toast rather than a panel laid on it. -->
      <div
        v-if="open"
        class="max-h-60 overflow-auto rounded-md py-1 bg-white/50 dark:bg-black/20 font-mono text-xs leading-5"
        data-changes
      >
        <div
          v-for="(change, at) in changes"
          :key="at"
          :class="{ 'mt-1 pt-1 border-t border-black/10 dark:border-white/10': at > 0 }"
        >
          <div
            v-for="(line, n) in change.removed"
            :key="`-${n}`"
            class="px-2 whitespace-pre-wrap break-words bg-red-500/10 text-red-700 dark:text-red-300"
            data-removed
          >
            - {{ line }}
          </div>
          <div
            v-for="(line, n) in change.added"
            :key="`+${n}`"
            class="px-2 whitespace-pre-wrap break-words bg-green-500/10 text-green-700 dark:text-green-300"
            data-added
          >
            + {{ line }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import CheckIcon from '@primevue/icons/check'
import ExclamationTriangleIcon from '@primevue/icons/exclamationtriangle'
import InfoCircleIcon from '@primevue/icons/infocircle'
import TimesCircleIcon from '@primevue/icons/timescircle'
import { useToast } from 'primevue/usetoast'

/**
 * One toast's content. Anything a toast can say, and for one made with
 * `useToast().action`, the button that does something about it and — where
 * what it is about is a change to some text — the lines that changed, folded
 * away until asked for.
 *
 * @typedef {Object} Props
 * @property {import('primevue/toast').ToastMessageOptions & {
 *   action?: {label: string, command: () => void},
 *   changes?: import('@/utils/lineDiff.js').LineChange[],
 * }} message
 */
const props = defineProps({
  message: { type: Object, required: true },
})

const emit = defineEmits(['keep'])

const toast = useToast()

/** The icon PrimeVue gives each severity; none for the rest, as it does. */
const icon = computed(
  () =>
    ({
      info: InfoCircleIcon,
      success: CheckIcon,
      warn: ExclamationTriangleIcon,
      error: TimesCircleIcon,
    })[props.message.severity] || 'span'
)

const changes = computed(() => props.message.changes || [])

/** Whether the changes are showing. Each toast its own. */
const open = ref(false)

/**
 * Show the changes, or fold them away. A toast whose changes have been
 * opened is being read, so it stays until it is closed — it is not going to
 * be read in the time a notice gets.
 */
const toggleChanges = () => {
  open.value = !open.value
  if (open.value) emit('keep')
}

/** Do what the toast offers, once: it goes as soon as it is taken up. */
const act = () => {
  toast.remove(props.message)
  props.message.action.command()
}
</script>
