<template>
  <div
    v-if="node"
    ref="nodeEl"
    class="rounded"
    :class="isDestination && 'bg-primary-500/10 dark:bg-primary-400/15'"
    :data-drop-target="isDestination || undefined"
    data-tree-node
  >
    <!-- Row. A tree item the keyboard can reach: one row in the tree is in
         the tab order — the document open, or the root — and the arrows move
         between the rest. See handleKeydown. The buttons on it are the
         mouse's, and out of the tab order: the arrows twist a folder, and the
         row is named by its title alone rather than by its buttons too. -->
    <div
      ref="rowEl"
      class="group relative flex items-center gap-1 py-1 pr-1 rounded cursor-pointer select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
      :class="[
        !isDragging && 'hover:bg-surface-200 dark:hover:bg-surface-700',
        isActive && 'bg-surface-200 dark:bg-surface-600',
      ]"
      :style="{ paddingLeft: `${depth * 12 + 4}px` }"
      role="treeitem"
      :tabindex="isTabStop ? 0 : -1"
      :aria-label="api.displayTitle(node)"
      :aria-level="depth + 1"
      :aria-selected="isActive"
      :aria-expanded="opens ? expanded : undefined"
      :data-document-id="documentId"
      :data-folder="isFolder || undefined"
      @pointerdown="notePointer"
      @click="handleClick"
      @dblclick="handleDoubleClick"
      @keydown="handleKeydown"
      @contextmenu="showContextMenu"
      @touchstart.passive="press.touchstart"
      @touchmove.passive="press.touchmove"
      @touchend="press.touchend"
      @touchcancel="press.touchend"
    >
      <!-- Twisty. A document has none, and no gap in its place: its icon is
           where a folder beside it has its twisty, so the two read as side
           by side. With a gap, a document lined up with the folder's icon
           instead, and looked to be inside the folder. A document that
           holds others has one, as a folder does. -->
      <button
        v-if="opens"
        class="flex-none w-4 h-4 flex items-center justify-center text-surface-500 dark:text-surface-400"
        tabindex="-1"
        :aria-label="expanded ? 'Collapse' : 'Expand'"
        @click.stop="toggleExpanded"
      >
        <i
          :class="expanded ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
          style="font-size: 0.6rem"
        />
      </button>

      <i
        class="flex-none text-surface-500 dark:text-surface-400"
        :class="
          working
            ? 'pi pi-spin pi-spinner'
            : isRepositoryFolder
              ? repositoryIcon
              : isFolder
                ? expanded
                  ? 'pi pi-folder-open'
                  : 'pi pi-folder'
                : leafIcon
        "
        style="font-size: 0.75rem"
        :title="working || undefined"
        data-node-icon
      />

      <InputText
        v-if="isRenaming"
        ref="renameInput"
        v-model="draftTitle"
        class="flex-1 min-w-0"
        size="small"
        :invalid="!!refusal"
        :aria-describedby="refusal ? `clash-${documentId}` : undefined"
        @update:model-value="refused = false"
        @keyup.enter="commitRename(true)"
        @keyup.escape="cancelRename(true)"
        @blur="commitRename(false)"
        @click.stop
        @contextmenu.stop
      />
      <span
        v-else
        class="flex-1 min-w-0 truncate text-sm"
        :class="[titleTone, dimmed && 'opacity-60']"
        :title="titleHint"
        data-title
        @mouseenter="measureTitle"
        >{{ api.displayTitle(node) }}</span
      >

      <!-- In a project shared with only some of its documents, what the
           people it is shared with see; faint on a folder they see only on
           the way to what is shared. -->
      <i
        v-if="shareMark"
        class="flex-none pi pi-users text-surface-400 dark:text-surface-500"
        :class="shareMark === 'partly' && 'opacity-50'"
        style="font-size: 0.65rem"
        :title="shareMark === 'shared' ? 'Shared' : 'Partly shared'"
        :data-share-mark="shareMark"
      />

      <!-- What the chat sees of a document is in the row itself: dimmed
           where the chat cannot see it, whichever folder decided that, and the
           title in the primary colour where the chat carries it. No icon at
           rest — a column of them said the same thing louder.

           The open chat's two toggles show on hover, and when the keyboard is
           on them; in the primary colour when on, since a mark is this chat's
           and not the document's. A pin taken from a folder above shows
           faintly, and is let go of here. Not on a phone, which has no hover:
           the menu has both there. They float over the end of the title, in
           the row's own colour, rather than keep room in every row for
           buttons that are not there at rest; and take no clicks until they
           show, so the end of a title is the title. Not during a drag, which
           WebKit leaves the hover on every row it crossed. -->
      <div
        v-if="toggles && !isMobile && !isDragging"
        class="absolute inset-y-0 right-1 flex items-center gap-1 pl-1 bg-inherit opacity-0 pointer-events-none transition-opacity group-hover:opacity-100 group-hover:pointer-events-auto focus-within:opacity-100 focus-within:pointer-events-auto"
        data-row-toggles
      >
        <button
          type="button"
          class="flex-none w-5 h-5 rounded flex items-center justify-center hover:bg-surface-300 dark:hover:bg-surface-600"
          :class="pin.showing ? 'text-primary-500' : 'text-surface-500 dark:text-surface-400'"
          tabindex="-1"
          :title="pin.hint"
          :aria-label="pin.label"
          :aria-pressed="pin.showing"
          data-toggle="pin"
          @click.stop="pin.toggle"
          @dblclick.stop
        >
          <i
            class="pi pi-thumbtack"
            :class="pin.showing && !pin.own && 'opacity-50'"
            style="font-size: 0.7rem"
          ></i>
        </button>
        <button
          v-if="!isRoot"
          type="button"
          class="flex-none w-5 h-5 rounded flex items-center justify-center hover:bg-surface-300 dark:hover:bg-surface-600"
          :class="sight.showing ? 'text-primary-500' : 'text-surface-500 dark:text-surface-400'"
          tabindex="-1"
          :title="sight.hint"
          :aria-label="sight.label"
          :aria-pressed="sight.showing"
          data-toggle="sight"
          @click.stop="sight.toggle"
          @dblclick.stop
        >
          <i :class="sight.icon" style="font-size: 0.7rem"></i>
        </button>
      </div>

      <!-- On a phone only. Everywhere else the menu is on right-click and on
           the menu key, and a button for it on every row was a row of them. A
           phone has a long press for it too, but nothing on the row says so. -->
      <template v-if="isMobile">
        <Button
          icon="pi pi-ellipsis-h"
          class="opacity-50"
          severity="secondary"
          text
          rounded
          size="small"
          aria-label="Actions"
          @click.stop="menu.toggle($event)"
        />
        <TieredMenu ref="menu" :model="menuItems" :popup="true" :pt="submenuWidth" />
      </template>
      <ContextMenu ref="contextMenu" :model="menuItems" :pt="submenuWidth" @hide="returnFocus" />
    </div>

    <p
      v-if="refusal"
      :id="`clash-${documentId}`"
      class="py-0.5 pr-1 text-xs text-red-600 dark:text-red-400"
      :style="{ paddingLeft: `${depth * 12 + (opens ? 40 : 20)}px` }"
      data-rename-clash
    >
      {{ refusal }}
    </p>

    <!-- Children -->
    <Draggable
      v-if="opens && expanded"
      v-model="childList"
      :group="{ name: 'documents' }"
      item-key="id"
      role="group"
      :data-folder-id="documentId"
      :style="{ '--tree-indent': `${(depth + 1) * 12 + 4}px` }"
      :sort="ordered"
      :delay-on-touch-only="true"
      :delay="120"
      :animation="200"
      :empty-insert-threshold="30"
      :move="onMove"
      @start="onDragStart"
      @end="onDragEnd"
    >
      <template #item="{ element: child }">
        <DocumentNode
          :story-id="storyId"
          :document-id="child.id"
          :active-document-id="activeDocumentId"
          :chat-id="chatId"
          :depth="depth + 1"
          :is-dragging="isDragging"
          @open="emit('open', $event)"
          @import="emit('import', $event)"
          @import-folder="emit('import-folder', $event)"
          @import-drive="emit('import-drive', $event)"
          @import-repository="emit('import-repository', $event)"
          @refresh-repository="emit('refresh-repository', $event)"
          @chat-with="emit('chat-with', $event)"
          @reimport="emit('reimport', $event)"
          @convert="emit('convert', $event)"
          @explore="emit('explore', $event)"
          @dragging="emit('dragging', $event)"
        />
      </template>
    </Draggable>
  </div>
