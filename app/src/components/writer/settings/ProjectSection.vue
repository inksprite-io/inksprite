<template>
  <div class="flex flex-col" data-project-settings>
    <div class="flex flex-col gap-1 px-2 pt-1 pb-2">
      <label for="project-title" class="text-xs font-medium text-surface-700 dark:text-surface-200"
        >Title</label
      >
      <InputText
        id="project-title"
        v-model="title"
        size="small"
        class="w-full"
        data-field="project-title"
        @input="editing = 'title'"
        @blur="saveTitle"
        @keydown.enter="saveTitle"
      />
    </div>

    <div class="flex flex-col gap-1 px-2 pt-1 pb-2">
      <label
        for="project-summary"
        class="text-xs font-medium text-surface-700 dark:text-surface-200"
        >Summary</label
      >
      <Textarea
        id="project-summary"
        v-model="summary"
        :rows="4"
        auto-resize
        class="w-full text-sm"
        data-field="project-summary"
        @input="editing = 'summary'"
        @blur="saveSummary"
      />
    </div>

    <!-- What a new chat here starts on: the chats are the AI's. -->
    <div v-if="aiEnabled" class="flex flex-col gap-1 px-2 pt-1 pb-2">
      <label
        for="project-profile"
        class="text-xs font-medium text-surface-700 dark:text-surface-200"
        >Default chat profile</label
      >
      <Select
        input-id="project-profile"
        :model-value="profileId"
        :options="profiles"
        option-label="name"
        option-value="id"
        aria-label="Default chat profile"
        class="w-full dark:!bg-surface-900"
        size="small"
        data-field="project-profile"
        @update:model-value="setProfile"
      />
    </div>

    <!-- Only in sync: a project kept on this device only isn't shared. -->
    <ExpandableSection
      v-if="shareable"
      ref="sharingSection"
      title="Sharing"
      storage-key="ui.settings.project.sharing"
      subsection
      container-class="pt-2"
      content-wrapper-class="flex flex-col"
    >
      <ProjectSharing :story-id="storyId" />
    </ExpandableSection>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Textarea from 'primevue/textarea'
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import ProjectSharing from './ProjectSharing.vue'
import { useApplicationState } from '@/composables/useApplicationState'
import { useCloudSync } from '@/composables/useCloudSync.js'
import { useProfiles } from '@/composables/useProfiles'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'
import { useToast } from '@/composables/useToast'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useStoriesStore } from '@/stores/storiesStore'

/**
 * Settings › Project: the project open's title and summary, which are its
 * root's, the profile a new chat in it starts on, and whom it is shared
 * with. Each is kept as it is changed: a field once the writer leaves it.
 * The outline's Share… opens it on the sharing.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 */
const props = defineProps({
  storyId: { type: String, required: true },
})

const documentsStore = useDocumentsStore()
const storiesStore = useStoriesStore()
const profilesApi = useProfiles()
const { profiles } = profilesApi
const { aiEnabled } = useApplicationState()
const cloud = useCloudSync()
const toast = useToast()

const root = computed(() => documentsStore.getRoot(props.storyId))
const story = computed(() => storiesStore.getStory(props.storyId))

/** The field typed in and not left yet, which what changes elsewhere leaves alone. @type {import('vue').Ref<'title'|'summary'|null>} */
const editing = ref(null)
const title = ref('')
const summary = ref('')

// As the project has them, until the writer types: renamed in the outline,
// or on another device, the fields follow.
watch(
  () => root.value?.title ?? '',
  now => {
    if (editing.value !== 'title') title.value = now
  },
  { immediate: true }
)
watch(
  () => root.value?.summary ?? '',
  now => {
    if (editing.value !== 'summary') summary.value = now
  },
  { immediate: true }
)

/**
 * Keep the title, clear of the names of the other projects; one cleared is
 * put back.
 */
function saveTitle() {
  editing.value = null
  const typed = title.value.trim()
  const rootNow = root.value
  if (!rootNow) return
  if (!typed || typed === rootNow.title) {
    title.value = rootNow.title
    return
  }
  const free = storiesStore.freeName(typed, props.storyId)
  title.value = free
  update({ title: free })
}

function saveSummary() {
  editing.value = null
  const typed = summary.value.trim()
  if (!root.value || typed === (root.value.summary ?? '')) return
  update({ summary: typed })
}

/** @param {{title?: string, summary?: string}} changes */
function update(changes) {
  try {
    documentsStore.updateDocument(/** @type {any} */ (root.value).id, changes)
  } catch (error) {
    console.error('Failed to update project:', error)
    toast.error("The project couldn't be saved.")
  }
}

/**
 * The profile new chats here start on, as it stands: the project's own,
 * unless that is gone or the settings switch puts its NSFW or general
 * counterpart in its place, and the one the settings start every chat on
 * when it has none.
 */
const profileId = computed(
  () => profilesApi.getProfile(story.value?.options?.profileId)?.id ?? profilesApi.chatDefaultId()
)

/**
 * Make it the project's own. Against what the picker shows, so that one the
 * settings switch has swapped for its counterpart stays as it was until
 * another is picked. A chat keeps the profile it was given.
 * @param {string} id
 */
async function setProfile(id) {
  const now = story.value
  if (!now || id === profileId.value) return
  try {
    await storiesStore.updateStory(props.storyId, { options: { ...now.options, profileId: id } })
  } catch (error) {
    console.error('Failed to update project:', error)
    toast.error("The project couldn't be saved.")
  }
}

/**
 * Whether the project can be shared from here: signed in to sync, and not
 * kept out of it, by the writer or by another device to itself.
 */
const shareable = computed(
  () => Boolean(cloud.account.value) && !story.value?.syncOff && !story.value?.keptElsewhere
)

/** @type {import('vue').Ref<any>} */
const sharingSection = ref(null)

// Asked for its sharing (the outline's Share…), it opens there.
const { requestedPart, takePart } = useSettingsPanel()
watch(
  requestedPart,
  async part => {
    if (part !== 'sharing' || !shareable.value) return
    takePart()
    await nextTick()
    sharingSection.value?.expand()
    await nextTick()
    sharingSection.value?.$el?.scrollIntoView?.({ block: 'nearest' })
  },
  { immediate: true }
)

// The names of the other projects, for a new title to keep clear of.
onMounted(() => storiesStore.loadNames().catch(() => {}))

// Closed with a field still being typed in, what was typed is kept.
onBeforeUnmount(() => {
  if (editing.value === 'title') saveTitle()
  else if (editing.value === 'summary') saveSummary()
})
</script>
