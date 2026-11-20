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

    <template v-if="actions.length">
      <!-- Links in the toast's own colour rather than buttons in the app's:
           the toast is already the thing asking. -->
      <div class="flex items-center gap-4 text-sm">
        <button
          v-for="(action, at) in actions"
          :key="action.label"
          type="button"
          class="font-semibold hover:underline cursor-pointer"
          :class="{ 'ml-auto': at === 0 }"
          :data-action="action.name ?? 'toast-action'"
          @click="act(action)"
        >
          {{ action.label }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import CheckIcon from '@primevue/icons/check'
import ExclamationTriangleIcon from '@primevue/icons/exclamationtriangle'
import InfoCircleIcon from '@primevue/icons/infocircle'
import TimesCircleIcon from '@primevue/icons/timescircle'
import { useToast } from 'primevue/usetoast'

/**
 * One toast's content. Anything a toast can say, and for one made with
 * `useToast().action`, the button that does something about it. A toast that
 * asks for an answer has a button for each (`actions`).
 *
 * @typedef {{label: string, command: () => void, name?: string, stays?: boolean}} ToastAction -
 *   `name` is its `data-action`; one that `stays` leaves the toast up, for
 *   what it starts to take away once it is done
 *
 * @typedef {Object} Props
 * @property {import('primevue/toast').ToastMessageOptions & {
 *   action?: ToastAction,
 *   actions?: ToastAction[],
 * }} message
 */
const props = defineProps({
  message: { type: Object, required: true },
})

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

/** Its buttons: the one an action has, or the answers it asks for. @type {import('vue').ComputedRef<ToastAction[]>} */
const actions = computed(
  () => props.message.actions ?? (props.message.action ? [props.message.action] : [])
)

/**
 * Do what the toast offers, once: it goes as soon as it is taken up, unless
 * what it starts may yet not happen.
 * @param {ToastAction} action
 */
const act = action => {
  if (!action.stays) toast.remove(props.message)
  action.command()
}
</script>