</template>

<script setup>
/* global Blob */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Draggable from 'vuedraggable'
import Button from 'primevue/button'
import ContextMenu from 'primevue/contextmenu'
import InputText from 'primevue/inputtext'
import TieredMenu from 'primevue/tieredmenu'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import { importItems } from './importItems.js'
import { useCopyPath } from '@/composables/useCopyPath.js'
import { useReveal } from '@/composables/useReveal.js'
import { usePlainText } from '@/composables/usePlainText.js'
import { useFileView } from '@/composables/useFileView.js'
import { useJobs } from '@/composables/useJobs.js'
import { useVersionsPanel } from '@/composables/useVersions.js'
import { useChatSettings } from '@/composables/useChatSettings'
import { useApplicationState } from '@/composables/useApplicationState'
import { useCardLibraryPanel } from '@/composables/useCardLibraryPanel.js'
import { isCard } from '@/cards/chat.js'
import { chatVisibility, markOf, unpinned, withMark } from '@/utils/visibility.js'
import { useDocuments } from '@/composables/useDocuments'
import { useDriveSync } from '@/composables/useDriveSync.js'
import { useScreenSize } from '@/composables/useScreenSize'
import { useLongPress } from '@/composables/useLongPress.js'
import { OPEN_AFTER, useTreeDrop } from '@/composables/useTreeDrop.js'
import { useTreeHistory } from '@/composables/useTreeHistory.js'
import { useSharedDocuments } from '@/composables/useSharedDocuments.js'
import { useFilesStore } from '@/stores/filesStore'
import { useProjectViewsStore } from '@/stores/projectViewsStore.js'
import { downloadBlob, filenameFor } from '@/files/download.js'
import { exportDocument } from '@/files/exportDocument.js'
import { EPUB_MIME, hasText, isText } from '@/files/inspect.js'
import { inRepository, isRepository, repositoryOf } from '@/source/tree.js'
import { reextractFile } from '@/files/write.js'
import { isDesktop } from '@/platform/desktop.js'
import { openUrl } from '@/platform/open.js'

defineOptions({ name: 'DocumentNode' })

const props = defineProps({
  storyId: { type: String, required: true },
  documentId: { type: String, required: true },
  activeDocumentId: { type: String, default: null },
  /** The chat this document would be pinned to. Null when none is open. */
  chatId: { type: String, default: null },
  depth: { type: Number, default: 0 },
  isDragging: { type: Boolean, default: false },
  /** Appended to this node's menu, for actions that belong to what it represents. */
  extraMenuItems: { type: Array, default: () => [] },
  /** The project root is deleted by deleting the story, not as a document. */
  canDelete: { type: Boolean, default: true },
})

const emit = defineEmits([
  'open',
  'import',
  'import-folder',
  'import-drive',
  'import-repository',
  'refresh-repository',
  'chat-with',
  'reimport',
  'convert',
  'explore',
  'dragging',
])

const api = useDocuments(props.storyId)
// What the writer does here, to take back with Command-Z: see DocumentTree.
const history = useTreeHistory(props.storyId)
const { copyPath } = useCopyPath(props.storyId)
const { revealItem } = useReveal()
const { plainTextItem } = usePlainText(props.storyId)
const { fileViewItem } = useFileView(props.storyId)
const driveSync = useDriveSync(props.storyId)
const jobs = useJobs()
/** What a job running on this document is doing: the row spins while it does. */
const working = computed(() => {
  const job = jobs.runningOn(props.documentId)
  if (job) return job.kind === 'explore' ? 'Exploring' : 'Converting to Markdown'
  // A sync says nothing when it's done, so the row shows it running.
  return driveSync.isSyncing(props.documentId) ? 'Syncing with Google Docs' : ''
})
const confirm = useConfirm()
const versionsPanel = useVersionsPanel()
const toast = useToast()
const { isMobile } = useScreenSize()

