<template>
  <div class="h-full w-full min-w-0 flex flex-col bg-surface-100 dark:bg-surface-950">
    <!-- A picture, fit to the panel; a click shows it at its own size. -->
    <div
      v-if="kind === 'image'"
      class="flex-1 min-h-0 overflow-auto flex"
      :class="natural ? 'items-start justify-start' : 'items-center justify-center'"
    >
      <img
        :src="url || undefined"
        :alt="title"
        data-file-image
        :class="
          natural
            ? 'max-w-none cursor-zoom-out'
            : 'max-w-full max-h-full object-contain cursor-zoom-in'
        "
        @click="natural = !natural"
      />
    </div>

    <!-- The pages, and only the pages. -->
    <PdfView v-else-if="kind === 'pdf' && blob" :blob="blob" data-file-pdf class="flex-1 min-h-0" />

    <!-- A book, chapter after chapter, read out of the file. -->
    <div v-else-if="kind === 'epub'" class="flex-1 min-h-0 overflow-auto" data-file-epub>
      <article
        class="prose dark:prose-invert max-w-prose mx-auto px-6 py-8"
        v-html="book"
      ></article>
    </div>

    <!-- Text: source code, data, anything that reads as it is. -->
    <CodeView
      v-else-if="kind === 'code'"
      :content="document?.content || ''"
      :filename="document?.title || ''"
      class="flex-1 min-h-0"
    />

    <!-- Anything the panel cannot show, and a file whose bytes are gone. -->
    <div v-else-if="kind === 'none'" class="flex-1 min-h-0 flex items-center justify-center">
      <div class="flex flex-col items-center gap-4 text-center px-4" data-file-none>
        <i class="pi pi-file text-6xl text-surface-400"></i>
        <div>
          <h2 class="text-2xl font-semibold text-surface-700 dark:text-surface-200">
            No preview available
          </h2>
          <p class="text-surface-500 dark:text-surface-400 mt-2">{{ detail }}</p>
        </div>
        <Button
          v-if="blob"
          label="Download"
          icon="pi pi-download"
          severity="secondary"
          outlined
          @click="download"
        />
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import Button from 'primevue/button'
import PdfView from './PdfView.vue'

// CodeMirror and its languages load with the first file of text opened.
const CodeView = defineAsyncComponent(() => import('./CodeView.vue'))
import { useDocuments } from '@/composables/useDocuments'
import { useFilesStore } from '@/stores/filesStore'
import { downloadBlob, filenameFor } from '@/files/download.js'
import { extractEpub } from '@/files/epub.js'
import { EPUB_MIME, isImage, isText, sizeLabel } from '@/files/inspect.js'
import { renderMarkdown } from '@/utils/markdown.js'

/**
 * A file document, shown as the file: the picture, the PDF's pages
 * (`PdfView`), an epub's chapters read out of it again, a file of text as
 * code (`CodeView`) — a repository's files, which keep no bytes since their
 * text is the file, and a JSON or CSV imported on its own — or a line saying
 * there is no preview of this kind and the way to download it instead. Its text is a different view, `RawMarkdown` on its
 * `content`, reached from the tab's menu; this shows the bytes.
 *
 * The bytes are read from the files table when the view is made and let go
 * when it is unmounted, along with the object URL that pointed the browser at
 * a picture.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} documentId
 */
const props = defineProps({
  storyId: { type: String, required: true },
  documentId: { type: String, required: true },
})

const api = useDocuments(props.storyId)
const files = useFilesStore()

const document = computed(() => api.get(props.documentId))
const title = computed(() => api.displayTitle(document.value))
const mime = computed(() => document.value?.mime || '')

/** @type {import('vue').Ref<Blob|null>} */
const blob = ref(null)
/** @type {import('vue').Ref<string|null>} */
const url = ref(null)
/** Whether the bytes have been asked for and answered, so nothing is said before then. */
const loaded = ref(false)
/** A picture at its own size rather than fit to the panel. */
const natural = ref(false)
/** An epub's chapters as HTML, or null when it could not be read. @type {import('vue').Ref<string|null>} */
const book = ref(null)
/** Why an epub could not be shown, when it could not. */
const unreadable = ref('')

/** Which view this file gets: nothing until the bytes are known. */
const kind = computed(() => {
  if (!loaded.value) return 'loading'
  // A repository's file keeps no bytes: its text is the file.
  if (!blob.value) return isText(mime.value) ? 'code' : 'none'
  if (isImage(mime.value)) return 'image'
  if (mime.value === 'application/pdf') return 'pdf'
  if (book.value) return 'epub'
  // A web page's text is what was read out of it, not its markup.
  if (isText(mime.value) && mime.value !== 'text/html') return 'code'
  return 'none'
})

/** What is said under "No preview available": what the file is, or that it is gone. */
const detail = computed(() => {
  const found = document.value
  if (!found) return ''
  if (!blob.value) return 'The file itself is not in this project any more.'
  if (unreadable.value) return unreadable.value
  const bits = [found.mime || 'unknown type']
  if (typeof found.size === 'number') bits.push(sizeLabel(found.size))
  return bits.join(' · ')
})

const release = () => {
  if (url.value) URL.revokeObjectURL(url.value)
  url.value = null
}

/** Read the bytes and point the browser at them. */
const load = async () => {
  release()
  loaded.value = false
  natural.value = false
  book.value = null
  unreadable.value = ''
  const found = await files.getFile(props.documentId)
  blob.value = found
  if (found && isImage(mime.value)) url.value = URL.createObjectURL(found)
  if (found && mime.value === EPUB_MIME) await readBook(found)
  loaded.value = true
}

/**
 * Read an epub's chapters out of its bytes, as the import did. From the file
 * rather than the document's text: this view is the file, and the text, which
 * the writer may have cut down, is the other one.
 *
 * @param {Blob} file
 */
const readBook = async file => {
  try {
    const { text } = extractEpub(await file.arrayBuffer())
    if (text) book.value = renderMarkdown(text)
    else unreadable.value = 'There is no text in this epub to show.'
  } catch (error) {
    unreadable.value = error instanceof Error ? error.message : String(error)
  }
}

watch(() => props.documentId, load, { immediate: true })
onBeforeUnmount(release)

/** Hand the writer the file back, named as it came in. */
const download = () => {
  if (blob.value && document.value) downloadBlob(blob.value, filenameFor(document.value))
}
</script>
