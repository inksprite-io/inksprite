/**
 * @module composables/usePictureViewer
 * @description The picture shown at its own size, over the whole window.
 *
 * A picture in a document is not a document, so it opens in no tab: Mod-click
 * or a double click in the editor, or a click on a link to one in a chat,
 * shows it here, over whatever is showing, until Escape or a click beside it.
 * `PictureViewer.vue` draws it, once for the app.
 *
 * One state for the app: every caller shares the same picture.
 */

import { ref } from 'vue'

/**
 * A picture to show.
 *
 * @typedef {Object} ShownPicture
 * @property {string} key - What its bytes are kept by, which the editor shows them by too
 * @property {() => Promise<Blob|null>} load - Read its bytes
 * @property {string} [alt] - Its alt text
 */

/** @type {import('vue').Ref<ShownPicture|null>} */
const shown = ref(null)

/**
 * @returns {{
 *   shown: import('vue').Ref<ShownPicture|null>,
 *   show: (picture: ShownPicture) => void,
 *   close: () => void,
 * }}
 */
export function usePictureViewer() {
  return {
    shown,
    show: picture => {
      shown.value = picture
    },
    close: () => {
      shown.value = null
    },
  }
}
