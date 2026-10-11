<template>
  <main class="h-full w-full min-w-0 flex flex-col bg-surface-0 dark:bg-surface-900">
    <!-- The strip is the panel's header. Beside the chat it is always there,
         since the chat's toggle lives at its end; alone, as on a phone, it is
         there only while something is open. -->
    <EditorTabs
      v-if="items.length > 0 || chatShowing !== null"
      :items="items"
      :active-id="activeId"
      :actions="tabActions"
      @activate="api.open"
      @close="api.closeTab"
      @keep="api.keep"
    >
      <template v-if="chatShowing !== null || findable" #end>
        <!-- The way to the find where there is no key for it, as on a phone. -->
        <HeaderButton
          v-if="findable"
          icon="pi pi-search"
          label="Find and replace"
          data-action="find"
          @click="editorView?.openFind()"
        />
        <PanelToggle
          v-if="chatShowing !== null"
          panel="chat"
          side="right"
          :showing="chatShowing"
          @toggle="$emit('toggle-chat')"
        />
      </template>
    </EditorTabs>
    <!-- Keyed on the document: a tab coming forward is a new view over the
         entry the registry already holds for it. Which view is the
         document's own kind: a file as the file, plain text in a field, or a
         document laid out. -->
    <div v-if="activeId" :key="`editor:${activeId}`" class="flex-1 min-h-0 w-full">
      <FileView v-if="file" :story-id="storyId" :document-id="activeId" class="h-full w-full" />
      <RawMarkdown
        v-else-if="plain"
        ref="editorView"
        :story-id="storyId"
        :document-id="activeId"
        class="h-full w-full"
      />
      <Editor
        v-else
        ref="editorView"
        :story-id="storyId"
        :document-id="activeId"
        class="h-full w-full"
        @shortcuts="showingShortcuts = true"
      />
    </div>
    <EmptyEditor v-else :story-id="storyId" class="flex-1 min-h-0" />
    <ShortcutsDialog v-model:visible="showingShortcuts" />
  </main>
</template>

<script setup>
import { computed, defineAsyncComponent, ref } from 'vue'
import Editor from '../editor/Editor.vue'
import EditorTabs from '../editor/EditorTabs.vue'
import EmptyEditor from '../editor/EmptyEditor.vue'
import FileView from '../editor/FileView.vue'
import ShortcutsDialog from '../editor/ShortcutsDialog.vue'
import HeaderButton from './HeaderButton.vue'
import PanelToggle from './PanelToggle.vue'
import { useCopyPath } from '@/composables/useCopyPath.js'
import { useDocuments } from '@/composables/useDocuments'
import { useFileView } from '@/composables/useFileView.js'
import { usePlainText } from '@/composables/usePlainText.js'
import { tabNames } from '@/utils/tabs.js'

// Loaded the first time a plain document is opened, with CodeMirror.
const RawMarkdown = defineAsyncComponent(() => import('../editor/RawMarkdown.vue'))

/**
 * The editor panel: the strip of open documents, the one showing — laid out,
 * as plain text, or as the file it is, whichever kind it is — or what to do
 * when none is. The
 * tabs are the story's, read and written through the document API, so this
 * needs only to know which project it is in.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {boolean|null} [chatShowing]
 */
const props = defineProps({
  storyId: {
    type: String,
    required: true,
  },
  /**
   * Whether the chat is showing beside this panel, for the toggle at the end
   * of the strip that hides and shows it. Null where there is no chat beside
   * it to toggle, as on a phone, and then there is no toggle.
   */
  chatShowing: {
    type: [Boolean, null],
    default: null,
  },
})

defineEmits(['toggle-chat'])

const api = useDocuments(props.storyId)
const { copyPath } = useCopyPath(props.storyId)
const { plainTextItem } = usePlainText(props.storyId)
const { showsText, fileViewItem } = useFileView(props.storyId)

/** Whether the list of the editor's keys is showing: Mod-/, or a tab's menu. */
const showingShortcuts = ref(false)

/**
 * What a tab's right-click menu offers: the same address the outline copies,
 * the same switch between plain text and a document, and for a file the same
 * switch between the file and its text. A document laid out offers the list
 * of the editor's keys too, the way to it that is not itself a key.
 * @param {string} id
 */
const tabActions = id =>
  [
    { label: 'Copy path', icon: 'pi pi-copy', command: () => copyPath(id) },
    plainTextItem(id),
    fileViewItem(id),
    api.get(id)?.type === 'text' && !api.isPlain(id)
      ? {
          label: 'Keyboard shortcuts',
          icon: 'pi pi-question-circle',
          command: () => (showingShortcuts.value = true),
        }
      : null,
  ].filter(Boolean)

const activeId = computed(() => api.tabs.value.active)
/** A file showing as the file. Its text is a plain document like any other. */
const file = computed(() => api.get(activeId.value)?.type === 'file' && !showsText(activeId.value))
const plain = computed(() => api.isPlain(activeId.value))
/** A document laid out or as plain text, either of which has a find of its own. */
const findable = computed(() => !!activeId.value && !file.value)

/** @type {import('vue').Ref<{ openFind: () => boolean }|null>} */
const editorView = ref(null)

// Titles come from the tree, so a rename or a move shows in the strip at
// once. Each is named by as much of its path as tells it apart.
const items = computed(() => {
  const { open, preview } = api.tabs.value
  const paths = open.map(id => [...api.titlesOf(id).slice(0, -1), api.displayTitle(api.get(id))])
  const names = tabNames(paths)
  return open.map((id, at) => ({
    id,
    ...names[at],
    path: api.pathOf(id),
    preview: id === preview,
    plain: api.get(id)?.type === 'text' && api.isPlain(id),
  }))
})
</script>
