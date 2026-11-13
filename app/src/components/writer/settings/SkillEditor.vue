<template>
  <div class="flex flex-col gap-3" data-skill-editor>
    <template v-if="!unreadable">
      <div class="flex flex-col gap-1">
        <SettingLabel label="Name" />
        <InputText
          ref="nameField"
          v-model="name"
          size="small"
          class="w-full dark:!bg-surface-900"
          :maxlength="MAX_NAME"
          placeholder="Short Story Editor"
          aria-label="Name"
          autocomplete="off"
          data-field="name"
        />
      </div>

      <div class="flex flex-col gap-1">
        <SettingLabel label="Description" />
        <Textarea
          v-model="description"
          auto-resize
          rows="2"
          size="small"
          class="w-full max-h-32 !overflow-y-auto dark:!bg-surface-900"
          :maxlength="MAX_DESCRIPTION"
          placeholder="Provides critical feedback on short stories."
          aria-label="Description"
          data-field="description"
        />
      </div>

      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between gap-2">
          <SettingLabel label="Instructions" />
          <HeaderButton
            v-if="storyId"
            icon="pi pi-window-maximize"
            label="Open in editor"
            class="-my-1.5"
            data-action="open"
            @click="openInEditor"
          />
        </div>
        <Textarea
          v-model="body"
          auto-resize
          rows="6"
          size="small"
          class="w-full max-h-64 !overflow-y-auto dark:!bg-surface-900"
          placeholder="Read and critique the following short story. Give me feedback on the general structure, plot elements, writing style, and dialogue, as well as any other constructive criticism you might have."
          aria-label="Instructions"
          data-field="body"
        />
      </div>
    </template>

    <!-- Why it can't be used, as it stood when the card was opened or last
         saved: under the fields, or in their place for a file they can't be
         read out of. -->
    <p v-if="problem" class="text-xs text-red-600 dark:text-red-400" data-problem>
      {{ problem }}
    </p>

    <div class="flex items-center gap-1">
      <template v-if="stored">
        <HeaderButton icon="pi pi-download" label="Export" data-action="export" @click="exportIt" />
        <HeaderButton icon="pi pi-trash" label="Delete" data-action="delete" @click="remove" />
        <HeaderButton
          v-if="unreadable && storyId"
          icon="pi pi-window-maximize"
          label="Open in editor"
          data-action="open"
          @click="openInEditor"
        />
        <p
          v-if="stored.files?.length"
          class="min-w-0 truncate pl-1 text-xs text-surface-500 dark:text-surface-400"
          data-files
        >
          {{ stored.files.map(file => file.path).join(', ') }}
        </p>
      </template>
      <span class="flex-1" />
      <!-- As a message is edited: nothing is kept until it is saved. -->
      <template v-if="!unreadable">
        <Button
          v-tooltip.top="'Cancel'"
          aria-label="Cancel"
          icon="pi pi-times"
          text
          rounded
          size="small"
          data-action="cancel"
          @click="cancel"
        />
        <Button
          v-tooltip.top="'Save'"
          aria-label="Save"
          icon="pi pi-check"
          text
          rounded
          size="small"
          severity="success"
          data-action="save"
          @click="confirmed"
        />
      </template>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import { useConfirm } from 'primevue/useconfirm'
import SettingLabel from '@/components/common/SettingLabel.vue'
import HeaderButton from '../layout/HeaderButton.vue'
import { MAX_DESCRIPTION, MAX_NAME, nameError, parseSkill } from '@/ai/skills/format.js'
import { formFromText, textFromForm } from '@/ai/skills/form.js'
import { waitingOn } from '@/ai/skills/runner.js'
import { zipBlob } from '@/ai/skills/bundle.js'
import { downloadBlob } from '@/files/download.js'
import { useSkills } from '@/composables/useSkills'
import { useDocuments } from '@/composables/useDocuments'
import { useEditorRequest } from '@/composables/useEditorRequest.js'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'
import { skillTabId } from '@/utils/chatTabs.js'

/** @typedef {import('@/types/models.js').StoredSkill} StoredSkill */

/**
 * One skill of the writer's, in its card: its name, its description and its
 * instructions. The file is what is kept, and these are three fields read out
 * of it and written back into it (ai/skills/form.js); the rest of the file is
 * changed in the editor, which opens the whole of it.
 *
 * What is typed is kept when it is saved, and the card shuts on a skill that
 * can be used. Cancel puts the fields back as they were. Shutting the card
 * any other way keeps what was typed, as Save does, so that nothing written
 * is lost to a click elsewhere. With no skill given it is a new one, which is
 * kept the first time there is something of it to keep.
 *
 * Why a skill can't be used is said under the fields, as it stood when the
 * card was opened or last saved, and not while it is being written.
 *
 * @typedef {Object} Props
 * @property {string} [skillId] - The skill; none for one not yet made
 * @property {string} [storyId] - The project open, whose editor the file
 *   opens in; with none there is nowhere to open it
 */