const menu = ref()
const contextMenu = ref()
/** @type {import('vue').Ref<HTMLElement|null>} */
const nodeEl = ref(null)
/** @type {import('vue').Ref<HTMLElement|null>} */
const rowEl = ref(null)
// A submenu is as wide as the item it opens from, unless it is wider: its
// labels on one line each, not wrapped to the item's width.
const submenuWidth = { submenu: { class: 'w-max' } }

/**
 * Whether the menu was opened from the keyboard, which cannot reach the
 * row's toggles: they are the mouse's, and the menu offers what they do.
 */
const fromKeys = ref(false)

/**
 * Open this node's menu where the pointer is: a right-click, a long press, or
 * from outside it. The empty space under the tree is the project, and
 * right-clicking it should offer what right-clicking the project offers — the
 * same menu, not a second one built to look like it.
 *
 * @param {Event|{pageX: number, pageY: number, stopPropagation: () => void, preventDefault: () => void}} event
 */
const showContextMenu = event => {
  fromKeys.value = false
  openedAt = rowEl.value
  contextMenu.value?.show(event)
}

/**
 * The row the menu was opened from, to go back to when it shuts.
 * @type {HTMLElement|null}
 */
let openedAt = null

/**
 * A menu shut, by Escape, by an item or by a click away, gives the focus back
 * to its row, unless what was picked has taken it somewhere: a name to edit,
 * a dialog. Left alone, it fell to the page, and the next arrow went nowhere,
 * and the editor kept the caret it had before the right-click, and with it
 * Command-Z for the outline's last change.
 */
const returnFocus = () => {
  const row = openedAt
  openedAt = null
  if (!row) return
  setTimeout(() => {
    const focused = document.activeElement
    if (row.isConnected && (!focused || focused === document.body)) row.focus()
  })
}

/**
 * Open the menu from the keyboard, at the row: the menu is placed by the
 * event's page coordinates, and a key has none, so the row's are given.
 * @param {HTMLElement} row
 */
const showMenuAtRow = row => {
  const rect = row.getBoundingClientRect()
  fromKeys.value = true
  openedAt = row
  contextMenu.value?.show({
    pageX: rect.left + window.scrollX + 24,
    pageY: rect.bottom + window.scrollY,
    stopPropagation() {},
    preventDefault() {},
  })
}

/**
 * A finger held on the row opens its menu where the finger is, as a
 * right-click does under a mouse. Held and then moved, it is dragging the row,
 * and the menu goes again. See useLongPress.
 */
const press = useLongPress(
  ({ x, y }) =>
    showContextMenu({
      pageX: x + window.scrollX,
      pageY: y + window.scrollY,
      stopPropagation() {},
      preventDefault() {},
    }),
  () => contextMenu.value?.hide()
)

const renameInput = ref(null)
const isRenaming = ref(false)
const draftTitle = ref('')
/**
 * Whether this node's document was just created and is waiting to be named:
 * it is open in the editor already, and once it has a name the caret belongs
 * in it.
 */
const namingNew = ref(false)

const node = computed(() => api.get(props.documentId))

/**
 * What already goes by the name being typed. Two of one name in a folder is
 * one path for two documents, so the rename waits for another.
 */
const clash = computed(() => {
  const parentId = node.value?.parentId
  if (!isRenaming.value || !parentId || !draftTitle.value.trim()) return ''
  const other = api.namesakeOf(parentId, draftTitle.value.trim(), props.documentId)
  return other ? `“${api.displayTitle(other)}” is already in this folder` : ''
})
/** Whether Enter was refused for the name in the field, until it is changed. */
const refused = ref(false)
/** Said under the field once Enter is refused, not while the name is typed. */
const refusal = computed(() => (refused.value ? clash.value : ''))
const isFolder = computed(() => api.isFolder(node.value))
const isFile = computed(() => node.value?.type === 'file')
/**
 * A document that holds others, as an import may make one: a card's portrait
 * its fields, a PDF the Markdown converted from it. It opens as a document
 * does, and twists as a folder does, but takes nothing new: the writer
 * arranges what it holds, and moves it out, and that is all.
 */
const holdsOthers = computed(() => !isFolder.value && childList.value.length > 0)
/** Whether the row twists open on what is under it. */
const opens = computed(() => isFolder.value || holdsOthers.value)
/** What holds this one, as the row's marks say it: its folder, or the document it is under. */
const above = computed(() =>
  api.isFolder(api.get(node.value?.parentId ?? '')) ? 'folder' : 'document'
)
const isCardFolder = computed(() => isCard(node.value))

/**
 * A repository, or something in one. What is in a repository is read from
 * where it came from and settled against it again on a refresh, by path, so
 * nothing is made, moved or renamed in it here; the repository folder itself
 * can be renamed, and anything can be deleted, which a refresh puts back.
 */
const repository = computed(() => repositoryOf(api.get, node.value))
const isRepositoryFolder = computed(() => isRepository(node.value))
const isInRepository = computed(() => inRepository(api.get, node.value))

/** What a document that is not a folder is drawn as: a page, or the kind of file it is. */
const leafIcon = computed(() => {
  const mime = node.value?.mime || ''
  if (!isFile.value) return 'pi pi-file'
  if (mime === 'application/pdf') return 'pi pi-file-pdf'
  if (mime.startsWith('image/')) return 'pi pi-image'
  if (mime === EPUB_MIME) return 'pi pi-book'
  if (isInRepository.value) return 'pi pi-code'
  return 'pi pi-file'
})

/** A repository is drawn as where it came from. */
const repositoryIcon = computed(() =>
  node.value?.source?.from === 'github' ? 'pi pi-github' : 'pi pi-box'
)

/** Hand the writer the file back, named as it came in. */
const download = async () => {
  const document = node.value
  if (!document) return
  // A repository's file keeps no bytes; its text is the file.
  const blob =
    (await useFilesStore().getFile(document.id)) ||
    (isText(document.mime || '')
      ? new Blob([document.content || ''], { type: document.mime })
      : null)
  if (blob) downloadBlob(blob, filenameFor(document))
}

