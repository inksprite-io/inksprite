<template>
  <div
    ref="treeEl"
    class="w-full h-full flex flex-col relative"
    data-document-tree
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <!-- The projects behind a menu at the start, out of the way: switching is
         rare. The buttons at the end are this project's, at its top. -->
    <PanelHeader title="Outline">
      <template #start>
        <ProjectMenu :story-id="storyId" :project-items="projectMenuItems" />
      </template>
      <HeaderButton
        icon="pi pi-upload"
        label="Import"
        aria-haspopup="true"
        aria-controls="outline_import_menu"
        data-action="import"
        @click="importMenu?.toggle($event)"
      />
      <HeaderButton
        icon="pi pi-plus"
        label="New document"
        data-action="new-document"
        @click="rootNode?.createChild('text')"
      />
      <Menu id="outline_import_menu" ref="importMenu" :model="importMenuItems" :popup="true" />
    </PanelHeader>

    <ScrollPanel class="flex-1 min-h-0 overflow-auto overflow-x-hidden">
      <div class="p-2 pb-[10rem]" role="tree" aria-label="Documents" @contextmenu="openRootMenu">
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
          @import-drive="openDriveDialog"
          @import-repository="openRepositoryDialog($event, null)"
          @refresh-repository="openRepositoryDialog(null, $event)"
          @chat-with="startCardChat"
          @reimport="reimportCard"
          @convert="convertDocument"
          @explore="exploreFolder"
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

    <TrashDialog v-model:visible="showTrash" :story-id="storyId" />
    <RepositoryDialog
      ref="repositoryDialog"
      v-model:visible="showRepositoryDialog"
      :story-id="storyId"
      :parent-id="repositoryParentId"
      :refresh-id="repositoryRefreshId"
    />
    <DriveImportDialog v-if="driveOffered" ref="driveDialog" :story-id="storyId" />
    <CardImportDialog v-model:visible="showCardDialog" :found="found" @confirm="importCard" />
    <CardChatDialog
      v-model:visible="showCardChatDialog"
      :card="pendingCard"
      :last-user-name="lastUserName"
      @confirm="openCardChat"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import Menu from 'primevue/menu'
import ScrollPanel from 'primevue/scrollpanel'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import DocumentNode from './DocumentNode.vue'
import CardImportDialog from './CardImportDialog.vue'
import CardChatDialog from './CardChatDialog.vue'
import RepositoryDialog from './RepositoryDialog.vue'
import DriveImportDialog from './DriveImportDialog.vue'
import { importItems } from './importItems.js'
import HeaderButton from '../layout/HeaderButton.vue'
import PanelHeader from '../layout/PanelHeader.vue'
import ProjectMenu from '../projects/ProjectMenu.vue'
import TrashDialog from '../projects/TrashDialog.vue'
import { useTrash } from '@/composables/useTrash.js'
import { useExport } from '@/composables/useExport.js'
import { useCardChat } from '@/composables/useCardChat'
import { useBulkImport, describeImport } from '@/composables/useBulkImport'
import { useCardImport, NotACardError } from '@/composables/useCardImport'
import { useDocuments } from '@/composables/useDocuments'
import { undoKeyOf, useTreeHistory } from '@/composables/useTreeHistory.js'
import { useProjects } from '@/composables/useProjects'
import { useCloudSync } from '@/composables/useCloudSync.js'
import { useReveal } from '@/composables/useReveal.js'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'
import { sharing } from '@/cloud/people.js'
import { useJobs } from '@/composables/useJobs.js'
import { useJobsToast } from '@/composables/useJobsToast.js'
import { askToExplore } from '@/composables/useExplore.js'
import { requestsFor } from '@/jobs/index.js'
import {
  carriesFiles,
  folderOf,
  gatherFiles,
  listDropped,
  listFiles,
  withoutJunk,
} from '@/files/batch.js'
import { entriesOfFolder } from '@/source/gather.js'
import { looksLikeCodebase } from '@/source/detect.js'
import { repositoryOf } from '@/source/tree.js'
import { driveAvailable } from '@/drive/config.js'
import { mayHoldProject, packageOfFolder, packageOfZip } from '@/scrivener/package.js'
import { openProject, writeProject } from '@/scrivener/project.js'
import { useStoriesStore } from '@/stores/storiesStore'
import { rootIdFor } from '@/stores/migrations/projectTree.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { useCardLibraryPanel } from '@/composables/useCardLibraryPanel.js'

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
const projects = useProjects()
const api = useDocuments(props.storyId)
const { exportDocument } = useExport(props.storyId)

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

