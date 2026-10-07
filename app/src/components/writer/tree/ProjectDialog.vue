<template>
  <Dialog
    :visible="visible"
    header="Project settings"
    :modal="true"
    :closable="true"
    class="w-full max-w-xl"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-surface-700 dark:text-surface-200">Title</label>
        <InputText v-model="form.title" placeholder="Project title" class="w-full" autofocus />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-surface-700 dark:text-surface-200">Summary</label>
        <Textarea
          v-model="form.summary"
          placeholder="Brief summary of the project..."
          :rows="8"
          :auto-resize="true"
          class="w-full"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-xs font-medium text-surface-700 dark:text-surface-200">
          Default profile
        </label>
        <Select
          v-model="form.profileId"
          :options="profiles"
          option-label="name"
          option-value="id"
          class="w-full dark:!bg-surface-900"
          size="small"
        />
        <p class="text-xs text-surface-500 dark:text-surface-400">
          New chats in this project start on it. Each chat can still pick its own.
        </p>
      </div>
    </div>
    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="$emit('update:visible', false)" />
      <Button label="Save" @click="save" />
    </template>
  </Dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import Textarea from 'primevue/textarea'
import { useToast } from 'primevue/usetoast'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useStoriesStore } from '@/stores/storiesStore'
import { useProfiles } from '@/composables/useProfiles'
import { useProfileNotice } from '@/composables/useProfileNotice.js'
import { DEFAULT_PROFILE_ID } from '@/ai/profiles/index.js'

const props = defineProps({
  storyId: { type: String, required: true },
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['update:visible'])

const toast = useToast()
const documentsStore = useDocumentsStore()
const storiesStore = useStoriesStore()
const profilesApi = useProfiles()
const { noticeFor } = useProfileNotice()

const profiles = computed(() => profilesApi.profiles.value)

/**
 * The profile new chats in the project start on, as it stands: the project's
 * own unless that is gone or an NSFW one switched off.
 * @param {any} story
 * @returns {string}
 */
const startingProfileId = story =>
  profilesApi.getProfile(story?.options?.profileId)?.id ?? DEFAULT_PROFILE_ID

// Title and summary live on the root document. Its title is the name the
// bookshelf and the tree show, and its summary is the project's overview — the
// same field every other document summarises itself with, and the first line
// the model reads when it lists the project. The default profile is the
// project's own: what a new chat here starts on, and nothing more — a chat
// keeps the profile it was given when this changes.
const form = ref({ title: '', summary: '', profileId: DEFAULT_PROFILE_ID })

watch(
  () => props.visible,
  async isVisible => {
    if (!isVisible) return
    // Opened from the projects list, the project may not be the one open,
    // and only its root is needed here.
    await documentsStore.loadRoots([props.storyId])
    const root = documentsStore.getRoot(props.storyId)
    const story = storiesStore.getStory(props.storyId)
    form.value = {
      title: root?.title || '',
      summary: root?.summary || '',
      profileId: startingProfileId(story),
    }
  },
  { immediate: true }
)

const save = async () => {
  const title = form.value.title.trim()
  if (!title) {
    toast.add({
      severity: 'error',
      summary: 'Validation Error',
      detail: 'Project title cannot be empty',
      life: 3000,
    })
    return
  }

  const root = documentsStore.getRoot(props.storyId)
  if (!root) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Project not found', life: 3000 })
    return
  }

  try {
    documentsStore.updateDocument(root.id, {
      title,
      summary: form.value.summary.trim(),
    })
    const story = storiesStore.getStory(props.storyId)
    // Against what the dialog showed, so saving a new title leaves an NSFW
    // default in place for when the writer switches those back on.
    if (story && startingProfileId(story) !== form.value.profileId) {
      await storiesStore.updateStory(props.storyId, {
        options: { ...story.options, profileId: form.value.profileId },
      })
      // Every new chat here will start on it, which is choosing it.
      noticeFor(form.value.profileId)
    }
    emit('update:visible', false)
    toast.add({ severity: 'success', summary: 'Success', detail: 'Project updated', life: 3000 })
  } catch (error) {
    console.error('Failed to update project:', error)
    toast.add({
      severity: 'error',
      summary: 'Error',
      detail: 'Failed to update project',
      life: 3000,
    })
  }
}
</script>