/**
 * Hand the writer a text document as it stands, edits not yet written out
 * and all: its markdown file, or with its pictures a `.zip` of the two.
 */
const exportText = async () => {
  const document = node.value
  if (!document) return
  const files = useFilesStore()
  const { blob, filename } = await exportDocument(document, api.currentContent(document.id), key =>
    files.getFile(key)
  )
  downloadBlob(blob, filename)
}

/**
 * Copy a text document beside itself, and open the copy, as making one does:
 * it is what the writer is about to work on.
 */
const duplicate = () => {
  const copy = api.duplicate(props.documentId)
  if (!copy) return
  history.created(copy.id, 'Duplicate')
  emit('open', copy.id)
}

/** Whether reading this file's bytes again could change its text. */
const extractable = computed(
  () => isFile.value && !isInRepository.value && hasText(node.value?.mime || '')
)

/**
 * Read the file's text out of its bytes again, in place of what is there. A
 * file whose bytes are gone is left as it is.
 */
const reextract = async () => {
  try {
    await reextractFile(props.storyId, props.documentId)
  } catch (error) {
    toast.add({
      severity: 'error',
      detail: `The text couldn't be read again. ${error.message}`,
      life: 6000,
    })
  }
}

/**
 * Ask before throwing away text: the extraction is the writer's to edit, and
 * this puts back what the file says. A file with no text yet has nothing to
 * lose, and is just read.
 */
const confirmReextract = () => {
  if (!api.currentContent(props.documentId).trim()) return void reextract()
  confirm.require({
    header: 'Re-extract text',
    message: `Read the text out of "${api.displayTitle(node.value)}" again? Edits to its text are lost.`,
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Re-extract' },
    accept: () => reextract(),
  })
}
const ordered = computed(() => api.isOrdered(props.documentId))
const hidden = computed(() => api.isHidden(props.documentId))
// The root is the project; hiding it would hide the name and overview the
// project block is built from, which is not a document going missing.
const isRoot = computed(() => props.documentId === api.root.value?.id)

const sharedDocuments = useSharedDocuments(props.storyId)
/** What the row says of who sees it, in a project shared with only some documents. */
const shareMark = computed(() => (isRoot.value ? null : sharedDocuments.markOf(props.documentId)))
const isActive = computed(() => props.activeDocumentId === props.documentId)

const { aiEnabled, roleplay } = useApplicationState()
const { open: openCardLibrary } = useCardLibraryPanel()

/**
 * The open chat, which the row's marks are for. None with the AI switched
 * off, when what the chats see is not the writer's concern.
 */
const chatId = computed(() => (aiEnabled.value ? props.chatId : null))

// The open chat can be the unstarted one, which has no row yet: its marks are
// kept with its other settings and go into the chat it becomes.
const { chat, update: updateChat } = useChatSettings(props.storyId, () => chatId.value || '')

/**
 * How the open chat reads the tree, or how every chat does when none is open.
 *
 * The reader caches what it settles, so it is made again when what it settled
 * on changes: the chat's marks, and the flag on this document and on each
 * folder above it. Read here so that a flag set while the row is showing
 * dims the row, rather than waiting for something else to make a new reader.
 */
const visibility = computed(() => {
  for (let above = node.value; above; above = above.parentId ? api.get(above.parentId) : null) {
    void above.hidden
  }
  return chatVisibility(chat.value, api.get)
})

/** Whether the model in the open chat can see this, whatever the reason. */
const seen = computed(() => !!node.value && visibility.value.sees(node.value))

/** Dimmed where the chat cannot see it, and never with the AI switched off. */
const dimmed = computed(() => aiEnabled.value && !seen.value)

/** Out of sight for every chat: its own flag, or a folder's above it. */
const hiddenEverywhere = computed(
  () => !!node.value && visibility.value.hiddenEverywhere(node.value)
)

/**
 * The open chat's mark on this document in its own right. What is under a
 * marked folder takes the folder's without carrying one, and changing it is
 * done on the folder — or by marking the document itself.
 */
const mark = computed(() => markOf(chat.value, props.documentId))

/**
 * Mark this document for the open chat, or take the mark off.
 *
 * @param {import('@/utils/visibility.js').ChatMark|null} next
 */
const markAs = next => {
  if (!chat.value) return
  updateChat(withMark(chat.value, props.documentId, next))
}

/**
 * Bring this document back into the open chat.
 *
 * Taking off a mark of its own is enough when nothing above hides it; under a
 * folder hidden in this chat — a character on the shelf the others are on —
 * it has to be shown in its own right.
 */
const showInChat = () => {
  const bare = withMark(chat.value, props.documentId, null)
  const clear = node.value && chatVisibility(bare, api.get).sees(node.value)
  markAs(clear ? null : 'shown')
}

/**
 * Take this document out of the open chat's sight. The reverse of showInChat:
 * a mark of its own comes off when a folder above hides it anyway, and goes
 * on when nothing does.
 */
const hideInChat = () => {
  const bare = withMark(chat.value, props.documentId, null)
  const clear = node.value && !chatVisibility(bare, api.get).sees(node.value)
  markAs(clear ? null : 'hidden')
}

/**
 * Whether the row offers the open chat's toggles: there is a chat, and this
 * is something it can mark. What every chat is kept from has nothing to
 * toggle — no chat can show it, and the block a pin rides in is the one it
 * is kept out of.
 */
const toggles = computed(() => !!chat.value && !hiddenEverywhere.value)

/** Whether the open chat carries this document on every turn, whoever pinned it. */
const carried = computed(
  () => seen.value && !!node.value && visibility.value.markFor(node.value) === 'pinned'
)

/**
 * The folders the document open is in, below the project: marked as it is,
 * so that the way back to it shows with them shut.
 */
const onActivePath = computed(() => isActive.value || (holdsActive.value && !isRoot.value))

/**
 * The title's colour: the primary colour where the chat carries the document,
 * which is the one thing the row says about the chat at rest, and otherwise
 * darker for the document open and the folders it is in than for the rest.
 */
