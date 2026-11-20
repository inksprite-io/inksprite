<template>
  <!-- The frame is of another origin, which is the point of it: the page
       sets it here and can't reach into it (`platform/terminal.js`). The
       ground under it is the panel's, so the frame is that colour before it
       has drawn. While the pointer is held from a press in the page, a
       panel's edge being dragged, the frame lets it through: over the frame
       the page would hear nothing of it (`usePagePress`). -->
  <div
    ref="root"
    class="relative min-h-0 bg-surface-0 dark:bg-surface-850 text-surface-900 dark:text-surface-0"
    data-terminal-frame
  >
    <iframe
      v-if="src"
      ref="frame"
      :src="src"
      title="Terminal"
      allow="clipboard-read; clipboard-write"
      class="absolute inset-0 w-full h-full border-0 block"
      :class="{ 'pointer-events-none': pagePress }"
      @load="onLoad"
    ></iframe>
  </div>
</template>

<script setup>
/* global getComputedStyle, KeyboardEvent, MouseEvent, MutationObserver */
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePagePress } from '@/composables/usePagePress.js'
import { TERMINAL_ORIGIN, terminalFrameUrl } from '@/platform/terminal.js'
import { appShortcutFrom } from '@/utils/terminalFrame.js'

/**
 * A terminal, in its frame. The frame's page is the desktop app's own and
 * holds the emulator; this sets it in the panel, tells it how to look, and
 * takes back from it what a frame keeps from the page around it: a click in
 * it, so that a menu open in the page closes, and one of the app's shortcuts
 * pressed in it.
 *
 * It stays mounted while its tab is open and is only hidden behind another
 * tab, so going back to it is at once. Unmounted, its shell runs on, and the
 * frame that next shows it is sent the screen as it stands.
 *
 * @typedef {Object} Props
 * @property {string} terminalId
 * @property {boolean} active - Whether its tab is the one showing
 */
const props = defineProps({
  terminalId: { type: String, required: true },
  active: { type: Boolean, default: false },
})

/** The size of the terminal's text, in pixels. */
const FONT_SIZE = 13

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)
/** @type {import('vue').Ref<HTMLIFrameElement|null>} */
const frame = ref(null)

/** Whether the pointer is held from a press in the page, and the frame out of its way. */
const pagePress = usePagePress()

/** The frame's address, which names how it looks at first; set once. */
const src = ref('')

/**
 * A colour as `#rrggbb`, whatever way the browser has of saying it: painted,
 * and read back. Null for one that isn't opaque, or where nothing paints.
 *
 * @param {string|undefined} color
 * @returns {string|null}
 */
function hexColor(color) {
  const context = color ? document.createElement('canvas').getContext('2d') : null
  if (!context) return null
  context.fillStyle = /** @type {string} */ (color)
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
  if (alpha !== 255) return null
  return `#${[red, green, blue].map(part => part.toString(16).padStart(2, '0')).join('')}`
}

/**
 * How the terminal looks: the panel's own colours, as they are now.
 *
 * @returns {import('@/platform/terminal.js').TerminalAppearance}
 */
function appearance() {
  const dark = document.documentElement.classList.contains('dark')
  const style = root.value ? getComputedStyle(root.value) : null
  return {
    dark,
    background: hexColor(style?.backgroundColor) ?? (dark ? '#1f1f1f' : '#ffffff'),
    foreground: hexColor(style?.color) ?? (dark ? '#ffffff' : '#1f2328'),
    fontSize: FONT_SIZE,
  }
}

/** Put the keys in the terminal, if it is the tab showing. */
function focus() {
  if (props.active) frame.value?.contentWindow?.focus()
}

defineExpose({ focus })

const onLoad = () => focus()

/**
 * What the frame says: it was clicked, or one of the app's shortcuts was
 * pressed in it. Each is played here as if it had happened on the panel, a
 * click whole, down and up, so nothing is left thinking the pointer held.
 *
 * @param {MessageEvent} event
 */
function onMessage(event) {
  const target = root.value
  if (!target || event.origin !== TERMINAL_ORIGIN) return
  if (event.source !== frame.value?.contentWindow) return
  if (event.data?.type === 'pointer') {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }))
    }
  } else if (event.data?.type === 'key') {
    const shortcut = appShortcutFrom(event.data)
    if (shortcut) {
      target.dispatchEvent(
        new KeyboardEvent('keydown', { ...shortcut, bubbles: true, cancelable: true })
      )
    }
  }
}

/** @type {MutationObserver|null} */
let themeObserver = null

onMounted(() => {
  src.value = terminalFrameUrl(props.terminalId, appearance())
  window.addEventListener('message', onMessage)
  // The app going dark or light: the frame is told, once the panel has changed.
  themeObserver = new MutationObserver(() =>
    nextTick(() =>
      frame.value?.contentWindow?.postMessage(
        { type: 'appearance', appearance: appearance() },
        TERMINAL_ORIGIN
      )
    )
  )
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

onBeforeUnmount(() => {
  window.removeEventListener('message', onMessage)
  themeObserver?.disconnect()
})

watch(
  () => props.active,
  active => active && nextTick(focus)
)
</script>
