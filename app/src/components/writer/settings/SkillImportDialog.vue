<template>
  <Dialog
    :visible="visible"
    modal
    header="Import skills"
    :style="{ width: '36rem', maxWidth: '95vw' }"
    @update:visible="emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-3" data-skill-import>
      <p class="text-sm text-surface-600 dark:text-surface-300">
        {{ found.length === 1 ? 'One skill' : `${found.length} skills` }} found.
      </p>

      <div
        v-for="(row, index) in rows"
        :key="index"
        class="flex flex-col gap-1 rounded-lg px-3 py-2 border border-surface-200 dark:border-surface-700"
        :data-import="row.name || row.path"
      >
        <div class="flex items-center gap-2 min-w-0">
          <ToggleSwitch
            :model-value="chosen(index)"
            :disabled="!importable(row)"
            :aria-label="`Import ${row.name || row.path}`"
            data-choose
            @update:model-value="choose(index, $event)"
          />
          <span class="text-sm font-medium truncate">{{ row.name || row.path }}</span>
          <span v-if="row.name" class="text-xs text-surface-400 truncate">{{ row.path }}</span>
        </div>

        <ul
          v-if="row.errors.length"
          class="text-xs text-red-600 dark:text-red-400 list-disc pl-5"
          data-errors
        >
          <li v-for="error in row.errors" :key="error">{{ error }}</li>
        </ul>
        <template v-else>
          <span class="text-xs text-surface-500 dark:text-surface-400">{{ kindOf(row) }}</span>
          <span
            v-if="row.replaces"
            class="text-xs text-amber-700 dark:text-amber-300"
            data-replaces
          >
            Replaces your {{ row.name }}.
          </span>
          <div v-if="row.problem" class="flex flex-col gap-1" data-problem>
            <span class="text-xs text-red-600 dark:text-red-400">
              {{ row.problem }} Rename it to import it.
            </span>
            <InputText
              :model-value="row.name"
              size="small"
              class="w-full"
              :aria-label="`New name for ${row.name}`"
              data-rename
              @change="rename(index, $event.target.value)"
            />
          </div>
        </template>

        <span v-if="row.ignored.length" class="text-xs text-surface-500 dark:text-surface-400">
          Not used here: {{ row.ignored.join(', ') }}.
        </span>
        <span v-if="row.dropped.length" class="text-xs text-surface-500 dark:text-surface-400">
          Left out: {{ row.dropped.join('; ') }}.
        </span>
        <span v-if="row.files.length" class="text-xs text-surface-500 dark:text-surface-400">
          Comes with {{ row.files.length }} other {{ row.files.length === 1 ? 'file' : 'files' }},
          kept for later.
        </span>
      </div>

      <p v-if="stray.length" class="text-xs text-surface-500 dark:text-surface-400" data-stray>
        {{ stray.length === 1 ? 'One other file was' : `${stray.length} other files were` }} not
        part of any skill.
      </p>
    </div>

    <template #footer>
      <Button
        label="Cancel"
        severity="secondary"
        outlined
        size="small"
        @click="emit('update:visible', false)"
      />
      <Button
        :label="picked.length === 1 ? 'Import 1 skill' : `Import ${picked.length} skills`"
        size="small"
        :disabled="picked.length === 0 || importing"
        data-action="import"
        @click="bringIn"
      />
    </template>
  </Dialog>
</template>

<script setup>
import { computed, ref } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
import { parseSkill } from '@/ai/skills/format.js'
import { withName } from '@/ai/skills/form.js'
import { describeKind, waitingOn } from '@/ai/skills/runner.js'
import { useSkills } from '@/composables/useSkills'
import { useToast } from '@/composables/useToast'

/**
 * What an import found, before any of it is kept: each skill, whether its file
 * reads, whether it would replace one of the writer's own, and whether its name
 * needs changing to come in at all. The writer chooses; nothing is kept until
 * they do. See composables/useSkills.js.
 */

/** @typedef {import('@/ai/skills/bundle.js').FoundSkill} FoundSkill */
/** @typedef {import('@/composables/useSkills.js').ImportRow} ImportRow */

const props = defineProps({
  visible: { type: Boolean, default: false },
  /** @type {import('vue').PropType<FoundSkill[]>} */
  found: { type: Array, required: true },
  /** Files that were in no skill. */
  stray: { type: Array, default: () => [] },
})

const emit = defineEmits(['update:visible', 'imported'])

const skillsApi = useSkills()
const toast = useToast()

/** What was found, with any names the writer has changed. */
const sources = ref(props.found.map(one => ({ ...one })))

/** What would happen to each, as it stands. */
const rows = computed(() => skillsApi.planImport(sources.value))

/** The ones the writer has said to leave out, by where they are in the list. */
const skipped = ref(/** @type {Set<number>} */ (new Set()))

/** @param {ImportRow} row */
const importable = row => row.errors.length === 0 && !row.problem

/** @param {number} index */
const chosen = index => importable(rows.value[index]) && !skipped.value.has(index)

/**
 * @param {number} index
 * @param {boolean} on
 */
const choose = (index, on) => {
  const next = new Set(skipped.value)
  if (on) next.delete(index)
  else next.add(index)
  skipped.value = next
}

/**
 * @param {number} index
 * @param {string} name
 */
const rename = (index, name) => {
  sources.value[index] = {
    ...sources.value[index],
    text: withName(sources.value[index].text, name),
  }
}

/** @param {ImportRow} row */
const kindOf = row => {
  const read = parseSkill(row.text)
  if ('errors' in read) return ''
  const waiting = waitingOn(read.skill)
  return waiting ? `${describeKind(read.skill)}. ${waiting}` : describeKind(read.skill)
}

const picked = computed(() => rows.value.filter((row, index) => chosen(index)))

const importing = ref(false)

const bringIn = async () => {
  importing.value = true
  try {
    const { imported, failed } = await skillsApi.importSkills(picked.value)
    if (imported > 0) {
      toast.success(imported === 1 ? 'Imported 1 skill.' : `Imported ${imported} skills.`)
    }
    if (failed.length > 0) toast.error(failed.join(' '))
    emit('imported')
    emit('update:visible', false)
  } finally {
    importing.value = false
  }
}
</script>