const titleTone = computed(() => {
  const weight = onActivePath.value ? ' font-semibold' : ''
  if (carried.value) return `text-primary-600 dark:text-primary-400${weight}`
  return onActivePath.value
    ? `text-surface-900 dark:text-surface-0${weight}`
    : 'text-surface-700 dark:text-surface-200'
})

/** Whether the title is cut short in the row, as it was when the pointer last came over it. */
const truncated = ref(false)

/** @param {MouseEvent} event */
const measureTitle = event => {
  const title = /** @type {HTMLElement} */ (event.currentTarget)
  truncated.value = title.scrollWidth > title.clientWidth
}

/**
 * The title's tooltip: the whole title, where the row cuts it short, and
 * whether the chat carries the document. Nothing for a title shown whole in a
 * row the chat does not carry.
 */
const titleHint = computed(
  () =>
    [
      truncated.value ? api.displayTitle(node.value) : '',
      carried.value ? 'Pinned to this chat' : '',
    ]
      .filter(Boolean)
      .join('\n') || undefined
)

/** The mark that decides for the folder above, for telling a shown override from a let-go. */
const aboveMark = computed(() => {
  const parent = node.value?.parentId ? api.get(node.value.parentId) : null
  return parent ? visibility.value.markFor(parent) : null
})

/** The pin toggle: what it shows, and what a click does. */
const pin = computed(() => {
  if (!carried.value) {
    return {
      showing: false,
      own: false,
      label: 'Pin to this chat',
      hint: 'Pin to this chat',
      toggle: () => markAs('pinned'),
    }
  }
  const own = mark.value === 'pinned'
  return {
    showing: true,
    own,
    label: own ? 'Pinned to this chat' : `Pinned with the ${above.value} above`,
    hint: own
      ? 'Pinned to this chat. Click to unpin.'
      : `Pinned with its ${above.value}. Click to unpin this one.`,
    toggle: () => {
      if (chat.value && node.value) {
        updateChat(unpinned(chat.value, node.value, api.get))
      }
    },
  }
})

/**
 * The eye toggle: what it shows, and what a click does. A hide of its own
 * shows as the eye-slash that takes it off; a show of its own shows as an eye
 * only where it overrides a folder's hide, since under a pinned folder a show
 * is a let-go and not a matter of sight.
 */
const sight = computed(() => {
  if (mark.value === 'hidden') {
    return {
      showing: true,
      icon: 'pi pi-eye-slash',
      label: 'Hidden in this chat',
      hint: 'Hidden from this chat. Click to show.',
      toggle: showInChat,
    }
  }
  if (mark.value === 'shown' && aboveMark.value === 'hidden') {
    return {
      showing: true,
      icon: 'pi pi-eye',
      label: 'Shown in this chat',
      hint: `Shown, though its ${above.value} is hidden. Click to hide.`,
      toggle: hideInChat,
    }
  }
  if (!seen.value) {
    return {
      showing: false,
      icon: 'pi pi-eye',
      label: 'Unhide in this chat',
      hint: 'Show in this chat',
      toggle: showInChat,
    }
  }
  return {
    showing: false,
    icon: 'pi pi-eye-slash',
    label: 'Hide from this chat',
    hint: 'Hide from this chat',
    toggle: hideInChat,
  }
})
// The one row Tab lands on: the document open, or the root when none is.
const isTabStop = computed(() => isActive.value || (!props.activeDocumentId && isRoot.value))

/**
 * vuedraggable needs to write the reordered list back. The setter commits it,
 * which also reparents anything dragged in from another folder.
 */
const childList = computed({
  get: () => api.childrenOf(props.documentId),
  set: next =>
    api.reorder(
      props.documentId,
      next.map(child => child.id)
    ),
})

const projectViews = useProjectViewsStore()

// Folders start open: a collapsed tree on first load hides the whole story.
// Not in a repository, whose thousands of files would all be drawn at once;
// there a folder opens when it is asked to. A document that holds others
// starts shut, one row as the document it is. Once the writer opens or shuts
// one, it stays that way, kept with where they left the project.
const expanded = ref(
  projectViews.getView(props.storyId)?.expanded?.[props.documentId] ??
    (isFolder.value && !isInRepository.value)
)

const toggleExpanded = () => {
  expanded.value = !expanded.value
  const kept = projectViews.getView(props.storyId)?.expanded
  projectViews.updateView(props.storyId, {
    expanded: { ...kept, [props.documentId]: expanded.value },
  })
}

/** Whether the document open is somewhere under this row. */
const holdsActive = computed(() => {
  const id = props.activeDocumentId
  if (!id || id === props.documentId) return false
  for (let at = api.get(id); at; at = api.get(at.parentId)) {
    if (at.parentId === props.documentId) return true
  }
  return false
})

// A document that holds others opens when what is opened is under it, so
// that it has its row: a conversion's copy just made, or a scene opened from
// a search. Not kept: on the next load it is shut again, as it starts.
watch(
  () => props.activeDocumentId,
  () => {
    if (holdsOthers.value && holdsActive.value) expanded.value = true
  },
  { immediate: true }
)

const startRename = async () => {
  draftTitle.value = api.editableTitle(props.documentId)
  refused.value = false
  isRenaming.value = true
  await nextTick()
  renameInput.value?.$el?.focus()
  renameInput.value?.$el?.select()
}

/**
 * The rename is over: the name stands, or the old one does if nothing was
 * typed. A new document is then written in, when the writer ended the rename
 * themselves; a blur means they went somewhere else, and the focus stays there.
 *
 * A name something beside it has is not taken: Enter says so and leaves the
 * field open to change it, and leaving the field keeps the name it had.
 * @param {boolean} deliberate - Ended with a key rather than by leaving the field
 */
const commitRename = deliberate => {
  if (!isRenaming.value) return
  if (clash.value) {
    if (deliberate) refused.value = true
    else cancelRename(false)
    return
  }
  isRenaming.value = false

  const next = draftTitle.value.trim()
  // A new document's first name is part of making it, and goes back with it.
  if (next && next !== api.editableTitle(props.documentId)) {
    if (namingNew.value) api.rename(props.documentId, next)
    else history.rename(props.documentId, next)
  }
  settleNew(deliberate)
}

