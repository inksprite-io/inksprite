<template>
  <div v-if="node" data-tree-node>
    <!-- Row. A tree item the keyboard can reach: one row in the tree is in
         the tab order — the document open, or the root — and the arrows move
         between the rest. See handleKeydown. -->
    <div
      class="group flex items-center gap-1 py-1 pr-1 rounded cursor-pointer select-none [-webkit-touch-callout:none] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500"
      :class="[
        !isDragging && 'hover:bg-surface-200 dark:hover:bg-surface-700',
        isActive && 'bg-surface-200 dark:bg-surface-600',
      ]"
      :style="{ paddingLeft: `${depth * 12 + 4}px` }"
      role="treeitem"
      :tabindex="isTabStop ? 0 : -1"
      :aria-level="depth + 1"
      :aria-selected="isActive"
      :aria-expanded="isFolder ? expanded : undefined"
      :data-document-id="documentId"
      @click="handleClick"
      @dblclick="handleDoubleClick"
      @keydown="handleKeydown"
      @contextmenu="contextMenu.show($event)"
      @touchstart.passive="press.touchstart"
      @touchmove.passive="press.touchmove"
      @touchend="press.touchend"
      @touchcancel="press.touchend"
    >
      <!-- Twisty. Text documents get an equivalent gap so titles line up. -->
      <button
        v-if="isFolder"
        class="flex-none w-4 h-4 flex items-center justify-center text-surface-500 dark:text-surface-400"
        :aria-label="expanded ? 'Collapse' : 'Expand'"
        @click.stop="toggleExpanded"
      >
        <i
          :class="expanded ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
          style="font-size: 0.6rem"
        />
      </button>
      <span v-else class="flex-none w-4" />

      <i
        class="flex-none text-surface-500 dark:text-surface-400"
        :class="
          converting
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
        :title="converting ? 'Converting to Markdown' : undefined"
        data-node-icon
      />

      <InputText
        v-if="isRenaming"
        ref="renameInput"
        v-model="draftTitle"
        class="flex-1 min-w-0"
        size="small"
        @keyup.enter="commitRename(true)"
        @keyup.escape="cancelRename(true)"
        @blur="commitRename(false)"
        @click.stop
        @contextmenu.stop
      />
      <span
        v-else
        class="flex-1 min-w-0 truncate text-sm"
        :class="[titleTone, !seen && 'opacity-60']"
        :title="carried ? 'In this chat’s context' : undefined"
        >{{ api.displayTitle(node) }}</span
      >

      <!-- What the chat sees of a document is in the row itself: dimmed
           where the chat cannot see it, whichever folder decided that, and the
           title in the primary colour where the chat carries it. No icon at
           rest — a column of them said the same thing louder.

           The open chat's two toggles show on hover, and when the keyboard is
           on them; in the primary colour when on, since a mark is this chat's
           and not the document's. A pin taken from a folder above shows
           faintly, and is let go of here. Not on a phone, which has no hover:
           the menu has both there. -->
      <template v-if="toggles && !isMobile">
        <button
          type="button"
          class="flex-none w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-surface-300 dark:hover:bg-surface-600"
          :class="pin.showing ? 'text-primary-500' : 'text-surface-500 dark:text-surface-400'"
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
          class="flex-none w-5 h-5 rounded flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-surface-300 dark:hover:bg-surface-600"
          :class="sight.showing ? 'text-primary-500' : 'text-surface-500 dark:text-surface-400'"
          :title="sight.hint"
          :aria-label="sight.label"
          :aria-pressed="sight.showing"
          data-toggle="sight"
          @click.stop="sight.toggle"
          @dblclick.stop
        >
          <i :class="sight.icon" style="font-size: 0.7rem"></i>
        </button>
      </template>

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
          @click.stop="menu.toggle($event)"
        />
        <TieredMenu ref="menu" :model="menuItems" :popup="true" />
      </template>
      <ContextMenu ref="contextMenu" :model="menuItems" />
    </div>

    <!-- Summary, for text documents that asked for it -->
    <DocumentSummary
      v-if="!isFolder && showSummary"
      :document-id="documentId"
      :style="{ marginLeft: `${depth * 12 + 24}px` }"
      @close="setSummaryVisible(false)"
    />

    <!-- Children -->
    <Draggable
      v-if="isFolder && expanded"
      v-model="childList"
      :group="{ name: 'documents' }"
      item-key="id"
      role="group"
      class="min-h-[0.5rem]"
      :sort="ordered"
      :delay-on-touch-only="true"
      :delay="120"
      :animation="200"
      :empty-insert-threshold="30"
      :move="onMove"
      @start="emit('dragging', true)"
      @end="emit('dragging', false)"
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
          @dragging="emit('dragging', $event)"
        />
      </template>
    </Draggable>
  </div>
