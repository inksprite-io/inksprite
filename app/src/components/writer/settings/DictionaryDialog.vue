<template>
  <Dialog
    :visible="visible"
    modal
    header="Dictionary"
    :style="{ width: '24rem', maxWidth: '95vw' }"
    @update:visible="emit('update:visible', $event)"
    @show="draft = ''"
  >
    <Tabs v-if="projectName" v-model:value="tab" class="pb-2">
      <TabList>
        <Tab value="all" data-tab="all">All projects</Tab>
        <Tab value="project" data-tab="project">This project</Tab>
      </TabList>
    </Tabs>
    <InputText
      v-model="draft"
      class="w-full mb-2"
      size="small"
      placeholder="Add a word"
      aria-label="Add a word"
      data-add-word
      @keydown.enter.prevent="add"
    />
    <!-- A fixed height, so the dialog doesn't change size between the tabs. -->
    <ul class="h-72 overflow-y-auto" :aria-label="listLabel" data-words>
      <li
        v-for="word in sorted"
        :key="word"
        class="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800"
        data-word
      >
        <span class="min-w-0 truncate">{{ word }}</span>
        <button
          type="button"
          class="flex-none w-6 h-6 rounded-full flex items-center justify-center text-xs text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700"
          :aria-label="`Remove ${word}`"
          @click="remove(word)"
        >
          <i class="pi pi-times" />
        </button>
      </li>
      <li v-if="sorted.length === 0" class="px-2 py-1 text-sm text-surface-500" data-no-words>
        No words yet.
      </li>
    </ul>
  </Dialog>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Tab from 'primevue/tab'
import TabList from 'primevue/tablist'
import Tabs from 'primevue/tabs'
import { useApplicationState } from '@/composables/useApplicationState'
import { useProjectSpelling } from '@/composables/useSpelling.js'
import { useStoriesStore } from '@/stores/storiesStore'
import { useDocumentsStore } from '@/stores/documentsStore'
import { baseWord } from '@/spelling/engine.js'
import { storyIdFromRoute } from '@/utils/routeHelpers'

/**
 * The words added to the spelling checker's dictionaries: the writer's, which
 * every project knows, and the open project's, a tab each. A word is added
 * here or from the editor's menu on a flagged word, and taken out here. The
 * names in the project's titles aren't listed: they're known without being
 * added.
 */

defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['update:visible'])

const app = useApplicationState()
const route = useRoute()
const storiesStore = useStoriesStore()
const documentsStore = useDocumentsStore()

/** The project open, if the settings were opened from one. */
const storyId = computed(() => storyIdFromRoute(route?.params?.storyId))
const projectName = computed(() =>
  storiesStore.getStory(storyId.value)
    ? documentsStore.getRoot(storyId.value)?.title || 'This project'
    : ''
)

const project = computed(() => useProjectSpelling(storyId.value))

/** @type {import('vue').Ref<'all'|'project'>} */
const tab = ref('all')
const inProject = computed(() => tab.value === 'project' && !!projectName.value)

const listLabel = computed(() =>
  inProject.value ? `${projectName.value}'s dictionary` : 'Dictionary for all projects'
)

const words = computed(() =>
  inProject.value ? project.value.words.value : app.spelling.value.words
)

const sorted = computed(() =>
  [...words.value].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
)

const draft = ref('')

/** Add what was typed, each word of it, to the dictionary the tab shows. */
const add = () => {
  for (const word of draft.value.split(/\s+/).map(baseWord).filter(Boolean)) {
    if (inProject.value) project.value.addWord(word)
    else app.addWord(word)
  }
  draft.value = ''
}

/** @param {string} word */
const remove = word => {
  if (inProject.value) project.value.removeWord(word)
  else app.removeWord(word)
}
</script>
