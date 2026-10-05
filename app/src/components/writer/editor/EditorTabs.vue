<template>
  <div
    class="flex-none h-9 flex items-stretch bg-surface-100 dark:bg-surface-800 border-b border-surface-0 dark:border-surface-900 select-none"
  >
    <!-- The lines between tabs and under the strip are the editor's own
         colour, so the tab showing runs straight into the page below it.

         The tabs scroll; what is at the end of the strip does not. The tab
         showing is marked by a line drawn inside its top edge rather than a
         border, so no tab reserves room for one and every tab's text sits at
         the same height as what is at the end of the strip.

         The strip draws its own scrollbar: a thumb laid over the tabs'
         bottom edge, part see-through, there while the tabs are scrolling and
         gone a moment after — what a scrollbar that overlays does, and a
         native one stops doing the moment it is styled. Nothing scrolls up and
         down, so nothing can be nudged that way; a wheel scrolls the strip
         along instead. -->
    <div class="relative flex-1 min-w-0 flex">
      <div
        ref="list"
        class="flex-1 min-w-0 flex items-stretch overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
        @wheel="scrollAlong"
        @scroll="onScroll"
      >
        <div
          v-for="item in items"
          :key="item.id"
          :ref="el => remember(item.id, el)"
          role="tab"
          :aria-selected="item.id === activeId"
          :title="item.path || item.title"
          :data-tab-id="item.id"
          :data-preview="item.preview || undefined"
          class="group flex-none flex items-center gap-1 min-w-28 max-w-64 pl-3 pr-1 text-sm cursor-pointer border-r border-surface-0 dark:border-surface-900 transition-colors duration-150"
          :class="
            item.id === activeId
              ? 'bg-surface-0 dark:bg-surface-900 shadow-[inset_0_2px_0_0_var(--p-primary-500)] text-surface-900 dark:text-surface-0'
              : 'text-surface-600 dark:text-surface-400 hover:bg-surface-200/60 dark:hover:bg-surface-700/60'
          "
          @click="$emit('activate', item.id)"
          @dblclick="$emit('keep', item.id)"
          @mousedown.middle.prevent
          @auxclick="event => event.button === 1 && $emit('close', item.id)"
          @contextmenu="openMenu(item.id, $event)"
        >
          <!-- The path gives way before the title does, which is the part that
           says what the tab is. A preview reads in italics until it is kept. -->
          <span class="flex-1 min-w-0 flex items-baseline" :class="{ italic: item.preview }">
            <span
              v-if="item.prefix"
              class="min-w-0 truncate shrink-[1000] text-surface-500 dark:text-surface-400"
              >{{ item.prefix }}</span
            >
            <span class="min-w-0 truncate">{{ item.title }}</span>
          </span>
          <!-- Shown on the tab in front and on hover; a row of crosses is noise -->
          <button
            type="button"
            :aria-label="`Close ${item.title}`"
            class="flex-none w-5 h-5 rounded flex items-center justify-center text-surface-500 dark:text-surface-400 hover:bg-surface-300 dark:hover:bg-surface-600 hover:text-surface-900 dark:hover:text-surface-0 transition-opacity"
            :class="item.id === activeId ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'"
            @click.stop="$emit('close', item.id)"
          >
            <i class="pi pi-times text-xs"></i>
          </button>
        </div>
      </div>
      <div
        v-if="thumb"
        class="absolute bottom-0 h-1 rounded-full bg-surface-500/50 pointer-events-none transition-opacity duration-300"
        :class="scrolling ? 'opacity-100' : 'opacity-0'"
        :style="{ left: `${thumb.left}px`, width: `${thumb.width}px` }"
        aria-hidden="true"
        data-scroll-thumb
      ></div>
    </div>
    <!-- What applies to the panel rather than a tab, at the far end, outside
         the scroll so it is there however many tabs are open -->
    <div v-if="$slots.end" class="flex-none flex items-center px-1">
      <slot name="end" />
    </div>
    <!-- What can be done to a tab, on right-click: whatever the panel offers -->
    <ContextMenu v-if="actions" ref="menu" :model="menuItems" />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import ContextMenu from 'primevue/contextmenu'

