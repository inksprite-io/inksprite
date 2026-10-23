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
    <PdfView
      v-else-if="kind === 'pdf' && blob"
      ref="pdfView"
      :blob="blob"
      data-file-pdf
      class="flex-1 min-h-0"
    />

    <!-- A book, chapter after chapter, or a web page's article, read out of
         the file. -->
    <div v-else-if="kind === 'reader'" class="flex-1 min-h-0 overflow-auto" data-file-reader>
      <article
        class="prose dark:prose-invert max-w-prose mx-auto px-6 py-8"
        v-html="reading"
      ></article>
    </div>

    <!-- Text: source code, data, anything that reads as it is. -->
    <CodeView
      v-else-if="kind === 'code'"
      ref="codeView"
      :content="document?.content || ''"
      :filename="document?.title || ''"
      class="flex-1 min-h-0"
    />

    <!-- A file another device imported, coming from the sync server. -->
    <div
      v-else-if="kind === 'downloading'"
      class="flex-1 min-h-0 flex items-center justify-center"
      data-file-downloading
    >
      <p class="text-surface-500 dark:text-surface-400">
        <i class="pi pi-spin pi-spinner mr-2"></i>Downloading… {{ percent }}%
      </p>
    </div>

    <!-- One that is there and couldn't be fetched: offline, most likely. -->
    <div v-else-if="kind === 'elsewhere'" class="flex-1 min-h-0 flex items-center justify-center">
      <div class="flex flex-col items-center gap-4 text-center px-4" data-file-elsewhere>
        <i class="pi pi-cloud-download text-6xl text-surface-400"></i>
        <div>
          <h2 class="text-xl font-semibold text-surface-700 dark:text-surface-200">
            Not on this device yet
          </h2>
          <p class="text-surface-500 dark:text-surface-400 mt-2">
            It couldn't be downloaded. Check your connection and try again.
          </p>
        </div>
        <Button
          label="Try again"
          icon="pi pi-refresh"
          severity="secondary"
          outlined
          data-action="fetch-file"
          @click="load"
        />
      </div>
    </div>

    <!-- Anything the panel cannot show, and a file whose bytes are gone. -->
    <div v-else-if="kind === 'none'" class="flex-1 min-h-0 flex items-center justify-center">
      <div class="flex flex-col items-center gap-4 text-center px-4" data-file-none>
        <i class="pi pi-file text-6xl text-surface-400"></i>
        <div>
          <h2 class="text-xl font-semibold text-surface-700 dark:text-surface-200">
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
import { markdownOfHtml } from '@/files/html.js'
import { EPUB_MIME, isImage, isText, showsAsText, sizeLabel } from '@/files/inspect.js'
import { renderMarkdown } from '@/utils/markdown.js'
import { goneTo, takeUpMatch } from '@/composables/useProjectSearch.js'
import { pageAt } from '@/ai/tools/slices.js'

/**
 * A file document, shown as the file: the picture, the PDF's pages
 * (`PdfView`), an epub's chapters or a web page's article read out of it
 * again, a file of text as code (`CodeView`) — a repository's files, which keep no bytes since their
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
/** How far a download from the sync server has got, while there is one. @type {import('vue').Ref<{done: number, total: number}|null>} */
const downloading = ref(null)
/** Whether the bytes are on the sync server, and couldn't be fetched. */
const elsewhere = ref(false)
/** A picture at its own size rather than fit to the panel. */
const natural = ref(false)
/** An epub's chapters or a web page's article as HTML, or null when there is none. @type {import('vue').Ref<string|null>} */
const reading = ref(null)
/** Why an epub or a page could not be shown, when it could not. */
const unreadable = ref('')

/** Which view this file gets: nothing until the bytes are known. */
const kind = computed(() => {
  if (!loaded.value) return downloading.value ? 'downloading' : 'loading'
  if (!blob.value && elsewhere.value) return 'elsewhere'
  // A repository's file keeps no bytes: its text is the file.
  if (!blob.value) return isText(mime.value) ? 'code' : 'none'
  if (isImage(mime.value)) return 'image'
  if (mime.value === 'application/pdf') return 'pdf'
  if (reading.value) return 'reader'
  if (showsAsText(mime.value)) return 'code'
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

/** How much of a download is done, out of a hundred. */
const percent = computed(() => {
  const { done = 0, total = 1 } = downloading.value ?? {}
  return Math.floor((100 * done) / Math.max(total, 1))
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
  reading.value = null
  unreadable.value = ''
  downloading.value = null
  elsewhere.value = false
  const id = props.documentId
  const found = await files.getFile(id, {
    progress: (done, total) => {
      if (props.documentId === id) downloading.value = { done, total }
    },
  })
  // Moved on to another file while this one came.
  if (props.documentId !== id) return
  downloading.value = null
  if (!found) elsewhere.value = await files.isElsewhere(id)
  blob.value = found
  if (found && isImage(mime.value)) url.value = URL.createObjectURL(found)
  if (found && mime.value === EPUB_MIME) await readBook(found)
  if (found && mime.value === 'text/html') await readPage(found)
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
    if (text) reading.value = renderMarkdown(text)
    else unreadable.value = 'There is no text in this epub to show.'
  } catch (error) {
    unreadable.value = error instanceof Error ? error.message : String(error)
  }
}

/**
 * Read a web page's article out of its bytes: what `markdownOfHtml` keeps
 * of it, rendered as any markdown is, so nothing of the page itself runs or
 * loads. Its markup is not what anyone saved it for.
 *
 * @param {Blob} file
 */
const readPage = async file => {
  const text = markdownOfHtml(await file.text())
  if (text) reading.value = renderMarkdown(text)
  else unreadable.value = 'This page has no text to show.'
}

watch(() => props.documentId, load, { immediate: true })
onBeforeUnmount(release)

/** Hand the writer the file back, named as it came in. */
const download = () => {
  if (blob.value && document.value) downloadBlob(blob.value, filenameFor(document.value))
}

/**
 * @type {import('vue').Ref<{
 *   openFind: () => boolean,
 *   showMatch: (text: string, options: import('@/editor/search.js').SearchOptions, index: number) => void,
 * }|null>}
 */
const codeView = ref(null)

/** @type {import('vue').Ref<{ showPage: (number: number) => void }|null>} */
const pdfView = ref(null)

// A match the project's search picked in this file, once there is a view to
// show it: code opens its find on it, and a PDF shows the page its text has
// it on. Anything else leaves it for the file's text, if that is opened.
watch(
  [kind, codeView, pdfView, goneTo],
  () => {
    const shows = kind.value === 'code' ? codeView.value : kind.value === 'pdf' && pdfView.value
    const match = shows ? takeUpMatch(props.documentId) : null
    if (!match) return
    if (kind.value === 'code') codeView.value?.showMatch(match.query, match.options, match.index)
    else pdfView.value?.showPage(pageAt(document.value?.content || '', match.at ?? 0) ?? 1)
  },
  { flush: 'post' }
)

/** Whether there is a find to open: in code, which has one of its own. */
const findable = computed(() => kind.value === 'code')

/** Open the code's find, where the file is shown as code. */
const openFind = () => codeView.value?.openFind() ?? false

defineExpose({ findable, openFind })
</script>
