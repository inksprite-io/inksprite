<template>
  <!-- A picture at its own size over the whole window, fit to it until
       clicked; Escape or a click beside it puts it away. -->
  <Teleport to="body">
    <div
      v-if="shown"
      ref="overlay"
      class="fixed inset-0 z-[2000] flex bg-black/85 outline-none"
      role="dialog"
      aria-modal="true"
      :aria-label="shown.alt || 'Picture'"
      tabindex="-1"
      data-picture-viewer
      @keydown.esc.stop.prevent="viewer.close()"
      @mousedown="pressed = true"
    >
      <div
        class="flex-1 min-h-0 min-w-0 overflow-auto flex p-4"
        :class="natural ? 'items-start justify-start' : 'items-center justify-center'"
        @click.self="pressed && viewer.close()"
      >
        <img
          v-if="url"
          :src="url"
          :alt="shown.alt || ''"
          data-picture-viewer-image
          :class="
            natural
              ? 'max-w-none cursor-zoom-out'
              : 'max-w-full max-h-full object-contain cursor-zoom-in'
          "
          @click="pressed && (natural = !natural)"
        />
        <p v-else-if="loaded" class="text-surface-200 text-sm" data-picture-viewer-missing>
          Missing picture
        </p>
      </div>
      <Button
        icon="pi pi-times"
        text
        rounded
        aria-label="Close"
        class="absolute! top-2 right-2 text-white!"
        data-action="close-picture"
        @click="viewer.close()"
      />
    </div>
  </Teleport>
</template>

<script setup>
/**
 * The picture `usePictureViewer` is showing, once for the app. Its bytes come
 * on the object URL the editor shows them on, when it has one.
 */
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Button from 'primevue/button'
import { usePictureViewer } from '@/composables/usePictureViewer.js'
import { givePictureUrl, takePictureUrl } from '@/editor/pictures.js'

const viewer = usePictureViewer()
const { shown } = viewer

/** @type {import('vue').Ref<HTMLElement|null>} */
const overlay = ref(null)
/** @type {import('vue').Ref<string|null>} */
const url = ref(null)
/** Whether its bytes have been asked for and answered, so nothing is said before then. */
const loaded = ref(false)
/** Whether it is at its own size rather than fit to the window. */
const natural = ref(false)
/**
 * Whether a click began here. The double click that opens a picture ends
 * with a click of its own, over what has just opened, which is not one.
 */
const pressed = ref(false)
/** @type {string|null} The bytes a URL was taken for */
let held = null
/** @type {HTMLElement|null} Where the focus was, to go back to */
let before = null

const release = () => {
  if (held) givePictureUrl(held)
  held = null
  url.value = null
  loaded.value = false
}

watch(shown, async picture => {
  release()
  natural.value = false
  pressed.value = false
  if (!picture) {
    before?.focus()
    before = null
    return
  }
  before ??= /** @type {HTMLElement|null} */ (document.activeElement)
  // Taken at once, so that a picture shown in its place gives it back.
  held = picture.key
  const taking = takePictureUrl(picture.key, picture.load)
  await nextTick()
  overlay.value?.focus()
  const taken = await taking
  if (held !== picture.key) return
  url.value = taken
  loaded.value = true
})

onBeforeUnmount(release)
</script>
