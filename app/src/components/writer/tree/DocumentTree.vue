<template>
  <div
    class="w-full h-full flex flex-col relative"
    data-document-tree
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <ScrollPanel class="flex-1 min-h-0 overflow-auto overflow-x-hidden">
      <div
        class="p-2 pt-4 pb-[10rem]"
        role="tree"
        aria-label="Documents"
        @contextmenu="openRootMenu"
      >
        <DocumentNode
          v-if="root"
          ref="rootNode"
          :story-id="storyId"
          :document-id="root.id"
          :active-document-id="documentId"
          :chat-id="chatId"
          :is-dragging="isDragging"
          :extra-menu-items="projectMenuItems"
          :can-delete="false"
          @open="openDocument"
          @import="chooseCard"
          @import-folder="chooseFolder"
          @chat-with="startCardChat"
          @reimport="reimportCard"
          @convert="convertDocument"
          @dragging="isDragging = $event"
        />
      </div>
    </ScrollPanel>

    <!-- Where files being dragged in from the desktop would land. -->
    <div
      v-if="dropTarget"
      class="pointer-events-none absolute inset-2 rounded border-2 border-dashed border-primary-500 bg-primary-500/10 flex items-start justify-center pt-2"
      data-drop-hint
    >
      <span
        class="max-w-[90%] truncate px-3 py-1 rounded bg-surface-0 dark:bg-surface-900 text-sm text-surface-700 dark:text-surface-200 shadow"
      >
        Drop to import into {{ dropTarget.title }}
      </span>
    </div>

    <!-- Anything: a card, a lorebook, a markdown file, or a file to keep as
         it is — a PDF, an image. What it is gets decided by looking at it.
         Several at once go in as a batch; a folder goes in with its folders. -->
    <input ref="cardInput" type="file" class="hidden" multiple @change="readChosenCard" />
    <input
      ref="folderInput"
      type="file"
      class="hidden"
      webkitdirectory
      @change="readChosenFolder"
    />

    <ProjectDialog v-model:visible="showProjectDialog" :story-id="storyId" />
    <CardImportDialog v-model:visible="showCardDialog" :found="found" @confirm="importCard" />
    <GreetingDialog
      v-model:visible="showGreetingDialog"
      :greetings="pendingCard?.greetings || []"
      @confirm="openCardChat"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import ScrollPanel from 'primevue/scrollpanel'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import DocumentNode from './DocumentNode.vue'
import ProjectDialog from './ProjectDialog.vue'
import CardImportDialog from './CardImportDialog.vue'
import GreetingDialog from './GreetingDialog.vue'
import { useCardChat } from '@/composables/useCardChat'
import { useBulkImport, describeImport } from '@/composables/useBulkImport'
import { useCardImport, NotACardError } from '@/composables/useCardImport'
import { useDocuments } from '@/composables/useDocuments'
import { useJobs } from '@/composables/useJobs.js'
import { useJobsToast } from '@/composables/useJobsToast.js'
import { requestsFor } from '@/jobs/index.js'
import { carriesFiles, gatherDropped, gatherFiles } from '@/files/batch.js'
import { useStoriesStore } from '@/stores/storiesStore'

const props = defineProps({
  storyId: { type: String, required: true },
  documentId: { type: String, default: null },
  /** The chat a document is pinned to, when one is open. */
  chatId: { type: String, default: null },
})

const emit = defineEmits(['open', 'select-chat'])

const router = useRouter()
const toast = useToast()
const confirm = useConfirm()
const storiesStore = useStoriesStore()
const api = useDocuments(props.storyId)

/** @type {import('vue').Ref<any>} */
const rootNode = ref(null)

/**
 * The space under the last document is the project. Right-clicking it offers
 * the project's own menu — the node's, not a copy of it, so the two can never
 * drift apart.
 *
 * Only the space: a right-click that landed on a document has already been
 * answered by that document's menu, and this would put a second one over it.
 *
 * @param {MouseEvent} event
 */
const openRootMenu = event => {
  if (/** @type {HTMLElement} */ (event.target).closest('[role="treeitem"]')) return
  event.preventDefault()
  rootNode.value?.showContextMenu(event)
}

const isDragging = ref(false)
const showProjectDialog = ref(false)

const cards = useCardImport(props.storyId)
const bulk = useBulkImport(props.storyId)
const cardChats = useCardChat(props.storyId)
/** @type {import('vue').Ref<any>} */
const cardInput = ref(null)
/** @type {import('vue').Ref<any>} */
const folderInput = ref(null)
const showCardDialog = ref(false)
/** @type {import('vue').Ref<import('@/composables/useCardImport.js').Found|null>} */
const found = ref(null)
/** The folder the card was asked for on, which is where it lands. */
const importInto = ref(null)

