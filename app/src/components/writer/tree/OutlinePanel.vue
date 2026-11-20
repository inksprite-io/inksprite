<template>
  <div class="h-full w-full">
    <!-- Hidden rather than taken down while the search shows, so it comes
         back as it was left: where it was scrolled to, what is being
         imported into it. -->
    <DocumentTree
      v-show="!searching"
      :story-id="storyId"
      :document-id="documentId"
      :chat-id="chatId"
      @open="$emit('open-document', $event)"
      @select-chat="$emit('select-chat', $event)"
    />
    <SearchPanel
      v-if="searching"
      :story-id="storyId"
      :document-id="documentId"
      @open-document="$emit('open-document', $event)"
    />
  </div>
</template>

<script setup>
import DocumentTree from './DocumentTree.vue'
import SearchPanel from '../search/SearchPanel.vue'
import { searchShowing } from '@/composables/useProjectSearch.js'

/**
 * The outline as the sidebar shows it, and a phone's outline view: the
 * project's documents, or in their place, while the writer searches the
 * project, what the search finds (`useProjectSearch`). The outline's header
 * opens the search and the search's closes it.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} [documentId] - The document open in the editor
 * @property {string|null} [chatId] - The chat open, which the outline shows and hides documents for
 */
const props = defineProps({
  storyId: { type: String, required: true },
  documentId: { type: String, default: '' },
  chatId: { type: String, default: null },
})

defineEmits(['open-document', 'select-chat'])

const searching = searchShowing(props.storyId)
</script>