/** @param {boolean} deliberate */
const cancelRename = deliberate => {
  isRenaming.value = false
  settleNew(deliberate)
}

/**
 * Where the writer goes once a name is settled. A new document is written
 * in, in the editor. Anything else was renamed where it is, and the keys
 * go back to its row, for the arrows and for Command-Z. Deliberately ending
 * the rename means the writer is still here; a blur means they have moved
 * on.
 * @param {boolean} deliberate
 */
const settleNew = deliberate => {
  if (!namingNew.value) {
    if (deliberate) nextTick(() => rowEl.value?.focus())
    return
  }
  namingNew.value = false
  if (!deliberate || isFolder.value) return
  emit('open', props.documentId)
  api.focus(props.documentId)
}

/** How long a click on the open document's title waits to be a rename, in milliseconds. */
const RENAME_AFTER = 500

/** What last pressed on the row: a mouse, a pen, or a finger. */
let pointer = ''

/** @param {PointerEvent} event */
const notePointer = event => {
  pointer = event.pointerType
}

/** @type {ReturnType<typeof setTimeout>|null} */
let renaming = null

/** A rename a click was waiting to start is not wanted after all. */
const keepName = () => {
  if (renaming) clearTimeout(renaming)
  renaming = null
  document.removeEventListener('pointerdown', keepName, true)
  document.removeEventListener('keydown', keepName, true)
}

/**
 * Rename after a moment, as Finder does a click on the name of what is
 * already selected. Anything pressed in the meantime, the second click of a
 * double click among them, means something else was meant.
 */
const renameSoon = () => {
  keepName()
  renaming = setTimeout(() => {
    keepName()
    if (isActive.value && !isRenaming.value) startRename()
  }, RENAME_AFTER)
  document.addEventListener('pointerdown', keepName, true)
  document.addEventListener('keydown', keepName, true)
}

/**
 * Whether a click renames rather than opens: a single click with a mouse on
 * the title of the document already open. A finger on the open document has
 * only gone back to it.
 * @param {MouseEvent} event
 */
const renamesOnClick = event =>
  isActive.value &&
  !isInRepository.value &&
  pointer !== 'touch' &&
  event.detail === 1 &&
  event.button === 0 &&
  !(event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) &&
  !!(/** @type {HTMLElement} */ (event.target).closest?.('[data-title]'))

/** @param {MouseEvent} [event] - None from the keyboard */
const handleClick = event => {
  if (isRenaming.value) return
  // Clicking a folder twists it; clicking a document opens it, or names the
  // one already open.
  if (isFolder.value) toggleExpanded()
  else if (event && renamesOnClick(event)) renameSoon()
  else emit('open', props.documentId)
}

/**
 * Double-clicking a document keeps the tab the first click opened it in,
 * rather than leaving it a preview for the next click to replace.
 */
const handleDoubleClick = () => {
  keepName()
  if (isRenaming.value || isFolder.value) return
  api.keep(props.documentId)
}

/**
 * The rows on screen, in reading order. A collapsed folder's children are
 * not rendered, so every row found is one the writer can see.
 * @param {HTMLElement} row
 * @returns {HTMLElement[]}
 */
const visibleRows = row =>
  Array.from(row.closest('[role="tree"]')?.querySelectorAll('[role="treeitem"]') ?? [row])

/**
 * Keys on a row, the way a tree is expected to take them: Enter and Space do
 * what a click does, the arrows move and twist, F2 renames, and the menu key
 * opens the menu. Keys from inside the row — the rename field, the menu
 * button — are theirs, not the tree's.
 * @param {KeyboardEvent} event
 */
const handleKeydown = event => {
  if (event.target !== event.currentTarget || isRenaming.value) return
  const row = /** @type {HTMLElement} */ (event.currentTarget)
  /** @param {number} step */
  const move = step => {
    const rows = visibleRows(row)
    const next = rows[rows.indexOf(row) + step]
    if (next) next.focus()
  }

  switch (event.key) {
    case 'Enter':
    case ' ':
      handleClick()
      break
    case 'ArrowDown':
      move(1)
      break
    case 'ArrowUp':
      move(-1)
      break
    case 'ArrowRight':
      // Twist a folder open; open already, step into it.
      if (!opens.value) return
      if (expanded.value) move(1)
      else toggleExpanded()
      break
    case 'ArrowLeft': {
      // Twist a folder shut; shut already, or a document, step out to the parent.
      if (opens.value && expanded.value) {
        toggleExpanded()
        break
      }
      // Rows are not nested, nodes are: a folder's row and the list holding
      // its children are siblings inside the folder's node, so the parent
      // row is the row directly inside the node enclosing this one.
      const enclosing = row.closest('[data-tree-node]')?.parentElement?.closest('[data-tree-node]')
      const parent = /** @type {HTMLElement|undefined} */ (
        Array.from(enclosing?.children ?? []).find(
          child => child.getAttribute('role') === 'treeitem'
        )
      )
      if (parent) parent.focus()
      break
    }
    case 'Home':
      visibleRows(row)[0]?.focus()
      break
    case 'End':
      visibleRows(row).at(-1)?.focus()
      break
    case 'F2':
      startRename()
      break
    case 'ContextMenu':
      showMenuAtRow(row)
      break
    case 'F10':
      if (!event.shiftKey) return
      showMenuAtRow(row)
      break
    default:
      return
  }
  event.preventDefault()
}

/** @param {'folder'|'text'} type */
const createChild = type => {
  if (!expanded.value) toggleExpanded()

  const created =
    type === 'folder'
      ? api.createFolder(props.documentId, '')
      : api.createTextDocument(props.documentId, '')

  history.created(created.id)

  // A document is opened as it is made — creating one and then having to find
  // it is the worst of both — and the new node opens its own rename once it
  // mounts. The rename takes the focus; it goes back to the document after.
  if (type === 'text') api.open(created.id)
  api.requestRename(created.id)
}

