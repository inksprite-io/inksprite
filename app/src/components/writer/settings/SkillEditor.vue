<template>
  <div class="flex flex-col gap-4" data-skill-editor>
    <div class="flex items-center gap-2">
      <Button
        icon="pi pi-chevron-left"
        severity="secondary"
        text
        rounded
        size="small"
        aria-label="Back to skills"
        data-action="back"
        @click="emit('close')"
      />
      <h3 class="flex-1 min-w-0 truncate text-base font-semibold">
        {{ skillId ? `Edit ${form?.name || 'skill'}` : 'New skill' }}
      </h3>
      <div
        class="flex rounded-lg border border-surface-200 dark:border-surface-700 overflow-hidden"
      >
        <button
          v-for="choice in MODES"
          :key="choice.id"
          type="button"
          class="px-3 py-1 text-xs"
          :class="
            mode === choice.id
              ? 'bg-surface-200 dark:bg-surface-700 font-semibold'
              : 'hover:bg-surface-100 dark:hover:bg-surface-800'
          "
          :aria-pressed="mode === choice.id"
          :data-mode="choice.id"
          @click="switchTo(choice.id)"
        >
          {{ choice.label }}
        </button>
      </div>
    </div>

    <p v-if="modeError" class="text-xs text-red-600 dark:text-red-400" data-mode-error>
      {{ modeError }}
    </p>

    <!-- The form: the fields of the frontmatter, and the instructions. -->
    <div v-if="mode === 'form' && form" class="flex flex-col gap-4">
      <div class="flex flex-col gap-1">
        <SettingLabel label="Name" description="Lowercase letters, digits and hyphens." />
        <InputText
          ref="nameField"
          v-model="form.name"
          size="small"
          class="w-full"
          :invalid="Boolean(nameIssue)"
          aria-label="Name"
          data-field="name"
        />
        <p v-if="nameIssue" class="text-xs text-red-600 dark:text-red-400" data-name-problem>
          {{ nameIssue }}
        </p>
      </div>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Description"
          description="The model reads this to decide when to call it."
        />
        <Textarea
          v-model="form.description"
          auto-resize
          rows="2"
          size="small"
          class="w-full"
          placeholder="What it does, and when to use it"
          aria-label="Description"
          data-field="description"
          :invalid="Boolean(descriptionIssue)"
          @blur="touched.description = true"
        />
        <p
          v-if="descriptionIssue"
          class="text-xs text-red-600 dark:text-red-400"
          data-description-problem
        >
          {{ descriptionIssue }}
        </p>
      </div>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Summary"
          description="One line for the / menu. Defaults to the description."
        />
        <InputText
          v-model="form.summary"
          size="small"
          class="w-full"
          aria-label="Summary"
          data-field="summary"
        />
      </div>

      <div class="flex flex-col gap-2">
        <SettingLabel label="Who can call it" />
        <div class="flex items-center justify-between gap-2">
          <label for="skill-model" class="text-sm">The model, when its description fits</label>
          <ToggleSwitch v-model="form.model" input-id="skill-model" data-field="model" />
        </div>
        <div class="flex items-center justify-between gap-2">
          <label for="skill-user" class="text-sm">
            You, as <span class="font-mono">/{{ form.name || 'name' }}</span>
          </label>
          <ToggleSwitch v-model="form.user" input-id="skill-user" data-field="user" />
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="How it runs"
          description="On its own: a separate model call. Joining: its instructions join the turn."
        />
        <Select
          v-model="form.fork"
          :options="RUNS"
          option-label="label"
          option-value="value"
          size="small"
          class="w-full"
          aria-label="How it runs"
          data-field="fork"
        />
      </div>

      <template v-if="form.fork">
        <div class="flex flex-col gap-1">
          <SettingLabel label="Its answer" />
          <Select
            v-model="form.output"
            :options="ANSWERS"
            option-label="label"
            option-value="value"
            size="small"
            class="w-full"
            aria-label="Its answer"
            data-field="output"
          />
        </div>

        <div class="flex flex-col gap-1">
          <SettingLabel
            label="Tools"
            description="It gets none of the chat’s tools unless listed here."
          />
          <MultiSelect
            v-model="form.tools"
            :options="toolOptions"
            placeholder="None"
            display="chip"
            size="small"
            class="w-full"
            aria-label="Tools"
            data-field="tools"
          />
        </div>
      </template>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div class="flex flex-col gap-1">
          <SettingLabel label="Argument" description="Naming it makes it required." />
          <InputText
            v-model="form.argument"
            size="small"
            placeholder="none"
            class="w-full"
            aria-label="Argument"
            data-field="argument"
          />
        </div>
        <div class="flex flex-col gap-1">
          <SettingLabel label="Hint" description="Shown after its name in the / menu." />
          <InputText
            v-model="form.argumentHint"
            size="small"
            placeholder="<what to type>"
            class="w-full"
            aria-label="Hint"
            data-field="argumentHint"
          />
        </div>
      </div>

      <div class="flex flex-col gap-1">
        <SettingLabel
          label="Instructions"
          :description="`The argument goes where ${placeholder} is, or at the end.`"
        />
        <Textarea
          v-model="form.body"
          auto-resize
          rows="8"
          size="small"
          class="w-full font-mono text-sm"
          :placeholder="`What to do with ${placeholder}`"
          aria-label="Instructions"
          data-field="body"
          :invalid="Boolean(bodyIssue)"
          @blur="touched.body = true"
        />
        <p v-if="bodyIssue" class="text-xs text-red-600 dark:text-red-400" data-body-problem>
          {{ bodyIssue }}
        </p>
      </div>
    </div>

    <!-- The file itself, for anything the form does not reach. -->
    <div v-else-if="mode === 'file'" class="flex flex-col gap-1">
      <SettingLabel
        label="SKILL.md"
        description="Saving from the form drops comments in the frontmatter."
      />
      <Textarea
        v-model="text"
        auto-resize
        rows="16"
        size="small"
        class="w-full font-mono text-sm"
        aria-label="SKILL.md"
        data-field="text"
      />
    </div>

    <p v-if="files.length" class="text-xs text-surface-500 dark:text-surface-400">
      Other files, unused: {{ files.map(file => file.path).join(', ') }}.
    </p>

    <ul
      v-if="listed.length"
      class="text-xs text-red-600 dark:text-red-400 list-disc pl-5"
      data-problems
    >
      <li v-for="problem in listed" :key="problem">{{ problem }}</li>
    </ul>
    <p
      v-else-if="waiting && problems.length === 0"
      class="text-xs italic text-surface-500 dark:text-surface-400"
      data-waiting
    >
      {{ waiting }}
    </p>

    <div class="flex items-center gap-2">
      <Button
        v-if="skillId"
        label="Delete"
        icon="pi pi-trash"
        severity="danger"
        text
        size="small"
        data-action="delete"
        @click="remove"
      />
      <Button
        label="Export"
        icon="pi pi-download"
        severity="secondary"
        text
        size="small"
        :disabled="'errors' in reading"
        data-action="export"
        @click="exportIt"
      />
      <span class="flex-1" />
      <Button
        label="Cancel"
        severity="secondary"
        outlined
        size="small"
        data-action="cancel"
        @click="emit('close')"
      />
      <Button
        label="Save"
        size="small"
        :disabled="problems.length > 0 || saving"
        data-action="save"
        @click="save"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import Select from 'primevue/select'