const showGreetingDialog = ref(false)
/** @type {import('vue').Ref<import('@/cards/chat.js').CardChat|null>} */
const pendingCard = ref(null)

/**
 * Start a chat on a card. One greeting opens straight away; more than one is a
 * question only askable now, so it is asked.
 *
 * @param {string} folderId
 */
const startCardChat = async folderId => {
  pendingCard.value = await cardChats.read(folderId)
  if (!pendingCard.value) return

  if (pendingCard.value.greetings.length > 1) {
    showGreetingDialog.value = true
    return
  }
  openCardChat(0)
}

/**
 * @param {number} greeting - Which one opens it
 */
const openCardChat = async greeting => {
  const card = pendingCard.value
  showGreetingDialog.value = false
  if (!card) return

  try {
    const chat = await cardChats.start(card, { greeting })
    emit('select-chat', chat.id)
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Could not start the chat',
      detail: error.message,
      life: 6000,
    })
  } finally {
    pendingCard.value = null
  }
}

/**
 * @param {string} documentId - The folder to import into
 */
const chooseCard = documentId => {
  importInto.value = documentId
  // Cleared so that choosing the same file twice still fires a change.
  if (cardInput.value) cardInput.value.value = ''
  cardInput.value?.click()
}

/**
 * @param {string} documentId - The folder to import a folder into
 */
const chooseFolder = documentId => {
  importInto.value = documentId
  if (folderInput.value) folderInput.value.value = ''
  folderInput.value?.click()
}

/**
 * Read what was chosen and say what is in it. Nothing is written until the
 * dialog is answered. Several files chosen together are a batch, which asks
 * nothing.
 *
 * @param {Event} event
 */
const readChosenCard = async event => {
  const files = /** @type {HTMLInputElement} */ (event.target).files
  if (!files || files.length === 0) return
  if (files.length > 1) return importBatch(gatherFiles(files), importInto.value)
  const file = files[0]

  try {
    const it = await cards.inspect(file)
    // A card has questions only askable now; a document has none, and a dialog
    // that asks nothing is a click for its own sake.
    if (it.asks) {
      found.value = it
      showCardDialog.value = true
      return
    }
    found.value = it
    await importCard({})
  } catch (error) {
    // A file with no card in it is the ordinary mistake — the wrong PNG — and
    // it is worth saying which rather than failing silently.
    toast.add({
      severity: error instanceof NotACardError ? 'warn' : 'error',
      summary: 'Nothing imported',
      detail: error.message,
      life: 6000,
    })
  }
}

/**
 * A folder chosen whole: every file under it, in the folders it came in.
 * @param {Event} event
 */
const readChosenFolder = async event => {
  const files = /** @type {HTMLInputElement} */ (event.target).files
  if (!files || files.length === 0) return
  await importBatch(gatherFiles(files), importInto.value)
}

/**
 * Write a batch and say how it went. The tree fills in as the files land,
 * which is the progress bar; the toast at the end is the tally.
 *
 * @param {import('@/files/batch.js').Gathered[]} gathered
 * @param {string|null} parentId - Where it goes; the project's top when null
 */
const importBatch = async (gathered, parentId) => {
  if (gathered.length === 0) return
  const result = await bulk.importMany(gathered, { parentId: parentId || undefined })
  toast.add({ ...describeImport(result), life: result.skipped.length > 0 ? 10000 : 5000 })
}

/**
 * The folder a drag from the desktop is over: the folder under the pointer,
 * a document's folder, or the project when it is over the space below.
 *
 * @type {import('vue').Ref<{id: string, title: string}|null>}
 */
const dropTarget = ref(null)
/** Enters and leaves nest as the drag crosses the rows; the zone is left at zero. */
let dragDepth = 0

/** @param {DragEvent} event */
const targetOf = event => {
  const row = /** @type {HTMLElement} */ (event.target).closest?.('[role="treeitem"]')
  const id = row?.getAttribute('data-document-id') || root.value?.id
  let document = id ? api.get(id) : null
  if (document && !api.isFolder(document)) document = api.get(document.parentId)
  return document ? { id: document.id, title: api.displayTitle(document) } : null
}

/** @param {DragEvent} event */
const onDragEnter = event => {
  if (!carriesFiles(event.dataTransfer)) return
  event.preventDefault()
  dragDepth++
  dropTarget.value = targetOf(event)
}

