<template>
  <!-- Pressing in it leaves the selection, and the focus, in the text: on a
       phone a tap elsewhere would otherwise let go of the selection. -->
  <div
    ref="root"
    class="flex items-center gap-0.5"
    :class="
      docked
        ? 'overflow-x-auto'
        : 'absolute z-10 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-800 shadow-md p-0.5'
    "
    :style="docked ? undefined : { left: `${left}px`, top: `${top}px` }"
    data-text-bar
    @pointerdown.prevent
    @mousedown.prevent
  >
    <button
      v-if="comment"
      v-tooltip.bottom="tip(`Comment (${keyLabel('Mod-Shift-m')})`)"
      type="button"
      :class="buttonClass"
      aria-label="Comment"
      data-comment-button
      @click="$emit('comment')"
    >
      <i class="pi pi-comment text-surface-500 dark:text-surface-400" />
    </button>
    <template v-if="suggestion">
      <span v-if="comment" :class="SEPARATOR" aria-hidden="true" />
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
    <template v-if="formatting">
      <span v-if="comment || suggestion" :class="SEPARATOR" aria-hidden="true" />
      <button
        v-tooltip.bottom="tip(`Link (${keyLabel('Mod-k')})`)"
        type="button"
        :class="[buttonClass, pressed(formatting.on.link)]"
        :disabled="!formatting.can.link"
        aria-label="Link"
        :aria-pressed="formatting.on.link"
        data-format="link"
        @click="$emit('link')"
      >
        <i class="pi pi-link" />
      </button>
      <span :class="SEPARATOR" aria-hidden="true" />
      <button
        v-tooltip.bottom="tip(`Bold (${keyLabel('Mod-b')})`)"
        type="button"
        :class="[buttonClass, pressed(formatting.on.strong)]"
        :disabled="!formatting.can.strong"
        aria-label="Bold"
        :aria-pressed="formatting.on.strong"
        data-format="strong"
        @click="pick('strong')"
      >
        <span class="font-serif text-base/none font-bold" aria-hidden="true">B</span>
      </button>
      <button
        v-tooltip.bottom="tip(`Italic (${keyLabel('Mod-i')})`)"
        type="button"
        :class="[buttonClass, pressed(formatting.on.em)]"
        :disabled="!formatting.can.em"
        aria-label="Italic"
        :aria-pressed="formatting.on.em"
        data-format="em"
        @click="pick('em')"
      >
        <span class="font-serif text-base/none italic" aria-hidden="true">I</span>
      </button>
      <button
        ref="marksButton"
        type="button"
        :class="[buttonClass, pressed(open === 'marks')]"
        aria-label="More formatting"
        aria-haspopup="menu"
        :aria-expanded="open === 'marks'"
        data-format-menu-button="marks"
        @click="toggle('marks')"
      >
        <i class="pi pi-ellipsis-h" />
      </button>
      <template v-if="styled">
        <span :class="SEPARATOR" aria-hidden="true" />
        <button
          ref="stylesButton"
          type="button"
          class="flex shrink-0 items-center justify-between gap-1.5 rounded-md cursor-pointer px-2 text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-700"
          :class="[docked ? 'h-10 min-w-32' : 'h-7 min-w-28 text-sm', pressed(open === 'styles')]"
          aria-label="Style"
          aria-haspopup="menu"
          :aria-expanded="open === 'styles'"
          data-format-menu-button="styles"
          @click="toggle('styles')"
        >
          <span>{{ styleLabel }}</span>
          <i class="pi pi-chevron-down text-[0.625rem]!" aria-hidden="true" />
        </button>
      </template>
    </template>
    <FormatMenu
      v-if="open && menuAnchor"
      :anchor="menuAnchor"
      :items="menuItems"
      :docked="docked"
      @pick="pick"
      @close="open = null"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import FormatMenu from './FormatMenu.vue'
import { MARKS, STYLES, WRAPPERS, hasStyles } from '@/editor/format.js'
import { keyLabel } from '@/editor/shortcuts.js'