import MultiSelect from 'primevue/multiselect'
import ToggleSwitch from 'primevue/toggleswitch'
import { useConfirm } from 'primevue/useconfirm'
import SettingLabel from '@/components/common/SettingLabel.vue'
import { NEEDS_DESCRIPTION, NEEDS_INSTRUCTIONS, nameError, parseSkill } from '@/ai/skills/format.js'
import { formFromText, textFromForm, newSkillText } from '@/ai/skills/form.js'
import { waitingOn } from '@/ai/skills/runner.js'
import { zipBlob } from '@/ai/skills/bundle.js'
import { downloadBlob } from '@/files/download.js'
import { getToolDefinitions } from '@/ai/tools/index.js'
import { useSkills } from '@/composables/useSkills'
import { useToast } from '@/composables/useToast'

/**
 * One skill of the writer's, being written: as a form over its frontmatter
 * and instructions, or as the file itself. The file is what is kept either
 * way — the form reads its fields out of it and writes them back — so the two
 * never disagree about what the skill is. See ai/skills/form.js.
 */

/** @typedef {import('@/ai/skills/form.js').SkillForm} SkillForm */
/** @typedef {import('@/types/models.js').SkillFile} SkillFile */

const props = defineProps({
  /** The skill being edited, or none for a new one. */
  skillId: { type: String, default: null },
})

