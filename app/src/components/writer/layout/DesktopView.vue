<template>
  <div class="h-full flex bg-surface-50 dark:bg-surface-950">
    <!-- Two splitters, one inside the other: the sidebar against the content,
         and the editor against the chat within it. A panel hidden is hidden,
         not taken down: the splitter lays its panels out once, and a chat of
         any length is not something to build twice. The panel left takes the
         room, and one coming back finds the split where it was. In a narrow
         window the sidebar and the chat take turns; see shownLayout. -->
    <Splitter class="flex-1 min-w-0" @resizeend="keep(ROW_KEY, $event)">
      <!-- At least wide enough for the outline's titles, whatever share of
           the window that is. -->
      <SplitterPanel
        v-show="shown.sidebar"
        :size="rowSizes[0]"
        :min-size="12"
        class="min-w-56 grow overflow-hidden"
      >
        <!-- Keyed on the project like the panels beside it: its lists bind to
             one project when they mount, and the outline is where another
             project is switched to. -->
        <LeftSidebar
          :key="`sidebar:${storyId}`"
          class="h-full w-full"
          :story-id="storyId"
          :document-id="documentId"
          :chat-id="chatId"
          :tab="layout.sidebarTab"
          @select-chat="selectChat"
          @open-document="$emit('open-document', $event)"
        />
      </SplitterPanel>

      <SplitterPanel :size="rowSizes[1]" :min-size="30" class="min-w-0 grow overflow-hidden">
        <Splitter class="h-full w-full" @resizeend="keep(CONTENT_KEY, $event)">
          <SplitterPanel
            v-show="shown.editor"
            :size="contentSizes[0]"
            :min-size="20"
            class="min-w-0 grow overflow-hidden"
          >
            <!-- Keyed on the project, like the chat panel: the panel binds to
                 one project's tabs when it mounts, and a project switched to
                 must get a panel of its own rather than the last project's. -->
            <EditorPanel
              :key="`editor-panel:${storyId}`"
              class="h-full w-full"
              :story-id="storyId"
              :chat-showing="shown.chat"
              @toggle-chat="toggleChat"
            />
          </SplitterPanel>

          <SplitterPanel
            v-show="shown.chat"
            :size="contentSizes[1]"
            :min-size="20"
            class="min-w-0 grow overflow-hidden"
          >
            <ChatPanel
              :key="`chat-panel:${storyId}`"
              class="h-full w-full"
              :story-id="storyId"
              :chat-id="chatId"
              :editor-showing="shown.editor"
              @update:chat-id="$emit('update:chatId', $event)"
              @toggle-editor="$emit('toggle', PANELS.EDITOR)"
            />
          </SplitterPanel>
        </Splitter>
      </SplitterPanel>
    </Splitter>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import Splitter from 'primevue/splitter'
import SplitterPanel from 'primevue/splitterpanel'
import LeftSidebar from './LeftSidebar.vue'
import EditorPanel from './EditorPanel.vue'
import ChatPanel from './ChatPanel.vue'
import { CONTENT_SIZES, PANELS, ROW_SIZES, keptSizes, shownLayout } from './layout.js'
import { useScreenSize } from '@/composables/useScreenSize'
import { localStorage } from '@/utils/localStorage'

/**
 * The desktop arrangement: the sidebar, the editor and the chat side by side,
 * each there or not as the layout says, the sidebar's width its own and the
 * other two dividing the rest. The editor and the chat each carry the toggle
 * for the other at the edge of their header, and asking for one is passed up
 * as `toggle` with the panel's name. In a window too narrow for all three,
 * the chat folds away while the sidebar is open, and asking for it — its
 * toggle, or a chat picked from the list — closes the sidebar instead.
 *
 * @typedef {Object} Props
 * @property {import('@/types/models.js').StoryLayout} layout
 * @property {string} storyId
 * @property {string} [documentId]
 * @property {string|null} [chatId] - The chat the chat panel shows
 */
const props = defineProps({
  layout: {
    type: Object,
    required: true,
  },
  storyId: {
    type: String,
    required: true,
  },
  documentId: {
    type: String,
    default: '',
  },
  chatId: {
    type: String,
    default: null,
  },
})

const emit = defineEmits(['update:chatId', 'select-chat', 'open-document', 'toggle'])

const layout = computed(() => /** @type {import('@/types/models.js').StoryLayout} */ (props.layout))

const { isNarrow } = useScreenSize()

/** What shows, which in a narrow window is less than the layout has on. */
const shown = computed(() => shownLayout(layout.value, isNarrow.value))

// What each splitter was last dragged to, kept for every session after:
// sessionStorage put them back to the starting widths with each new window
// and each launch of the desktop app. Read once, since a splitter takes its
// widths only when it is laid out.
const ROW_KEY = 'ui.writer.splitter.row'
const CONTENT_KEY = 'ui.writer.splitter.content'
const rowSizes = keptSizes(localStorage.get(ROW_KEY), [ROW_SIZES.sidebar, ROW_SIZES.content])
const contentSizes = keptSizes(localStorage.get(CONTENT_KEY), [
  CONTENT_SIZES.editor,
  CONTENT_SIZES.chat,
])

/**
 * Keep the widths a splitter was dragged to.
 * @param {string} key
 * @param {{sizes: number[]}} event - The splitter's resizeend
 */
const keep = (key, event) => localStorage.set(key, event.sizes)

/** Whether the chat is on but folded away for the sidebar. */
const chatFolded = computed(() => layout.value.chat && !shown.value.chat)

/** Show or hide the chat; folded away, it is shown by closing the sidebar. */
const toggleChat = () => emit('toggle', chatFolded.value ? PANELS.SIDEBAR : PANELS.CHAT)

/**
 * Open a chat picked from the list, where it can be read: with the chat
 * folded away, that is in place of the list.
 * @param {string} chatId
 */
const selectChat = chatId => {
  emit('select-chat', chatId)
  if (chatFolded.value) emit('toggle', PANELS.SIDEBAR)
}
</script>