// The outline asks the root for both: a right-click on the space below the
// tree, and New document at the top of it.
defineExpose({ showContextMenu, createChild })

/**
 * The row the keys go to once this one is gone: the next one on screen that
 * is not inside it, or else the one before.
 * @returns {HTMLElement|undefined}
 */
const rowAfter = () => {
  const row = rowEl.value
  if (!row) return undefined
  const rows = visibleRows(row)
  const at = rows.indexOf(row)
  return (
    rows.slice(at + 1).find(other => !nodeEl.value?.contains(other)) ?? rows.slice(0, at).at(-1)
  )
}

const moveToTrash = () => {
  // Without asking: it can be restored from there, and taken back with
  // Command-Z.
  const next = rowAfter()
  history.trash(props.documentId)
  nextTick(() => next?.focus())
}

/** Ask before taking a document's link to its Doc away: nothing links it again yet. */
const confirmUnlink = () => {
  const name = api.displayTitle(node.value)
  confirm.require({
    header: 'Unlink from Google Doc',
    message: `Unlink "${name}" from its Google Doc? Syncing it again will need the Doc imported again.`,
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Unlink' },
    accept: () => driveSync.unlink(props.documentId),
  })
}

const menuItems = computed(() => {
  /** @type {any[]} */
  const items = []

  if (isFolder.value && !repository.value) {
    items.push(
      { label: 'New document', icon: 'pi pi-file', command: () => createChild('text') },
      { label: 'New folder', icon: 'pi pi-folder', command: () => createChild('folder') },
      { separator: true },
      {
        label: ordered.value ? 'Sort by name' : 'Keep in order',
        icon: ordered.value ? 'pi pi-sort-alpha-down' : 'pi pi-sort-numeric-down',
        command: () => api.setOrdered(props.documentId, !ordered.value),
      }
    )
  } else {
    const plainText = plainTextItem(props.documentId)
    if (plainText) items.push(plainText)
    // A file: the file or its text in the panel, the text read again, and
    // the file as it came in.
    const fileView = fileViewItem(props.documentId)
    if (fileView) items.push(fileView)
    if (extractable.value) {
      items.push({ label: 'Re-extract text', icon: 'pi pi-refresh', command: confirmReextract })
    }
    if (isFile.value) items.push({ label: 'Download', icon: 'pi pi-download', command: download })
    // A text document goes out as markdown, which is what it is kept as, its
    // pictures with it, and can be copied to try something on.
    if (node.value?.type === 'text') {
      items.push(
        { label: 'Export', icon: 'pi pi-download', command: exportText },
        { label: 'Duplicate', icon: 'pi pi-clone', command: duplicate }
      )
      items.push({
        label: 'Versions…',
        icon: 'pi pi-history',
        command: () => versionsPanel.open(props.documentId),
      })
    }
    // One linked to a Google Doc syncs with it, and one linked to none can
    // go into a new one, from the click, which in a browser is what lets
    // Google's window open.
    if (driveSync.canSync(props.documentId)) {
      items.push({
        label: 'Google Doc',
        icon: 'pi pi-google',
        items: [
          {
            label: 'Sync',
            icon: 'pi pi-sync',
            disabled: driveSync.isSyncing(props.documentId),
            command: () => driveSync.sync(props.documentId),
          },
          {
            label: 'Open in Google Docs',
            icon: 'pi pi-external-link',
            command: () => openUrl(driveSync.docAddress(props.documentId) ?? ''),
          },
          { label: 'Unlink…', icon: 'pi pi-times', command: confirmUnlink },
        ],
      })
    } else if (driveSync.canSyncToNew(props.documentId)) {
      items.push({
        label: 'Sync to a new Google Doc',
        icon: 'pi pi-google',
        disabled: driveSync.isSyncing(props.documentId),
        command: () => driveSync.syncToNew(props.documentId),
      })
    }
    // A model puts the structure back into text that lost it — headings,
    // tables, paragraphs — which is a file's text, read out of it. A
    // document written here, or a conversion's own copy, has its structure.
    if (
      aiEnabled.value &&
      isFile.value &&
      !isInRepository.value &&
      (node.value?.content || '').trim()
    ) {
      items.push({
        label: 'Convert to Markdown…',
        icon: 'pi pi-sparkles',
        command: () => emit('convert', props.documentId),
      })
    }
  }

  if (!isInRepository.value) {
    items.push({ label: 'Rename', icon: 'pi pi-pencil', command: () => startRename() })
  }
  items.push(
    // The address the tools take, for naming the document to the assistant.
    { label: 'Copy path', icon: 'pi pi-copy', command: () => copyPath(props.documentId) }
  )
  // The project's own is with the project's items, which the root has too.
  const shown = isRoot.value ? null : revealItem(props.documentId)
  if (shown) items.push(shown)

  // A folder's goes for everything in it.
  if (sharedDocuments.active.value && !isRoot.value) {
    const unshared = sharedDocuments.sharingOf(props.documentId) !== 'shared'
    items.push({
      label: unshared ? 'Share' : 'Stop sharing',
      icon: unshared ? 'pi pi-users' : 'pi pi-user-minus',
      command: () => sharedDocuments.setShared(props.documentId, unshared),
    })
  }

  if (aiEnabled.value && !isRoot.value) {
    // From every chat, which the label says: the row button's hide is this
    // chat's, and on a phone the two are in this menu together. With the AI
    // switched off there are no chats to hide anything from.
    items.push({
      label: hidden.value ? 'Unhide in all chats' : 'Hide from all chats',
      icon: hidden.value ? 'pi pi-eye' : 'pi pi-eye-slash',
      command: () => api.setHidden(props.documentId, !hidden.value),
    })
  }

  // A card, a folder or a portrait holding its documents, has somebody in
  // it to talk to. First, because on a card it is the thing the writer came
  // to do. With roleplay switched off it is an ordinary folder or picture.
  if (isCardFolder.value && roleplay.value) {
    items.push({
      label: `Chat with ${api.displayTitle(node.value)}…`,
      icon: 'pi pi-comments',
      command: () => emit('chat-with', props.documentId),
    })
    // Written again from the card it holds, for another name or a fresh start.
    if (childList.value.some(child => child.kind === 'sidecar')) {
      items.push({
        label: 'Re-import card…',
        icon: 'pi pi-refresh',
        command: () => emit('reimport', props.documentId),
      })
    }
  }

  // A folder is where anything imported goes: files chosen together, or a
  // folder whole with the folders inside it. The tree owns the file choosers
  // and what they open; this only says where. Files can also be dropped on
  // the row from the desktop. The ways in share one submenu.
  if (isFolder.value && !repository.value) {
    items.push({
      label: 'Import',
      icon: 'pi pi-upload',
      items: importItems({
        files: () => emit('import', props.documentId),
        folder: () => emit('import-folder', props.documentId),
        card: roleplay.value ? () => openCardLibrary({ into: props.documentId }) : null,
        drive: () => emit('import-drive', props.documentId),
        repository: () => emit('import-repository', props.documentId),
      }),
    })
  }
  // A model describes what is in it, for the chats to find it by. Not a
  // codebase, which wants a description of its own, and not what is hidden
  // from the AI.
  if (aiEnabled.value && isFolder.value && !repository.value && !hiddenEverywhere.value) {
    items.push({
      label: 'Explore…',
      icon: 'pi pi-compass',
      command: () => emit('explore', props.documentId),
    })
  }
  // GitHub only answers the desktop app, so a repository from there can't be
  // read again in a browser; a folder is chosen again, which works anywhere.
  if (isRepositoryFolder.value && (isDesktop() || node.value?.source?.from !== 'github')) {
    items.push({
      label: 'Refresh repository…',
      icon: 'pi pi-refresh',
      command: () => emit('refresh-repository', props.documentId),
    })
  }

  // The open chat's own marks, so there is nothing to offer without one. A
  // document hidden from every chat has none to take: the block a pin would
  // ride in is the one it is being kept out of, and no chat can show it. On a
  // phone, and from the keyboard, only: everywhere else the row's toggles are
  // these, and a phone has no hover to find them by, nor the keys a Tab.
  if (chatId.value && !hiddenEverywhere.value && (isMobile.value || fromKeys.value)) {
    items.push({
      label: carried.value ? 'Unpin from chat' : 'Pin to chat',
      icon: 'pi pi-thumbtack',
      command: () => pin.value.toggle(),
    })
    if (!isRoot.value) {
      items.push(
        seen.value
          ? {
              label: 'Hide from this chat',
              icon: 'pi pi-eye-slash',
              command: () => hideInChat(),
            }
          : { label: 'Unhide in this chat', icon: 'pi pi-eye', command: () => showInChat() }
      )
    }
  }

  if (props.extraMenuItems.length > 0) items.push({ separator: true }, ...props.extraMenuItems)
  if (props.canDelete) {
    items.push(
      { separator: true },
      {
        label: 'Delete',
        icon: 'pi pi-trash',
        command: () => moveToTrash(),
      }
    )
  }

  return items
})