</template>

<script setup>
/* global Blob */
import { computed, nextTick, onMounted, ref } from 'vue'
import Draggable from 'vuedraggable'
import Button from 'primevue/button'
import ContextMenu from 'primevue/contextmenu'
import InputText from 'primevue/inputtext'
import TieredMenu from 'primevue/tieredmenu'
import { useConfirm } from 'primevue/useconfirm'
import { useToast } from 'primevue/usetoast'
import DocumentSummary from './DocumentSummary.vue'
import { useCopyPath } from '@/composables/useCopyPath.js'
import { usePlainText } from '@/composables/usePlainText.js'
import { useFileView } from '@/composables/useFileView.js'
import { useJobs } from '@/composables/useJobs.js'
import { useChatSettings } from '@/composables/useChatSettings'
import { isCard } from '@/cards/chat.js'
import { chatVisibility, markOf, unpinned, withMark } from '@/utils/visibility.js'
import { useDocuments } from '@/composables/useDocuments'
import { useScreenSize } from '@/composables/useScreenSize'
import { useLongPress } from '@/composables/useLongPress.js'
import { useFilesStore } from '@/stores/filesStore'
import { downloadBlob, filenameFor } from '@/files/download.js'
import { EPUB_MIME, hasText, isText } from '@/files/inspect.js'
import { inRepository, isRepository, repositoryOf } from '@/source/tree.js'
import { reextractFile } from '@/files/write.js'
import { sessionStorage } from '@/utils/sessionStorage'
import { driveAvailable } from '@/drive/config.js'

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
  'dragging',
])

const api = useDocuments(props.storyId)
const { copyPath } = useCopyPath(props.storyId)
const { plainTextItem } = usePlainText(props.storyId)
const { fileViewItem } = useFileView(props.storyId)
const jobs = useJobs()
/** Whether a job is working on this document now: the row spins while it does. */
const converting = computed(() => jobs.runningOn(props.documentId) !== null)
const confirm = useConfirm()
const toast = useToast()
const { isMobile } = useScreenSize()

const menu = ref()
const contextMenu = ref()

/**
 * Open this node's menu from outside it. The empty space under the tree is the
 * project, and right-clicking it should offer what right-clicking the project
 * offers — the same menu, not a second one built to look like it.
 *
 * @param {Event} event
 */
const showContextMenu = event => contextMenu.value?.show(event)
defineExpose({ showContextMenu })

/**
 * Open the menu from the keyboard, at the row: the menu is placed by the
 * event's page coordinates, and a key has none, so the row's are given.
 * @param {HTMLElement} row
 */