const emit = defineEmits(['close'])

const MODES = [
  { id: 'form', label: 'Form' },
  { id: 'file', label: 'File' },
]

const RUNS = [
  { value: true, label: 'On its own, reporting back' },
  { value: false, label: 'Joining the conversation' },
]

const ANSWERS = [
  { value: 'result', label: 'Back to whoever called it' },
  { value: 'reply', label: 'As the reply' },
  { value: 'edit', label: 'As an edit to a document (not yet)' },
]

const skillsApi = useSkills()
const confirm = useConfirm()
const toast = useToast()

/** A name for a new skill that nothing has yet. */
const freeName = () => {
  for (let n = 1; ; n++) {
    const name = n === 1 ? 'new-skill' : `new-skill-${n}`
    if (!skillsApi.nameProblem(name)) return name
  }
}

const stored = props.skillId ? skillsApi.getSkill(props.skillId) : null

/** The SKILL.md as it stands: what is kept when it is saved. */
const text = ref(stored?.text ?? newSkillText(freeName()))

/** The rest of its folder, kept as it came. */
const files = /** @type {SkillFile[]} */ (stored?.files ?? [])

/** @type {import('vue').Ref<'form'|'file'>} */
const mode = ref('form')
const modeError = ref('')

/** The form's fields, and the frontmatter they were read from. */
const form = ref(/** @type {SkillForm|null} */ (null))
/** @type {Record<string, unknown>} */
let front = {}

/**
 * Set while the form is being read out of the file, so reading it does not
 * write it back: a skill only opened keeps its file exactly as it was,
 * comments and all, until a field is changed.
 */
let loadingForm = false

/**
 * Read the form out of the file. A file whose frontmatter cannot be read is
 * edited as the file until it can.
 *
 * @returns {boolean} Whether there is a form to show
 */
const readForm = () => {
  const read = formFromText(text.value)
  if ('error' in read) {
    modeError.value = `${read.error} Fix it here to use the form.`
    mode.value = 'file'
    return false
  }
  front = read.front
  loadingForm = true
  form.value = read.form
  modeError.value = ''
  return true
}

// A change to a field writes the file, so saving, the checks below and the
// file view all read the same text. Watching before the first read, so that
// read is the one the flag skips.
watch(
  form,
  value => {
    if (loadingForm) {
      loadingForm = false
      return
    }
    if (value && mode.value === 'form') text.value = textFromForm(value, front)
  },
  { deep: true }
)

readForm()

/** @param {'form'|'file'} next */
const switchTo = next => {
  if (next === mode.value) return
  if (next === 'form') {
    if (readForm()) mode.value = 'form'
  } else {
    mode.value = 'file'
  }
}

