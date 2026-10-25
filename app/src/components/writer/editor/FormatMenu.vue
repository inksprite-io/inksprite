<template>
  <!-- On the page itself, so that neither the text's scrolling nor the
       phone's bar cuts it off. Pressing in it leaves the selection, and the
       focus, in the text, as the bar does. -->
  <Teleport to="body">
    <div
      ref="root"
      role="menu"
      class="fixed z-[1100] min-w-44 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-800 shadow-md p-1"
      :style="{
        left: `${place.left}px`,
        top: `${place.top}px`,
        visibility: placed ? undefined : 'hidden',
      }"
      data-format-menu
      @pointerdown.prevent
      @mousedown.prevent
    >
      <template v-for="item in items" :key="item.id">
        <div
          v-if="item.separator"
          class="my-1 h-px bg-surface-200 dark:bg-surface-700"
          role="separator"
        />
        <button
          v-else
          type="button"
          role="menuitemcheckbox"
          :aria-checked="!!item.on"
          :disabled="!item.can"
          class="flex w-full items-center gap-2 rounded px-2 text-left text-surface-700 dark:text-surface-0 enabled:cursor-pointer enabled:hover:bg-surface-100 dark:enabled:hover:bg-surface-700 disabled:opacity-40"
          :class="docked ? 'py-2.5' : 'py-1.5 text-sm'"
          :data-format="item.id"
          @click="$emit('pick', item.id)"
        >
          <i class="pi pi-check text-xs" :class="{ invisible: !item.on }" aria-hidden="true" />
          <span class="flex-1">{{ item.label }}</span>
          <span v-if="item.keys && !docked" class="pl-6 text-xs text-surface-400">
            {{ keyLabel(item.keys) }}
          </span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { keyLabel } from '@/editor/shortcuts.js'

/**
 * A menu of formats under one of the text bar's buttons, or over it in the
 * phone's bar: each with a check while the selection has it, its key, and
 * greyed where it cannot apply. It goes on a pick, a press anywhere else,
 * Escape, or the page scrolling from under it; the bar says which it was.
 *
 * @typedef {Object} Item
 * @property {string} id
 * @property {string} [label]
 * @property {string} [keys] - As ProseMirror writes a binding
 * @property {boolean} [on]
 * @property {boolean} [can]
 * @property {boolean} [separator]
 *
 * @typedef {Object} Props
 * @property {HTMLElement} anchor - The button it hangs from
 * @property {Item[]} items
 * @property {boolean} [docked] - From the phone's bar: bigger, no keys, above it
 */
const props = defineProps({
  anchor: { type: Object, required: true },
  items: { type: Array, required: true },
  docked: { type: Boolean, default: false },
})

const emit = defineEmits(['pick', 'close'])

/** How far it keeps from the button and the window's edges. */
const GAP = 4
const MARGIN = 8

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)
const place = ref({ left: 0, top: 0 })
/** Hidden until it has been measured and put where it fits. */
const placed = ref(false)

/**
 * Under the button and lined up with its left edge, or over it where there
 * is no room below, as there never is from the phone's bar; and kept inside
 * the window.
 */
const fit = async () => {
  await nextTick()
  const element = root.value
  if (!element) return
  const button = props.anchor.getBoundingClientRect()
  const { offsetWidth: width, offsetHeight: height } = element
  const below = button.bottom + GAP
  const fitsBelow = below + height <= window.innerHeight - MARGIN
  const top = !props.docked && fitsBelow ? below : button.top - GAP - height
  const left = Math.min(button.left, window.innerWidth - MARGIN - width)
  place.value = { left: Math.max(MARGIN, left), top: Math.max(MARGIN, top) }
  placed.value = true
}

/** @param {Event} event */
const pressedElsewhere = event => {
  const target = /** @type {Node} */ (event.target)
  if (!root.value?.contains(target) && !props.anchor.contains(target)) emit('close')
}

/**
 * Escape puts it away and goes no further: the text, which has the focus,
 * would otherwise take it too, and focus mode leave.
 *
 * @param {KeyboardEvent} event
 */
const onKeyDown = event => {
  if (event.key !== 'Escape') return
  event.preventDefault()
  event.stopPropagation()
  emit('close')
}

const scrolled = () => emit('close')

onMounted(() => {
  fit()
  document.addEventListener('pointerdown', pressedElsewhere, true)
  window.addEventListener('keydown', onKeyDown, true)
  window.addEventListener('scroll', scrolled, true)
  window.addEventListener('resize', scrolled)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', pressedElsewhere, true)
  window.removeEventListener('keydown', onKeyDown, true)
  window.removeEventListener('scroll', scrolled, true)
  window.removeEventListener('resize', scrolled)
})
</script>