const props = defineProps({
  skillId: { type: String, default: '' },
  storyId: { type: String, default: '' },
})

/** `made`: a new skill was saved, with its id. `close`: done with, to be shut. */
const emit = defineEmits(['made', 'close'])

const skillsApi = useSkills()
const confirm = useConfirm()

/** The skill as the library keeps it; none for one not yet made. */
const stored = computed(() => (props.skillId ? skillsApi.getSkill(props.skillId) : null))

const name = ref('')
const description = ref('')
const body = ref('')
/** Why the fields can't be read out of the file, when they can't. */
const unreadable = ref('')
/** Why the skill can't be used, as last looked at. */
const problem = ref('')

/** The file as these fields last read or wrote it. */
let known = ''
/** The fields as they were read out of it. */
let read = { name: '', description: '', body: '' }
/** A new skill once it is kept, and any skill once deleted: nothing more is kept from here. */
let finished = false

/**
 * Why a skill can't be used, or can't do all its file asks of it.
 *
 * @param {StoredSkill} skill
 * @returns {string}
 */
const whyNot = skill => {
  const wrong = skillsApi.problemOf(skill)
  if (wrong) return wrong
  const parsed = parseSkill(skill.text)
  return 'skill' in parsed ? waitingOn(parsed.skill) : ''
}

/** @param {string} text */
const show = text => {
  known = text
  const from = formFromText(text)
  unreadable.value = 'error' in from ? from.error : ''
  if ('error' in from) return
  read = from.form
  name.value = read.name
  description.value = read.description
  body.value = read.body
}

// The file as it is when the card opens, and as it is changed from outside
// it: the editor's tab, or another window.
watch(
  () => stored.value?.text,
  text => {
    if (typeof text !== 'string' || text === known) return
    show(text)
    problem.value = stored.value ? whyNot(stored.value) : ''
  },
  { immediate: true }
)

const changed = () =>
  name.value !== read.name || description.value !== read.description || body.value !== read.body

/**
 * Keep what is typed, when anything was.
 *
 * @param {{always?: boolean}} [options] - `always`: keep a new skill though
 *   nothing of it is written, for the editor to open
 * @returns {Promise<StoredSkill|null>} The skill as kept; none for a new one
 *   with nothing written
 */
const keep = async ({ always = false } = {}) => {
  if (finished || unreadable.value) return stored.value
  if (!changed() && (props.skillId || !always)) return stored.value

  const form = { name: name.value, description: description.value, body: body.value }
  known = textFromForm(form, known)
  read = form
  if (props.skillId) return skillsApi.writeSkill(props.skillId, known)

  finished = true
  return skillsApi.createSkill(known)
}

/** Save: keep it, say what is wrong with it, and shut on one that can be used. */
const confirmed = async () => {
  const kept = await keep()
  // A new one with nothing written is not kept, and still wants its name.
  if (!kept) {
    problem.value = nameError('')
    return
  }
  if (!props.skillId) emit('made', kept.id)
  problem.value = whyNot(kept)
  if (!skillsApi.problemOf(kept)) emit('close')
}

/** Cancel: the fields as they were, and the card shut. */
const cancel = () => {
  name.value = read.name
  description.value = read.description
  body.value = read.body
  emit('close')
}

// Shut some other way with something typed: it is kept, as Save keeps it.
onBeforeUnmount(() => {
  keep()
})

/** @type {import('vue').Ref<{$el: HTMLInputElement}|null>} */
const nameField = ref(null)

// A new skill is named first.
onMounted(async () => {
  if (props.skillId) return
  await nextTick()
  nameField.value?.$el.focus()
})

const editorRequest = useEditorRequest()

/**
 * Open the whole file in a tab of the editor's, and the editor with it, with
 * what is typed here kept in it; the settings close for it.
 */
const openInEditor = async () => {
  const kept = await keep({ always: true })
  if (!kept) return
  if (!props.skillId) emit('made', kept.id)
  useDocuments(props.storyId).open(skillTabId(kept.id))
  editorRequest.show()
  useSettingsPanel().close()
}

/**
 * The skill as it is kept, as a `.zip` of its folder: the shape other tools
 * take and a skills folder holds.
 */
const exportIt = () => {
  if (!stored.value) return
  const called = stored.value.name
  downloadBlob(
    zipBlob([{ name: called, text: stored.value.text, files: stored.value.files || [] }]),
    `${called}.zip`
  )
}

const remove = () => {
  const called = stored.value?.name || 'this skill'
  confirm.require({
    header: `Delete ${called}?`,
    message: 'This can’t be undone.',
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: () => {
      finished = true
      emit('close')
      skillsApi.deleteSkill(props.skillId)
    },
  })
}
</script>
