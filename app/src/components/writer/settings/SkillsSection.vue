<template>
  <div class="flex flex-col gap-4 px-2 pt-2 pb-1" data-skills-section>
    <BuiltInSkillEditor
      v-if="editing?.builtIn"
      :key="editing.key"
      :name="editing.builtIn"
      @close="editing = null"
    />
    <SkillEditor
      v-else-if="editing"
      :key="editing.key"
      :skill-id="editing.id"
      @close="editing = null"
    />

    <template v-else>
      <div class="flex flex-wrap gap-2">
        <Button
          label="New skill"
          icon="pi pi-plus"
          size="small"
          data-action="new-skill"
          @click="open(null)"
        />
        <Button
          label="Import…"
          icon="pi pi-upload"
          severity="secondary"
          outlined
          size="small"
          aria-haspopup="true"
          aria-controls="skill_import_menu"
          data-action="import"
          @click="importMenu?.toggle($event)"
        />
        <Menu id="skill_import_menu" ref="importMenu" :model="importChoices" :popup="true" />
        <Button
          label="Export all"
          icon="pi pi-download"
          severity="secondary"
          outlined
          size="small"
          :disabled="yours.length === 0"
          data-action="export-all"
          @click="exportAll"
        />
        <!-- The two ways in: files or a .zip, and a whole folder. -->
        <input
          ref="filePicker"
          type="file"
          accept=".md,.zip"
          multiple
          class="hidden"
          data-pick="files"
          @change="picked($event)"
        />
        <input
          ref="folderPicker"
          type="file"
          webkitdirectory
          class="hidden"
          data-pick="folder"
          @change="picked($event)"
        />
      </div>

      <SkillImportDialog
        v-if="importing"
        :key="importing.key"
        v-model:visible="importing.visible"
        :found="importing.found"
        :stray="importing.stray"
      />

      <section class="flex flex-col gap-2" data-list="yours">
        <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-100">Yours</h3>
        <p v-if="yours.length === 0" class="text-sm text-surface-500 dark:text-surface-400">
          None yet.
        </p>
        <button
          v-for="skill in yours"
          :key="skill.id"
          type="button"
          class="flex flex-col gap-0.5 rounded-lg px-3 py-2 text-left border border-surface-200 dark:border-surface-700 hover:bg-surface-100 dark:hover:bg-surface-800"
          :data-skill="skill.name"
          @click="open(skill.id)"
        >
          <span class="flex items-center gap-2 min-w-0">
            <span class="text-sm font-medium truncate">{{ skill.label }}</span>
            <span v-if="skill.command" class="text-xs font-mono text-surface-500">
              {{ skill.command }}
            </span>
          </span>
          <span class="text-xs text-surface-500 dark:text-surface-400">{{ skill.kind }}</span>
          <span v-if="skill.summary" class="text-xs text-surface-600 dark:text-surface-300">
            {{ skill.summary }}
          </span>
          <span v-if="skill.problem" class="text-xs text-red-600 dark:text-red-400">
            {{ skill.problem }}
          </span>
          <span
            v-else-if="skill.waiting"
            class="text-xs italic text-surface-500 dark:text-surface-400"
          >
            {{ skill.waiting }}
          </span>
        </button>
      </section>

      <section class="flex flex-col gap-2" data-list="built-in">
        <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-100">Built-in</h3>
        <button
          v-for="skill in builtIn"
          :key="skill.name"
          type="button"
          class="flex flex-col gap-0.5 rounded-lg px-3 py-2 text-left bg-surface-50 dark:bg-surface-900/40 hover:bg-surface-100 dark:hover:bg-surface-800"
          :data-skill="skill.name"
          @click="openBuiltIn(skill.name)"
        >
          <span class="flex items-center gap-2 min-w-0">
            <span class="text-sm font-medium truncate">{{ skill.label }}</span>
            <span v-if="skill.command" class="text-xs font-mono text-surface-500">
              {{ skill.command }}
            </span>
            <span v-if="skill.reworded" class="text-xs text-surface-400" data-reworded>
              reworded
            </span>
          </span>
          <span class="text-xs text-surface-500 dark:text-surface-400">{{ skill.kind }}</span>
          <span class="text-xs text-surface-600 dark:text-surface-300">{{ skill.summary }}</span>
        </button>
      </section>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import Menu from 'primevue/menu'