const showMenuAtRow = row => {
  const rect = row.getBoundingClientRect()
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
    contextMenu.value?.show({
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
const isFolder = computed(() => api.isFolder(node.value))
const isFile = computed(() => node.value?.type === 'file')
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

/** Whether reading this file's bytes again could change its text. */
const extractable = computed(
  () => isFile.value && !isInRepository.value && hasText(node.value?.mime || '')
)

/** Read the file's text out of its bytes again, in place of what is there. */
const reextract = async () => {
  try {
    const found = await reextractFile(props.storyId, props.documentId)
    toast.add({
      severity: found ? 'success' : 'warn',
      summary: found ? 'Text re-extracted' : 'Nothing to read',
      detail: found
        ? found.text
          ? `${found.text.split(/\s+/).filter(Boolean).length} words.`
          : 'No text in it.'
        : 'The file itself is not in this project any more.',
      life: 4000,
    })
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Nothing changed', detail: error.message, life: 6000 })
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
    message: `Read the text out of "${api.displayTitle(node.value)}" again? The text as it is now, edits included, is replaced.`,
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
const isActive = computed(() => props.activeDocumentId === props.documentId)

// The open chat can be the unstarted one, which has no row yet: its marks are
// kept with its other settings and go into the chat it becomes.
const { chat, update: updateChat } = useChatSettings(props.storyId, () => props.chatId || '')

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
 * The title's colour: the primary colour where the chat carries the document,
 * which is the one thing the row says about the chat at rest, and otherwise
 * darker for the document open than for the rest.
 */
const titleTone = computed(() => {
  const weight = isActive.value ? ' font-semibold' : ''
  if (carried.value) return `text-primary-600 dark:text-primary-400${weight}`
  return isActive.value
    ? `text-surface-900 dark:text-surface-0${weight}`
    : 'text-surface-700 dark:text-surface-200'
})

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
      hint: 'Keep in this chat’s context',
      toggle: () => markAs('pinned'),
    }
  }
  const own = mark.value === 'pinned'
  return {
    showing: true,
    own,
    label: own ? 'Pinned to this chat' : 'Pinned with the folder above',
    hint: own
      ? 'In this chat’s context. Click to unpin.'
      : 'In this chat’s context with its folder. Click to let go.',
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
      hint: 'Kept from this chat. Click to show.',
      toggle: showInChat,
    }
  }
  if (mark.value === 'shown' && aboveMark.value === 'hidden') {
    return {
      showing: true,
      icon: 'pi pi-eye',
      label: 'Shown in this chat',
      hint: 'Shown although its folder is hidden. Click to hide.',
      toggle: hideInChat,
    }
  }
  if (!seen.value) {
    return {
      showing: false,
      icon: 'pi pi-eye',
      label: 'Unhide in this chat',
      hint: 'Let this chat see it',
      toggle: showInChat,
    }
  }
  return {
    showing: false,
    icon: 'pi pi-eye-slash',
    label: 'Hide from this chat',
    hint: 'Keep from this chat',
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

const expandedKey = computed(() => `ui.tree.${props.documentId}.expanded`)
// Folders start open: a collapsed tree on first load hides the whole story.
// Not in a repository, whose thousands of files would all be drawn at once;
// there a folder opens when it is asked to.
const expanded = ref(sessionStorage.get(expandedKey.value, !isInRepository.value))

const summaryKey = computed(() => `ui.tree.${props.documentId}.summary`)
const showSummary = ref(sessionStorage.get(summaryKey.value, false))

const toggleExpanded = () => {
  expanded.value = !expanded.value
  sessionStorage.set(expandedKey.value, expanded.value)
}

/** @param {boolean} visible */
const setSummaryVisible = visible => {
  showSummary.value = visible
  sessionStorage.set(summaryKey.value, visible)
}

const startRename = async () => {
  draftTitle.value = api.editableTitle(props.documentId)
  isRenaming.value = true
  await nextTick()
  renameInput.value?.$el?.focus()
  renameInput.value?.$el?.select()
}

/**
 * The rename is over: the name stands, or the old one does if nothing was
 * typed. A new document is then written in, when the writer ended the rename
 * themselves; a blur means they went somewhere else, and the focus stays there.
 * @param {boolean} deliberate - Ended with a key rather than by leaving the field
 */
const commitRename = deliberate => {
  if (!isRenaming.value) return
  isRenaming.value = false

  const next = draftTitle.value.trim()
  if (next && next !== api.editableTitle(props.documentId)) api.rename(props.documentId, next)
  settleNew(deliberate)
}

/** @param {boolean} deliberate */
const cancelRename = deliberate => {
  isRenaming.value = false
  settleNew(deliberate)
}

/**
 * Where a new document goes once it has been named: into the editor, in
 * front of the writer. Deliberately ending the rename means the writer is
 * still here; a blur means they have moved on.
 * @param {boolean} deliberate
 */
const settleNew = deliberate => {
  if (!namingNew.value) return
  namingNew.value = false
  if (!deliberate || isFolder.value) return
  emit('open', props.documentId)
  api.focus(props.documentId)
}

const handleClick = () => {
  if (isRenaming.value) return
  // Clicking a folder twists it; clicking a document opens it. The old outline
  // toggled a summary here, which is the one deliberate behaviour change.
  if (isFolder.value) toggleExpanded()
  else emit('open', props.documentId)
}

/**
 * Double-clicking a document keeps the tab the first click opened it in,
 * rather than leaving it a preview for the next click to replace.
 */
const handleDoubleClick = () => {
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
      if (!isFolder.value) return
      if (expanded.value) move(1)
      else toggleExpanded()
      break
    case 'ArrowLeft': {
      // Twist a folder shut; shut already, or a document, step out to the parent.
      if (isFolder.value && expanded.value) {
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

  // A document is opened as it is made — creating one and then having to find
  // it is the worst of both — and the new node opens its own rename once it
  // mounts. The rename takes the focus; it goes back to the document after.
  if (type === 'text') api.open(created.id)
  api.requestRename(created.id)
}

const confirmDelete = () => {
  const name = node.value?.title?.trim() || 'Untitled'
  const hasChildren = childList.value.length > 0

  confirm.require({
    header: isFolder.value ? 'Delete folder' : 'Delete document',
    message: hasChildren ? `Delete "${name}" and everything inside it?` : `Delete "${name}"?`,
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: () => api.remove(props.documentId),
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
    // A model puts the structure back into text that lost it — headings,
    // tables, paragraphs — which is a file's text, read out of it. A
    // document written here, or a conversion's own copy, has its structure.
    if (isFile.value && !isInRepository.value && (node.value?.content || '').trim()) {
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

  if (!isRoot.value) {
    // From every chat. Just "Hide": the row dims, and that is what it means.
    items.push({
      label: hidden.value ? 'Unhide' : 'Hide',
      icon: hidden.value ? 'pi pi-eye' : 'pi pi-eye-slash',
      command: () => api.setHidden(props.documentId, !hidden.value),
    })
  }

  // A folder that came from a card has somebody in it to talk to. First,
  // because on a card folder it is the thing the writer came to do.
  if (isCardFolder.value) {
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
      icon: 'pi pi-download',
      items: [
        {
          label: 'Files…',
          icon: 'pi pi-file',
          command: () => emit('import', props.documentId),
        },
        {
          label: 'Folder…',
          icon: 'pi pi-folder-open',
          command: () => emit('import-folder', props.documentId),
        },
        // Picked in Google's picker; only where the build has a Google project
        // and the page can sign in to it.
        ...(driveAvailable()
          ? [
              {
                label: 'Google Drive…',
                icon: 'pi pi-google',
                command: () => emit('import-drive', props.documentId),
              },
            ]
          : []),
        // A codebase, to write about: from GitHub or a folder, read-only.
        {
          label: 'Repository…',
          icon: 'pi pi-code',
          command: () => emit('import-repository', props.documentId),
        },
      ],
    })
  }
  if (isRepositoryFolder.value) {
    items.push({
      label: 'Refresh repository…',
      icon: 'pi pi-refresh',
      command: () => emit('refresh-repository', props.documentId),
    })
  }

  // The open chat's own marks, so there is nothing to offer without one. A
  // document hidden from every chat has none to take: the block a pin would
  // ride in is the one it is being kept out of, and no chat can show it. On a
  // phone only: everywhere else the row's toggles are these, and a phone has
  // no hover to find them by.
  if (props.chatId && !hiddenEverywhere.value && isMobile.value) {
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
        command: () => confirmDelete(),
      }
    )
  }

  return items
})

/**
 * Refuse a drop that would put a folder inside its own subtree.
 * @param {any} event
 */
const onMove = event => {
  const draggedId = event.draggedContext?.element?.id
  return !draggedId || api.canDropInto(props.documentId, draggedId)
}

onMounted(() => {
  if (api.claimRename(props.documentId)) {
    namingNew.value = true
    startRename()
  }
})
</script>
