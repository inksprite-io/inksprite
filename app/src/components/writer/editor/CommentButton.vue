<template>
  <button
    ref="root"
    v-tooltip.bottom="docked ? null : shortcut"
    type="button"
    class="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-700 cursor-pointer"
    :class="
      docked
        ? ''
        : 'absolute z-10 border border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-800 shadow-md'
    "
    :style="docked ? undefined : { left: `${Math.max(0, left - shift)}px`, top: `${top}px` }"
    data-comment-button
    @pointerdown.prevent
    @mousedown.prevent
    @click="$emit('comment')"
  >
    <i class="pi pi-comment text-surface-500 dark:text-surface-400" />
    Comment
  </button>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'

/**
 * The offer to comment on what is selected, under the end of the selection,
 * or in the bar at the bottom of a phone's screen. The editor says where, and
 * what it is on; this is only the button.
 *
 * @typedef {Object} Props
 * @property {number} [left] - In the page's coordinates, as the link popover's
 * @property {number} [top]
 * @property {boolean} [docked] - In the bar rather than over the text
 */
const props = defineProps({
  left: { type: Number, default: 0 },
  top: { type: Number, default: 0 },
  docked: { type: Boolean, default: false },
})

// Pressing it leaves the selection, and the focus, in the text: on a phone a
// tap elsewhere would otherwise let go of the selection.
defineEmits(['comment'])

// The modifier is named for the keyboard in front of the writer, as the
// chat's send menu does.
const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '')
const shortcut = isMac ? '⌘⇧M' : 'Ctrl+Shift+M'

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
watch(() => [props.left, props.top], fit)
</script>
