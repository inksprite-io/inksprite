<template>
  <!-- Pressing in it leaves the selection, and the focus, in the text: on a
       phone a tap elsewhere would otherwise let go of the selection. -->
  <div
    ref="root"
    class="flex items-center gap-0.5"
    :class="
      docked
        ? ''
        : 'absolute z-10 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-800 shadow-md p-0.5'
    "
    :style="docked ? undefined : { left: `${Math.max(0, left - shift)}px`, top: `${top}px` }"
    data-text-bar
    @pointerdown.prevent
    @mousedown.prevent
  >
    <button
      v-if="comment"
      v-tooltip.bottom="tip(`Comment (${shortcut})`)"
      type="button"
      :class="buttonClass"
      aria-label="Comment"
      data-comment-button
      @click="$emit('comment')"
    >
      <i class="pi pi-comment text-surface-500 dark:text-surface-400" />
    </button>
    <span
      v-if="comment && suggestion"
      class="mx-0.5 h-4 w-px bg-surface-200 dark:bg-surface-700"
      aria-hidden="true"
    />
    <template v-if="suggestion">
      <button
        v-tooltip.bottom="tip('Reject')"
        type="button"
        :class="buttonClass"
        aria-label="Reject"
        data-action="reject-suggestion"
        @click="$emit('reject')"
      >
        <i class="pi pi-times text-surface-500 dark:text-surface-400" />
      </button>
      <button
        v-tooltip.bottom="tip('Accept')"
        type="button"
        :class="buttonClass"
        aria-label="Accept"
        data-action="accept-suggestion"
        @click="$emit('accept')"
      >
        <i class="pi pi-check text-green-600 dark:text-green-400" />
      </button>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'

/**
 * What can be done with the text the selection is on, under the end of it,
 * or in the bar at the bottom of a phone's screen: comment on what is
 * selected, and accept or reject the suggestion the caret is in. The editor
 * says where, and what it is on; this is only the buttons.
 *
 * @typedef {Object} Props
 * @property {number} [left] - In the page's coordinates, as the link popover's
 * @property {number} [top]
 * @property {boolean} [docked] - In the bar rather than over the text
 * @property {boolean} [comment] - Offer to comment on the selection
 * @property {boolean} [suggestion] - Offer to accept or reject the suggestion
 */
const props = defineProps({
  left: { type: Number, default: 0 },
  top: { type: Number, default: 0 },
  docked: { type: Boolean, default: false },
  comment: { type: Boolean, default: false },
  suggestion: { type: Boolean, default: false },
})

defineEmits(['comment', 'accept', 'reject'])

// The modifier is named for the keyboard in front of the writer, as the
// chat's send menu does.
const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '')
const shortcut = isMac ? '⌘⇧M' : 'Ctrl+Shift+M'

/**
 * A button's tooltip, where there is a pointer to hover with: in the phone's
 * bar a tap shows it and leaves it up.
 *
 * @param {string} text
 * @returns {string|null}
 */
const tip = text => (props.docked ? null : text)

// Bigger in the phone's bar, to be tapped.
const buttonClass = computed(
  () =>
    `flex items-center justify-center rounded-md cursor-pointer hover:bg-surface-100 dark:hover:bg-surface-700 ${props.docked ? 'w-10 h-10' : 'w-7 h-7'}`
)

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)

/**
 * How far left of where it was put it has to go to stay over the text: inside
 * the page's padding, so that on a phone it neither meets the screen's edge
 * nor makes the page wider than the screen.
 */
const shift = ref(0)

const fit = async () => {
  shift.value = 0
  if (props.docked) return
  await nextTick()
  const element = root.value
  const page = /** @type {HTMLElement|null} */ (element?.offsetParent ?? null)
  if (!element || !page) return
  const edge = page.clientWidth - (parseFloat(window.getComputedStyle(page).paddingRight) || 0)
  shift.value = Math.max(0, element.offsetLeft + element.offsetWidth - edge)
}

onMounted(fit)
watch(() => [props.left, props.top, props.comment, props.suggestion], fit)
</script>