/**
 * What can be done with the text the selection is on, under the end of it,
 * or in the bar at the bottom of a phone's screen: comment on what is
 * selected, accept or reject the suggestion the caret is in, and format the
 * selection — a link, bold and italic, the rest of the marks in a menu, and
 * the blocks' style in another, with the quote and the lists. The editor
 * says where, and what it is on; this is only the buttons and their menus.
 *
 * Under the text it hangs from the end of the selection, its right edge
 * there, so that it sits under the words it is about.
 *
 * @typedef {Object} Props
 * @property {number} [right] - Where its right edge goes, in the page's coordinates, as the link popover's
 * @property {number} [top]
 * @property {boolean} [docked] - In the bar rather than over the text
 * @property {boolean} [comment] - Offer to comment on the selection
 * @property {boolean} [suggestion] - Offer to accept or reject the suggestion
 * @property {import('@/editor/format.js').Formatting|null} [formatting] - Offer to format the selection, which has these
 */
const props = defineProps({
  right: { type: Number, default: 0 },
  top: { type: Number, default: 0 },
  docked: { type: Boolean, default: false },
  comment: { type: Boolean, default: false },
  suggestion: { type: Boolean, default: false },
  formatting: { type: Object, default: null },
})

/** `format`: the id of a format to toggle or set (see `editor/format`). */
const emit = defineEmits(['comment', 'accept', 'reject', 'link', 'format'])

const SEPARATOR = 'mx-0.5 h-4 w-px shrink-0 bg-surface-200 dark:bg-surface-700'

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
    `flex shrink-0 items-center justify-center rounded-md text-surface-500 dark:text-surface-400 enabled:cursor-pointer enabled:hover:bg-surface-100 dark:enabled:hover:bg-surface-700 disabled:opacity-40 ${props.docked ? 'w-10 h-10' : 'w-7 h-7'}`
)

/**
 * A button's look while what it stands for is on, or its menu open.
 *
 * @param {boolean} on
 */
const pressed = on =>
  on ? 'bg-surface-100! dark:bg-surface-700! text-surface-900! dark:text-surface-0!' : ''

/** Which menu is open. @type {import('vue').Ref<'marks'|'styles'|null>} */
const open = ref(null)

/** @type {import('vue').Ref<HTMLElement|null>} */
const marksButton = ref(null)
/** @type {import('vue').Ref<HTMLElement|null>} */
const stylesButton = ref(null)

const menuAnchor = computed(() => (open.value === 'marks' ? marksButton.value : stylesButton.value))

/** @param {'marks'|'styles'} menu */
const toggle = menu => {
  open.value = open.value === menu ? null : menu
}

/** @param {string} id */
const pick = id => {
  open.value = null
  emit('format', id)
}

/** Whether the blocks can be given a style: a table's cells cannot. */
const styled = computed(() => !!props.formatting && hasStyles(props.formatting))

const styleLabel = computed(
  () => STYLES.find(({ id }) => id === props.formatting?.style)?.label ?? 'Style'
)

/** @param {import('@/editor/format.js').Format} format */
const itemOf = ({ id, label, keys }) => ({
  id,
  label,
  keys,
  on: props.formatting?.on[id] ?? props.formatting?.style === id,
  can: !!props.formatting?.can[id],
})

const menuItems = computed(() =>
  open.value === 'marks'
    ? [
        ...MARKS.map(itemOf),
        { id: 'marks-end', separator: true },
        { ...itemOf({ id: 'clear', label: 'Clear formatting' }), on: false },
      ]
    : [...STYLES.map(itemOf), { id: 'styles-end', separator: true }, ...WRAPPERS.map(itemOf)]
)

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)

/**
 * Where its left edge is: its right edge at `right`, unless that would take
 * it off the page's left, or past the page's padding on the right, where on
 * a phone it would meet the screen's edge or make the page wider than it.
 */
const left = ref(0)

const fit = async () => {
  if (props.docked) return
  await nextTick()
  const element = root.value
  const page = /** @type {HTMLElement|null} */ (element?.offsetParent ?? null)
  if (!element || !page) return
  const edge = page.clientWidth - (parseFloat(window.getComputedStyle(page).paddingRight) || 0)
  left.value = Math.max(0, Math.min(props.right, edge) - element.offsetWidth)
}

onMounted(fit)
watch(() => [props.right, props.top, props.comment, props.suggestion, props.formatting], fit)
</script>