/**
 * Refuse a drop the tree won't take: a folder into its own subtree, anything
 * into a repository or out of one, or anything new into a document that
 * holds others, whose own it can only be put in order. Sortable asks the list
 * the drag started in, so the folder it would land in is read off the list it
 * is over. Nothing moves in a list while the drag is over a folder's row,
 * which is where the drop goes instead: see useTreeDrop.
 * @param {any} event
 */
const onMove = event => {
  if (!drop.allowsMove()) return false
  const draggedId = event.draggedContext?.element?.id
  const folderId = event.to?.dataset?.folderId
  if (!draggedId || !folderId) return true
  if (!api.isFolder(api.get(folderId)) && api.get(draggedId)?.parentId !== folderId) return false
  return api.canDropInto(folderId, draggedId)
}

const drop = useTreeDrop()

/** Whether this folder's row is being held over, to drop into it. */
const dropTarget = computed(() => drop.into.value === props.documentId)

/** Whether a drop now would put what is being dragged in this folder: its row and all in it show it. */
const isDestination = computed(() => drop.destination.value === props.documentId)

/**
 * A row of this folder's has started being dragged. The row is the first in
 * the item Sortable took up.
 * @param {{item?: HTMLElement}} event
 */
const onDragStart = event => {
  keepName()
  const id = event.item?.querySelector('[role="treeitem"]')?.getAttribute('data-document-id')
  if (id) {
    history.beginMove(id)
    drop.start(props.storyId, id, event.item)
  }
  emit('dragging', true)
}

/**
 * The drag is over, and what it moved is one step to take back. The row it
 * moved is drawn afresh where it landed, and the keys go to it there.
 * @param {{item?: HTMLElement}} event
 */
const onDragEnd = event => {
  const id = event.item?.querySelector('[role="treeitem"]')?.getAttribute('data-document-id')
  drop.end()
  history.endMove()
  emit('dragging', false)
  if (!id) return
  nextTick(() =>
    /** @type {HTMLElement|null} */ (
      document.querySelector(`[role="treeitem"][data-document-id="${id}"]`)
    )?.focus()
  )
}

// A shut folder held over for a moment opens, so the drag can go on in.
/** @type {ReturnType<typeof setTimeout>|null} */
let opening = null
watch(dropTarget, over => {
  if (opening) clearTimeout(opening)
  opening = null
  if (!over || expanded.value) return
  opening = setTimeout(() => {
    opening = null
    if (dropTarget.value && !expanded.value) toggleExpanded()
  }, OPEN_AFTER)
})
onBeforeUnmount(() => {
  if (opening) clearTimeout(opening)
  keepName()
})

onMounted(() => {
  if (api.claimRename(props.documentId)) {
    namingNew.value = true
    startRename()
  }
})
</script>

<style scoped>
/* Where the row being dragged would land: at the depth of the folder whose
   list it is in now, set on the list, rather than the depth it came from.
   What is in it, when it is a folder, stays behind at the old depth. */
.sortable-ghost > [role='treeitem'] {
  padding-left: var(--tree-indent) !important;
  opacity: 0.5;
}

.sortable-ghost > [role='group'],
.sortable-ghost > [data-rename-clash] {
  display: none;
}
</style>
