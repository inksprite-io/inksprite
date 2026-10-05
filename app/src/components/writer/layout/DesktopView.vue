<template>
  <div class="h-full flex bg-surface-50 dark:bg-surface-950">
    <!-- Two splitters, one inside the other: the sidebar against the content,
         and the editor against the chat within it. A panel hidden is hidden,
         not taken down: the splitter lays its panels out once, and a chat of
         any length is not something to build twice. The panel left takes the
         room, and one coming back finds the split where it was. -->
    <Splitter class="flex-1 min-w-0" state-key="ui.writer.splitter.row" state-storage="session">
      <SplitterPanel
        v-show="layout.sidebar"
        :size="ROW_SIZES.sidebar"
        :min-size="12"
        class="min-w-0 grow overflow-hidden"
      >
        <LeftSidebar
          class="h-full w-full"
          :story-id="storyId"
          :document-id="documentId"
          :chat-id="chatId"
          :tab="layout.sidebarTab"
          @select-chat="$emit('select-chat', $event)"
          @open-document="$emit('open-document', $event)"
        />
      </SplitterPanel>

      <SplitterPanel :size="ROW_SIZES.content" :min-size="30" class="min-w-0 grow overflow-hidden">
        <Splitter
          class="h-full w-full"
          state-key="ui.writer.splitter.content"
          state-storage="session"
        >
          <SplitterPanel
            v-show="layout.editor"
            :size="CONTENT_SIZES.editor"
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
              :chat-showing="layout.chat"
              @toggle-chat="$emit('toggle', PANELS.CHAT)"
            />
          </SplitterPanel>

          <SplitterPanel
            v-show="layout.chat"
            :size="CONTENT_SIZES.chat"
            :min-size="20"
            class="min-w-0 grow overflow-hidden"
          >
            <ChatPanel
              :key="`chat-panel:${storyId}`"
              class="h-full w-full"
              :story-id="storyId"
              :chat-id="chatId"
              :editor-showing="layout.editor"
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
import { CONTENT_SIZES, PANELS, ROW_SIZES } from './layout.js'

/**
 * The desktop arrangement: the sidebar, the editor and the chat side by side,
 * each there or not as the layout says, the sidebar's width its own and the
 * other two dividing the rest. The editor and the chat each carry the toggle
 * for the other at the edge of their header, and asking for one is passed up
 * as `toggle` with the panel's name.
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

defineEmits(['update:chatId', 'select-chat', 'open-document', 'toggle'])

const layout = computed(() => /** @type {import('@/types/models.js').StoryLayout} */ (props.layout))
</script>
