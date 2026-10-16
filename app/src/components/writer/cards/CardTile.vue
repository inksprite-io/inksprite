<template>
  <button
    v-tooltip.bottom="tooltip"
    type="button"
    class="group flex flex-col gap-1.5 min-w-0 text-left rounded-lg p-1 cursor-pointer focus-visible:outline-2 focus-visible:outline-primary-500"
    :aria-label="card.title"
    aria-haspopup="menu"
    :data-card="card.id"
    @click="$emit('open', card.id)"
    @contextmenu="$emit('menu', $event, card.id)"
    @keydown="onKeydown"
    @touchstart.passive="press.touchstart"
    @touchmove.passive="press.touchmove"
    @touchend="press.touchend"
    @touchcancel="press.touchend"
  >
    <div
      class="relative w-full aspect-[2/3] rounded-md overflow-hidden bg-surface-200 dark:bg-surface-700 ring-1 ring-surface-300 dark:ring-surface-600 group-hover:ring-2 group-hover:ring-primary-400 transition-shadow"
    >
      <!-- Blurred past knowing, and grown a little so its edges stay in the
           frame; the mark says it is hidden rather than out of focus. -->
      <img
        v-if="url"
        :src="url"
        alt=""
        class="w-full h-full object-cover"
        :class="{ 'blur-xl scale-110': blurred }"
        :data-blurred="blurred || undefined"
        loading="lazy"
        decoding="async"
        draggable="false"
      />
      <i
        v-if="url && blurred"
        class="pi pi-eye-slash absolute inset-0 m-auto h-fit w-fit text-2xl text-white/90 drop-shadow"
        aria-hidden="true"
      />
      <!-- A card with no picture, or one not drawn yet, wears its initial. -->
      <div
        v-else
        class="w-full h-full flex items-center justify-center text-3xl font-semibold text-surface-400 dark:text-surface-500"
        aria-hidden="true"
      >
        {{ initial }}
      </div>
    </div>
    <span class="text-sm text-surface-800 dark:text-surface-100 truncate px-0.5">
      {{ card.title }}
    </span>
  </button>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useLongPress } from '@/composables/useLongPress.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { useCardLibraryStore } from '@/stores/cardLibraryStore.js'
import { isNsfw } from '@/cards/library.js'

/**
 * One card in the library's grid: its picture at a portrait's proportions
 * and the name it is known by. Hovering shows what its creator wrote about
 * it, or the start of its description. A right-click, a finger held on it, or
 * the menu key asks for its menu, which the grid holds one of for them all.
 * A card tagged NSFW or NSFL has its picture blurred, unless the writer has
 * switched that off.
 *
 * @typedef {Object} Props
 * @property {import('@/types/models.js').LibraryCard} card
 * @property {boolean} [menuOpen] - Its menu is showing, which its notes would sit under
 */
const props = defineProps({
  card: { type: Object, required: true },
  menuOpen: { type: Boolean, default: false },
})

const emit = defineEmits(['open', 'menu'])

/**
 * Something a menu can be placed by: where the pointer was, or for a key, the
 * tile's own corner.
 * @param {number} x
 * @param {number} y
 */
const at = (x, y) => ({
  pageX: x + window.scrollX,
  pageY: y + window.scrollY,
  stopPropagation() {},
  preventDefault() {},
})

/** A finger held still on the tile opens its menu where the finger is. */
const press = useLongPress(({ x, y }) => emit('menu', at(x, y), props.card.id))

/**
 * The menu key, or Shift-F10, opens the menu at the tile.
 * @param {KeyboardEvent} event
 */
const onKeydown = event => {
  if (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey)) return
  event.preventDefault()
  const rect = /** @type {HTMLElement} */ (event.currentTarget).getBoundingClientRect()
  emit('menu', at(rect.left + 24, rect.bottom - 24), props.card.id)
}

const library = useCardLibraryStore()
const { blurNsfw } = useApplicationState()

const blurred = computed(() => blurNsfw.value && isNsfw(props.card))

/** The thumbnail, as a URL the page can show. */
const url = ref('')

const initial = computed(() => props.card.title.trim().charAt(0).toUpperCase() || '?')

/**
 * Long notes would cover the grid; the start of them is enough to tell cards
 * apart. Shown after a moment, so moving across the grid does not flash them.
 */
const tooltip = computed(() => {
  const notes = props.card.notes || ''
  if (!notes) return null
  return {
    value: notes.length > 300 ? `${notes.slice(0, 300).trimEnd()}…` : notes,
    disabled: props.menuOpen,
    showDelay: 400,
    pt: { text: { class: 'whitespace-pre-line text-xs max-w-80' } },
  }
})

const release = () => {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = ''
}

let unmounted = false

watch(
  () => props.card.id,
  async id => {
    release()
    const blob = await library.thumbnail(id)
    // The tile may be showing another card, or be gone, by the time it is made.
    if (!blob || unmounted || id !== props.card.id) return
    url.value = URL.createObjectURL(blob)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  unmounted = true
  release()
})
</script>