/**
 * The strip of open documents above the editor. Presentational: what is
 * open, and which is showing, are the story's, and picking or closing one is
 * asked for rather than done here.
 *
 * @typedef {Object} TabItem
 * @property {string} id
 * @property {string} title
 * @property {string} [prefix] - As much of the path above the title as tells
 *   it apart from another open tab's, ending in `/`
 * @property {string} [path] - The whole path, for the tooltip
 * @property {boolean} [preview] - Only being looked at, and not yet kept
 *
 * @typedef {Object} Props
 * @property {TabItem[]} items - The open documents, in strip order
 * @property {string|null} [activeId] - The one showing
 * @property {((id: string) => import('primevue/menuitem').MenuItem[])|null} [actions] -
 *   What a tab's right-click menu offers, asked per tab; none means no menu
 */
const props = defineProps({
  items: { type: Array, required: true },
  activeId: { type: String, default: null },
  actions: { type: Function, default: null },
})

defineEmits(['activate', 'close', 'keep'])

const menu = ref()
/** The tab the menu was opened on. @type {import('vue').Ref<string|null>} */
const menuFor = ref(null)
const menuItems = computed(() =>
  menuFor.value && props.actions ? props.actions(menuFor.value) : []
)

/**
 * @param {string} id
 * @param {MouseEvent} event
 */
const openMenu = (id, event) => {
  if (!props.actions) return
  menuFor.value = id
  menu.value?.show(event)
}

/** @type {Map<string, HTMLElement>} */
const elements = new Map()

/**
 * @param {string} id
 * @param {Element|import('vue').ComponentPublicInstance|null} el
 */
const remember = (id, el) => {
  if (el && 'scrollIntoView' in el) elements.set(id, /** @type {HTMLElement} */ (el))
  else elements.delete(id)
}

/**
 * Scroll the strip along on a wheel turned up or down, which is the only way
 * most wheels turn and the only way the strip can go. A trackpad already
 * scrolls sideways of its own accord and is left to it, and a strip with room
 * for every tab has nothing to scroll and leaves the wheel to the page.
 * @param {WheelEvent} event
 */
const scrollAlong = event => {
  if (event.deltaX !== 0 || event.deltaY === 0) return
  const strip = /** @type {HTMLElement} */ (event.currentTarget)
  if (strip.scrollWidth <= strip.clientWidth) return
  // A wheel that counts lines rather than pixels moves about a tab's height
  // per line.
  strip.scrollLeft += event.deltaMode === 1 ? event.deltaY * 36 : event.deltaY
  event.preventDefault()
}

/** The list of tabs, which is what scrolls. @type {import('vue').Ref<HTMLElement|null>} */
const list = ref(null)

/**
 * How far the tabs are scrolled and how far they go, read off the list
 * whenever either could have changed: a scroll, a resize, a tab opened or
 * closed. Kept as state so the thumb is a computed over it.
 */
const extent = ref({ left: 0, seen: 0, total: 0 })
const measure = () => {
  const el = list.value
  if (el) extent.value = { left: el.scrollLeft, seen: el.clientWidth, total: el.scrollWidth }
}

/**
 * The thumb: where it sits and how wide, in pixels, or null with nothing to
 * scroll. As wide as the share of the tabs in view, and no narrower than a
 * fingertip.
 */
const thumb = computed(() => {
  const { left, seen, total } = extent.value
  if (seen === 0 || total <= seen) return null
  const width = Math.max(24, (seen * seen) / total)
  return { left: (left / (total - seen)) * (seen - width), width }
})

/** Whether the thumb is showing: while the tabs scroll, and a moment after. */
const scrolling = ref(false)
/** @type {ReturnType<typeof setTimeout>|null} */
let fade = null
const onScroll = () => {
  measure()
  scrolling.value = true
  if (fade) clearTimeout(fade)
  fade = setTimeout(() => {
    scrolling.value = false
  }, 1000)
}

// A tab opened or closed, or the strip resized, moves the thumb without a
// scroll.
watch(
  () => props.items,
  () => nextTick(measure)
)
/** @type {ResizeObserver|null} */
let resizing = null
onMounted(() => {
  measure()
  if (typeof ResizeObserver !== 'undefined' && list.value) {
    resizing = new ResizeObserver(measure)
    resizing.observe(list.value)
  }
})
onBeforeUnmount(() => {
  resizing?.disconnect()
  if (fade) clearTimeout(fade)
})

// A tab brought forward off the end of a full strip is scrolled to, so the
// writer sees where they are.
watch(
  () => props.activeId,
  async id => {
    await nextTick()
    if (id) elements.get(id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  },
  { immediate: true }
)
</script>