const trash = useTrash(props.storyId)
/** Sync, where a project can be kept on this device only, or shared. */
const cloud = useCloudSync()
const showTrash = ref(false)
/** The project's settings, its sharing among them, are the settings' Project section. */
const settingsPanel = useSettingsPanel()
const { revealItem } = useReveal()

/** Whether the project was shared with this account, by someone else. */
const sharedWithMe = computed(() => sharing.value.projects[props.storyId]?.role === 'member')

const cards = useCardImport(props.storyId)
const { roleplay } = useApplicationState()
const { open: openCardLibrary } = useCardLibraryPanel()
const bulk = useBulkImport(props.storyId)
const cardChats = useCardChat(props.storyId)
/** @type {import('vue').Ref<any>} */
const cardInput = ref(null)
/** @type {import('vue').Ref<any>} */
const folderInput = ref(null)

const showRepositoryDialog = ref(false)
/** Where a new repository goes. @type {import('vue').Ref<string|null>} */
const repositoryParentId = ref(null)
/** The repository being refreshed, when that is what the dialog is for. @type {import('vue').Ref<string|null>} */
const repositoryRefreshId = ref(null)
/** @type {import('vue').Ref<any>} */
const repositoryDialog = ref(null)

/**
 * @param {string|null} parentId - The folder to import a repository into
 * @param {string|null} refreshId - Or the repository to refresh
 */
const openRepositoryDialog = (parentId, refreshId) => {
  repositoryParentId.value = parentId
  repositoryRefreshId.value = refreshId
  showRepositoryDialog.value = true
}
/** Whether this build can import from Drive here; the dialog is not made otherwise. */
const driveOffered = driveAvailable()
/** @type {import('vue').Ref<any>} */
const driveDialog = ref(null)

/**
 * Called within the menu's click, which is what lets the dialog open
 * Google's sign-in straight away.
 *
 * @param {string} folderId
 */
const openDriveDialog = folderId => driveDialog.value?.open(folderId)
const showCardDialog = ref(false)
/** @type {import('vue').Ref<import('@/composables/useCardImport.js').Found|null>} */
const found = ref(null)
/** The folder the card was asked for on, which is where it lands. */
const importInto = ref(null)

const showCardChatDialog = ref(false)
/** @type {import('vue').Ref<import('@/cards/chat.js').CardChat|null>} */
const pendingCard = ref(null)
const lastUserName = ref('')

/**
 * Start a chat on a card, once the writer has said who they are in it, and
 * which greeting opens it when there is more than one.
 *
 * @param {string} folderId
 */
const startCardChat = async folderId => {
  const card = await cardChats.read(folderId)
  if (!card) return
  lastUserName.value = cardChats.lastUserName()
  pendingCard.value = card
  showCardChatDialog.value = true
}

/**
 * @param {{userName: string, greeting: number}} answers
 */