/** @param {DragEvent} event */
const onDragOver = event => {
  if (!carriesFiles(event.dataTransfer)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  const target = targetOf(event)
  if (target?.id !== dropTarget.value?.id) dropTarget.value = target
}

/** @param {DragEvent} event */
const onDragLeave = event => {
  if (!carriesFiles(event.dataTransfer)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dropTarget.value = null
}

/**
 * Files dropped from the desktop go into the folder they were dropped on.
 * A drag of a document within the tree is not this, and is left to the
 * rows.
 *
 * @param {DragEvent} event
 */
const onDrop = async event => {
  if (!carriesFiles(event.dataTransfer)) return
  event.preventDefault()
  dragDepth = 0
  const target = targetOf(event)
  dropTarget.value = null
  if (!event.dataTransfer || !target) return
  const gathered = await gatherDropped(event.dataTransfer)
  await importBatch(gathered, target.id)
}

const jobs = useJobs()
const jobsToast = useJobsToast()

/**
 * Turn a document's text into Markdown with a model, as a long job. Asked
 * first, with the size of it: a book is many requests. The Markdown is a
 * new document beside it; the document itself is left as it is.
 *
 * @param {string} documentId
 */
const convertDocument = documentId => {
  const document = api.get(documentId)
  if (!document) return
  const requests = requestsFor(document.content || '')
  const words = document.wordCount || 0
  confirm.require({
    header: 'Convert to Markdown?',
    message: `${words.toLocaleString()} words, about ${requests} ${requests === 1 ? 'request' : 'requests'}. The Markdown goes in a new document beside it.`,
    icon: 'pi pi-sparkles',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Convert' },
    accept: async () => {
      try {
        await jobs.convert(props.storyId, documentId)
        jobsToast.show()
      } catch (error) {
        toast.add({ severity: 'error', summary: 'Not started', detail: error.message, life: 6000 })
      }
    },
  })
}

/**
 * Read a card back out of its folder and ask the import's questions again,
 * for writing it there afresh: the card has stayed as it arrived in the
 * sidecar, and only the answers, and the edits since, are given up.
 *
 * @param {string} folderId - The card folder
 */
const reimportCard = async folderId => {
  try {
    found.value = await cards.inspectCard(folderId)
    importInto.value = null
    showCardDialog.value = true
  } catch (error) {
    toast.add({
      severity: error instanceof NotACardError ? 'warn' : 'error',
      summary: 'Nothing imported',
      detail: error.message,
      life: 6000,
    })
  }
}

/**
 * @param {{userName: string, useSystemPrompt: boolean}} answers
 */
const importCard = async answers => {
  const card = found.value
  showCardDialog.value = false
  if (!card) return

  try {
    const written = await cards.write(card, { parentId: importInto.value, ...answers })
    toast.add({
      severity: 'success',
      summary: `${card.replaces ? 'Re-imported' : 'Imported'} ${written.title}`,
      // A file has something to say about itself — that it had no text in it —
      // where a count would say nothing.
      detail:
        written.note ||
        (written.documents === 1 ? '1 document.' : `${written.documents} documents.`),
      life: 4000,
    })
  } catch (error) {
    toast.add({
      severity: 'error',
      summary: 'Nothing imported',
      detail: error.message,
      life: 6000,
    })
  } finally {
    found.value = null
  }
}

/**
 * The project root is a node like any other. Rendering it here rather than as a
 * separate header means its children sit inside the node's own drag list —
 * without that, the top level of the tree is where new documents land and the
 * one place nothing can be dragged out of.
 */
const root = computed(() => api.root.value)

/**
 * Opening is the layout's to handle: it makes the document the one the story
 * remembers, and shows the editor if it was hidden.
 *
 * @param {string} documentId
 */
const openDocument = documentId => emit('open', documentId)

const confirmDeleteProject = () => {
  if (!storiesStore.getStory(props.storyId)) return

  confirm.require({
    message: `Are you sure you want to delete "${api.displayTitle(root.value)}"? This action cannot be undone.`,
    header: 'Delete Project',
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      try {
        await storiesStore.deleteStory(props.storyId)
        toast.add({
          severity: 'success',
          summary: 'Success',
          detail: 'Project deleted',
          life: 3000,
        })
        router.push('/')
      } catch (error) {
        console.error('Failed to delete project:', error)
        toast.add({
          severity: 'error',
          summary: 'Error',
          detail: 'Failed to delete project',
          life: 3000,
        })
      }
    },
  })
}

/** Project-level actions, which hang off the root node rather than a header. */
const projectMenuItems = computed(() => [
  {
    label: 'Project settings',
    icon: 'pi pi-cog',
    command: () => {
      showProjectDialog.value = true
    },
  },
  { label: 'Delete project', icon: 'pi pi-trash', command: () => confirmDeleteProject() },
])

onMounted(() => api.init())
</script>