/** The file as the registry would read it, and whether its name is free. */
const reading = computed(() => parseSkill(text.value))
const problems = computed(() => {
  const read = reading.value
  if ('errors' in read) return read.errors
  const problem = skillsApi.nameProblem(read.skill.name, props.skillId)
  return problem ? [problem] : []
})
/** What is wrong with the name, as the file's reading says it. */
const nameProblem = computed(() => {
  if (mode.value !== 'form' || !form.value) return ''
  const name = form.value.name.trim()
  return nameError(name) || skillsApi.nameProblem(name, props.skillId)
})

/**
 * What is wrong with the name, said under it rather than with the rest, and
 * in the form's words rather than the file's: the form has a Name field, not
 * a `name` key.
 */
const nameIssue = computed(() =>
  form.value && !form.value.name.trim() && nameProblem.value
    ? 'It needs a name.'
    : nameProblem.value
)

/**
 * Which of the fields a skill needs have been left by the writer. One not yet
 * reached is empty because it has not been written, not by mistake, so its
 * placeholder says what goes there and Save waits without a word.
 */
const touched = ref({ description: false, body: false })

/** An empty Description, said under it once the writer has been and gone. */
const descriptionIssue = computed(() =>
  mode.value === 'form' && touched.value.description && problems.value.includes(NEEDS_DESCRIPTION)
    ? 'It needs a description.'
    : ''
)

/** Empty Instructions, the same way. */
const bodyIssue = computed(() =>
  mode.value === 'form' && touched.value.body && problems.value.includes(NEEDS_INSTRUCTIONS)
    ? 'It needs instructions.'
    : ''
)

/** The problems said under the form: all of them, less what is said by a field. */
const listed = computed(() => {
  if (mode.value !== 'form') return problems.value
  return problems.value.filter(
    problem =>
      problem !== nameProblem.value &&
      problem !== NEEDS_DESCRIPTION &&
      problem !== NEEDS_INSTRUCTIONS
  )
})

const waiting = computed(() => {
  const read = reading.value
  return 'skill' in read ? waitingOn(read.skill) : ''
})

/** How the instructions name what was typed: its name, or `$ARGUMENTS`. */
const placeholder = computed(() =>
  form.value?.argument ? `$${form.value.argument}` : '$ARGUMENTS'
)

/**
 * The tools a skill can be given: every registered one but itself, and any
 * its file names that this app does not have, so a save does not drop them.
 */
const toolOptions = computed(() => {
  const own = form.value?.name
  const registered = getToolDefinitions()
    .map(definition => definition.function.name)
    .filter(name => name !== own)
  const named = form.value?.tools || []
  return [...new Set([...registered, ...named])]
})

const saving = ref(false)

/** @type {import('vue').Ref<any>} */
const nameField = ref(null)

// A new skill is named first, and the name it starts with is there to be
// typed over.
onMounted(() => {
  if (props.skillId) return
  const field = nameField.value?.$el
  field?.focus?.()
  field?.select?.()
})

const save = async () => {
  saving.value = true
  try {
    const saved = await skillsApi.saveSkill({ id: props.skillId, text: text.value, files })
    if ('errors' in saved) {
      toast.error(saved.errors.join(' '))
      return
    }
    emit('close')
  } finally {
    saving.value = false
  }
}

/**
 * The skill as it stands here, as a `.zip` of its folder: the shape claude.ai
 * takes and a skills folder holds.
 */
const exportIt = () => {
  const read = reading.value
  if ('errors' in read) return
  downloadBlob(
    zipBlob([{ name: read.skill.name, text: text.value, files }]),
    `${read.skill.name}.zip`
  )
}

const remove = () => {
  const name = form.value?.name || stored?.name || 'this skill'
  confirm.require({
    header: `Delete ${name}?`,
    message: `It goes from every chat, and /${name} with it. Turns that used it keep what it said.`,
    icon: 'pi pi-exclamation-triangle',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: () => {
      if (props.skillId) skillsApi.deleteSkill(props.skillId)
      emit('close')
    },
  })
}
</script>