import SkillEditor from './SkillEditor.vue'
import BuiltInSkillEditor from './BuiltInSkillEditor.vue'
import SkillImportDialog from './SkillImportDialog.vue'
import { BUILT_IN_SKILLS, skillLabel } from '@/ai/skills/index.js'
import { parseSkill } from '@/ai/skills/format.js'
import { describeCallers, waitingOn, writerCalls } from '@/ai/skills/runner.js'
import { entriesFromFiles, findSkills, zipBlob } from '@/ai/skills/bundle.js'
import { COMMANDS } from '@/ai/commands.js'
import { downloadBlob } from '@/files/download.js'
import { useSkills } from '@/composables/useSkills'
import { useToast } from '@/composables/useToast'

/**
 * The library: the writer's own skills, to write and change, and the ones that
 * ship with the app, to reword. App-wide, beside Workflows — a skill is not any
 * one project's. See `.llm/skills_design.md`, part 3.
 */

const skillsApi = useSkills()
const toast = useToast()

const importMenu = ref(/** @type {InstanceType<typeof Menu>|null} */ (null))
const filePicker = ref(/** @type {HTMLInputElement|null} */ (null))
const folderPicker = ref(/** @type {HTMLInputElement|null} */ (null))

const importChoices = [
  { label: 'Files or a .zip…', icon: 'pi pi-file', command: () => filePicker.value?.click() },
  { label: 'A folder…', icon: 'pi pi-folder', command: () => folderPicker.value?.click() },
]

/**
 * What the last import found, while the writer is choosing from it.
 *
 * @type {import('vue').Ref<{key: number, visible: boolean, found: import('@/ai/skills/bundle.js').FoundSkill[], stray: string[]}|null>}
 */
const importing = ref(null)
let imports = 0

/**
 * Read what the writer chose, and show what skills are in it.
 *
 * @param {Event} event
 */
const picked = async event => {
  const input = /** @type {HTMLInputElement} */ (event.target)
  const chosen = Array.from(input.files || [])
  input.value = ''
  if (chosen.length === 0) return

  try {
    const { skills, stray } = findSkills(await entriesFromFiles(chosen))
    if (skills.length === 0) {
      toast.error(
        'There is no skill in that: a skill is a SKILL.md, or a Markdown file with frontmatter.'
      )
      return
    }
    importing.value = { key: ++imports, visible: true, found: skills, stray }
  } catch (error) {
    console.error('Failed to read skills to import:', error)
    toast.error(`That could not be read: ${error.message}`)
  }
}

/** Every skill of the writer's, as a `.zip` of their folders. */
const exportAll = () => {
  downloadBlob(zipBlob(skillsApi.skills.value), 'inksprite-skills.zip')
}

/** The skill being written, or none while the list shows. */
const editing = ref(/** @type {{id: string|null, builtIn?: string, key: number}|null} */ (null))
let opened = 0

/** @param {string|null} id - A skill of theirs, or none for a new one */
const open = id => {
  editing.value = { id, key: ++opened }
}

/** @param {string} name - A skill that ships with the app */
const openBuiltIn = name => {
  editing.value = { id: null, builtIn: name, key: ++opened }
}

/** Each of the writer's skills, as the list shows it: read from its file. */
const yours = computed(() =>
  skillsApi.skills.value.map(stored => {
    const read = parseSkill(stored.text)
    if ('errors' in read) {
      return {
        id: stored.id,
        name: stored.name,
        label: skillLabel(stored),
        command: '',
        kind: 'Does not read',
        summary: '',
        problem: read.errors[0],
        waiting: '',
      }
    }
    const { skill } = read
    return {
      id: stored.id,
      name: skill.name,
      label: skillLabel(skill),
      command: writerCalls(skill) ? `/${skill.name}` : '',
      kind: describeCallers(skill),
      summary: skill.summary,
      problem: '',
      waiting: waitingOn(skill),
    }
  })
)

/** The skills that ship with the app, and whether the writer has reworded each. */
const builtIn = computed(() =>
  BUILT_IN_SKILLS.map(skill => ({
    name: skill.name,
    label: skillLabel(skill),
    command: skill.user && skill.name in COMMANDS ? `/${skill.name}` : '',
    kind: describeCallers(skill),
    summary: skill.summary,
    reworded: skillsApi.wordingOf(skill.name) !== null,
  }))
)

defineExpose({ open })
</script>