const openCardChat = async ({ userName, greeting }) => {
  const card = pendingCard.value
  showCardChatDialog.value = false
  if (!card) return

  try {
    const chat = await cardChats.start(card, { userName, greeting })
    emit('select-chat', chat.id)
  } catch (error) {
    toast.add({
      severity: 'error',
      detail: `The chat couldn't start. ${error.message}`,
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
  const scrivener = await scrivenerIn([{ file, folders: [] }])
  if (scrivener) return importScrivener(scrivener, importInto.value)
  await readOne(file)
}

/**
 * One file chosen alone: looked at, and asked about when there is something
 * to ask.
 *
 * @param {File} file
 */
const readOne = async file => {
  try {
    // With Roleplay off a card is read as a file, and imports as one.
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
      detail: `Nothing was imported. ${error.message}`,
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
  await importListed(listFiles(files), importInto.value)
}

/**
 * Import what was chosen or dropped. A Scrivener project comes in as one. A
 * folder that looks like a codebase is asked about first, since it can come
 * in as a repository instead. Closing the question imports nothing.
 *
 * @param {import('@/files/batch.js').Gathered[]} listed
 * @param {string|null} parentId - Where it goes; the project's top when null
 */
const importListed = async (listed, parentId) => {
  const scrivener = await scrivenerIn(listed)
  if (scrivener) return importScrivener(scrivener, parentId)

  const folder = folderOf(listed)
  const paths = entriesOfFolder(listed).entries.map(entry => entry.path)
  if (!folder || !looksLikeCodebase(paths)) return importBatch(withoutJunk(listed), parentId)

  confirm.require({
    header: 'Import as a repository?',
    message: `${folder} looks like a codebase.`,
    icon: 'pi pi-code',
    rejectProps: { label: 'Import as files', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Import as repository' },
    accept: () => importRepository(listed, parentId),
    reject: () => importBatch(withoutJunk(listed), parentId),
  })
}

/**
 * The Scrivener project in what was chosen or dropped, when there is one: a
 * `.scriv` folder, or a file on its own that holds one, such as a `.scriv`
 * the browser zipped when it was chosen.
 *
 * @param {import('@/files/batch.js').Gathered[]} listed
 * @returns {Promise<import('@/scrivener/package.js').ScrivenerPackage|null>}
 */
const scrivenerIn = async listed => {
  const folder = packageOfFolder(listed)
  if (folder) return folder
  const [only] = listed
  return listed.length === 1 && mayHoldProject(only.file) ? packageOfZip(only.file) : null
}

/**
 * Write a Scrivener project into a folder named after it, saying what didn't
 * come in. One that cannot be read writes nothing, and says why.
 *
 * @param {import('@/scrivener/package.js').ScrivenerPackage} pack
 * @param {string|null} parentId - Where it goes; the project's top when null
 */
const importScrivener = async (pack, parentId) => {
  let project
  try {
    project = await openProject(pack)
  } catch (error) {
    toast.add({ severity: 'error', detail: `Nothing was imported. ${error.message}`, life: 6000 })
    return
  }
  const result = await writeProject(props.storyId, project, {
    parentId: parentId || undefined,
    asFolder: true,
  })
  tellImport(result)
}

/**
 * Hand a folder to the repository dialog, which imports it saying how it
 * goes, with a Stop.
 *
 * @param {import('@/files/batch.js').Gathered[]} listed
 * @param {string|null} parentId
 */
const importRepository = async (listed, parentId) => {
  openRepositoryDialog(parentId, null)
  await nextTick()
  await repositoryDialog.value?.importListed(listed)
}

/**
 * Write a batch. The tree fills in as the files land, which is the progress
 * bar; what didn't come in is said at the end.
 *
 * @param {import('@/files/batch.js').Gathered[]} gathered
 * @param {string|null} parentId - Where it goes; the project's top when null
 */
const importBatch = async (gathered, parentId) => {
  if (gathered.length === 0) return
  tellImport(await bulk.importMany(gathered, { parentId: parentId || undefined }))
}

/**
 * Say what a batch left out, or brought in that the outline doesn't show.
 * One that all came in says nothing.
 *
 * @param {import('@/composables/useBulkImport.js').Imported} result
 */
const tellImport = result => {
  const said = describeImport(result)
  if (said) toast.add({ ...said, life: said.severity === 'info' ? 5000 : 10000 })
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
  // A drop on a document lands in its folder, past any document holding it.
  while (document && !api.isFolder(document)) document = api.get(document.parentId)
  // Nothing is imported into a repository; a drop on one lands beside it.
  const repository = repositoryOf(api.get, document)
  if (repository) document = api.get(repository.parentId) || root.value
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
  await importListed(await listDropped(event.dataTransfer), target.id)
}

const jobs = useJobs()
const jobsToast = useJobsToast()

/**
 * Turn a document's text into Markdown with a model, as a long job. Asked
 * first, with the size of it: a book is many requests. The Markdown is a
 * new document under it; the document itself is left as it is.
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
    message: `${words.toLocaleString()} words, about ${requests} ${requests === 1 ? 'request' : 'requests'}. The Markdown goes in a new document under it.`,
    icon: 'pi pi-sparkles',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Convert' },
    accept: async () => {
      try {
        await jobs.convert(props.storyId, documentId)
        jobsToast.show()
      } catch (error) {
        toast.add({
          severity: 'error',
          detail: `The conversion couldn't start. ${error.message}`,
          life: 6000,
        })
      }
    },
  })
}

/**
 * Describe what a folder holds for the model, or the whole project, as a
 * long job, on the model a new chat would run on. One that reads a lot is
 * asked about first, with how much.
 *
 * @param {string} folderId
 */
const exploreFolder = async folderId => {
  try {
    await askToExplore(props.storyId, folderId, { require: confirm.require })
  } catch (error) {
    toast.add({
      severity: 'error',
      detail: `Exploring couldn't start. ${error.message}`,
      life: 6000,
    })
  }
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
      detail: `Nothing was imported. ${error.message}`,
      life: 6000,
    })
  }
}

/**
 * @param {{useSystemPrompt: boolean}} answers
 */
const importCard = async answers => {
  const card = found.value
  showCardDialog.value = false
  if (!card) return

  try {
    const written = await cards.write(card, { parentId: importInto.value, ...answers })
    // The outline shows what came in. A scan it doesn't show: a model can't
    // read one.
    if (written.scan) {
      toast.add({
        severity: 'info',
        detail: `${written.title} is a PDF with no extractable text.`,
        life: 5000,
      })
    }
  } catch (error) {
    toast.add({
      severity: 'error',
      detail: `Nothing was imported. ${error.message}`,
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

/** @type {import('vue').Ref<any>} */
const importMenu = ref(null)

/** The Import at the top of the outline: what the project's own Import offers. */
const importMenuItems = computed(() => {
  const id = root.value?.id
  if (!id) return []
  return importItems({
    files: () => chooseCard(id),
    folder: () => chooseFolder(id),
    card: roleplay.value ? () => openCardLibrary({ into: id }) : null,
    drive: () => openDriveDialog(id),
    repository: () => openRepositoryDialog(id, null),
  })
})

/**
 * Opening is the layout's to handle: it makes the document the one the story
 * remembers, and shows the editor if it was hidden.
 *
 * @param {string} documentId
 */
const openDocument = documentId => emit('open', documentId)

/** Move the project to the trash, without asking: it can be restored from there. */
const trashProject = async () => {
  if (!storiesStore.getStory(props.storyId)) return
  try {
    await projects.trash(props.storyId)
    router.push('/')
  } catch (error) {
    console.error('Failed to move the project to the trash:', error)
    toast.add({
      severity: 'error',
      detail: "The project couldn't be moved to the trash.",
      life: 6000,
    })
  }
}

/**
 * Whether a project is out of sync here: kept on this device by the writer,
 * or by another device to itself and then brought back out of the trash here.
 * @param {any} story
 */
const keptOffSync = story => Boolean(story?.syncOff || story?.keptElsewhere)

/** Keep the project on this device only, once the writer has said so. */
const confirmKeepHere = () => {
  const name = api.displayTitle(root.value)
  confirm.require({
    message: `Keep “${name}” on this device only? It leaves the sync server, and your other devices move it to their trash.`,
    header: 'Keep on this device only',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Keep here only' },
    accept: async () => {
      try {
        await cloud.keepOnThisDevice(props.storyId)
      } catch (error) {
        toast.add({ severity: 'error', detail: error.message, life: 6000 })
      }
    },
  })
}

/** Leave a project shared with this account, once the writer has said so. */
const confirmLeave = () => {
  const name = api.displayTitle(root.value)
  confirm.require({
    message: `Leave “${name}”? It goes to your trash and stops syncing. Only its owner can share it with you again.`,
    header: 'Leave project',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Leave', severity: 'danger' },
    accept: async () => {
      try {
        await cloud.leaveProject(props.storyId)
        router.push('/')
      } catch (error) {
        toast.add({ severity: 'error', detail: error.message, life: 6000 })
      }
    },
  })
}

/** Sync the project again, having kept it on this device only. */
const syncAgain = async () => {
  try {
    await cloud.syncProjectAgain(props.storyId)
  } catch (error) {
    toast.add({ severity: 'error', detail: error.message, life: 6000 })
  }
}

/** What can be done to the project: on the root's menu, and under Projects in the header. */
const projectMenuItems = computed(() => [
  {
    label: 'Project settings',
    icon: 'pi pi-cog',
    command: () => settingsPanel.open('project'),
  },
  // As it would be published; a backup is in the settings.
  {
    label: 'Export project',
    icon: 'pi pi-download',
    command: () => exportDocument(rootIdFor(props.storyId)),
  },
  // In the desktop app, the project's folder.
  ...[root.value && revealItem(root.value.id)].filter(item => Boolean(item)),
  // Signed in to sync: shared, kept on this device, or synced again. One
  // shared with this account is its owner's to keep off.
  ...(cloud.account.value
    ? keptOffSync(storiesStore.getStory(props.storyId))
      ? [{ label: 'Sync this project', icon: 'pi pi-cloud-upload', command: () => syncAgain() }]
      : [
          {
            label: sharedWithMe.value ? 'People…' : 'Share…',
            icon: 'pi pi-users',
            command: () => settingsPanel.open('project', 'sharing'),
          },
          ...(sharedWithMe.value
            ? []
            : [
                {
                  label: 'Keep on this device only…',
                  icon: 'pi pi-cloud',
                  command: () => confirmKeepHere(),
                },
              ]),
        ]
    : []),
  ...(trash.count.value > 0
    ? [
        {
          label: 'Trash',
          icon: 'pi pi-trash',
          command: () => {
            showTrash.value = true
          },
        },
      ]
    : []),
  // Only its owner deletes a project shared; the others leave it.
  sharedWithMe.value
    ? { label: 'Leave project…', icon: 'pi pi-sign-out', command: () => confirmLeave() }
    : { label: 'Delete project', icon: 'pi pi-trash', command: () => trashProject() },
])

const history = useTreeHistory(props.storyId)
/** @type {import('vue').Ref<HTMLElement|null>} */
const treeEl = ref(null)

/**
 * Show the writer the document a step was taken on, and give its row the
 * keys, when it is on screen.
 * @param {string} documentId
 */
const focusRow = documentId =>
  nextTick(() =>
    /** @type {HTMLElement|null|undefined} */ (
      treeEl.value?.querySelector(`[role="treeitem"][data-document-id="${documentId}"]`)
    )?.focus()
  )

/**
 * Take a step back, or do it again. One whose document has changed since
 * does nothing.
 * @param {'undo'|'redo'} way
 */
const take = way => {
  const taken = history[way]()
  if (taken?.done) focusRow(taken.documentId)
}

/**
 * Undo the last thing done in the outline. A document made goes to the
 * trash, with whatever has been written in it since, and a redo brings it
 * back.
 * @returns {boolean} Whether there was anything to undo
 */
const undo = () => {
  if (!history.nextUndo()) return false
  take('undo')
  return true
}

/** @returns {boolean} Whether there was anything to redo */
const redo = () => {
  if (!history.nextRedo()) return false
  take('redo')
  return true
}

/**
 * Command-Z and Shift-Command-Z, while the writer is in the outline, or on
 * nothing else: a delete takes away the row that had the focus, and a click
 * on the space under the rows focuses the split the outline is in. A field
 * keeps the keys for its own text, the editor and the rename among them.
 * @param {KeyboardEvent} event
 */
const onKeyDown = event => {
  const key = undoKeyOf(event)
  const tree = treeEl.value
  if (!key || event.defaultPrevented || !tree || tree.getClientRects().length === 0) return
  const focused = /** @type {HTMLElement|null} */ (document.activeElement)
  const here = !focused || focused.contains(tree) || tree.contains(focused)
  if (!here || focused?.closest?.('input, textarea, select, [contenteditable="true"]')) return
  if (key === 'undo' ? undo() : redo()) event.preventDefault()
}

onMounted(() => {
  api.init()
  document.addEventListener('keydown', onKeyDown)
})
onBeforeUnmount(() => document.removeEventListener('keydown', onKeyDown))
</script>
