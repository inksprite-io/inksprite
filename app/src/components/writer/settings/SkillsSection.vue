<template>
  <div class="flex flex-col gap-3" data-skills-section>
    <!-- A new skill and an import, beside the heading, as a chat's Profiles
         has its plus. -->
    <Teleport defer :to="heading" :disabled="!heading">
      <HeaderButton
        icon="pi pi-upload"
        label="Import skills"
        aria-haspopup="true"
        aria-controls="skill_import_menu"
        data-action="import"
        @click="importMenu?.toggle($event)"
      />
      <HeaderButton icon="pi pi-plus" label="New skill" data-action="new-skill" @click="startNew" />
    </Teleport>
    <Menu id="skill_import_menu" ref="importMenu" :model="importChoices" :popup="true" />
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

    <SkillImportDialog
      v-if="importing"
      :key="importing.key"
      v-model:visible="importing.visible"
      :found="importing.found"
      :stray="importing.stray"
    />

    <!-- The built-ins, then the writer's own where they have any; each opens
         on its wording, or on the whole skill. -->
    <CardList>
      <div data-list="built-in">
        <CardHeading>Built-in</CardHeading>
        <CardItem
          v-for="skill in builtIns"
          :key="skill.name"
          :title="skill.label"
          :subtitle="skill.summary"
          :open="openKey === `built-in:${skill.name}`"
          :data-skill="skill.name"
          @toggle="toggle(`built-in:${skill.name}`)"
        >
          <template #badges>
            <span
              v-if="skill.command"
              class="flex-none text-xs font-mono text-surface-500 dark:text-surface-400"
              >{{ skill.command }}</span
            >
            <span v-if="skill.reworded" class="flex-none text-xs text-surface-400" data-reworded>
              reworded
            </span>
          </template>
          <BuiltInSkillEditor
            :key="`${skill.name}:${selectedProfileId}`"
            :name="skill.name"
            :story-id="storyId"
            :chat-id="chatId"
          />
        </CardItem>
      </div>

      <div
        v-if="yours.length > 0 || drafting"
        class="border-t border-surface-200 dark:border-surface-700"
        data-list="yours"
      >
        <CardHeading>Custom skills</CardHeading>
        <CardItem
          v-for="skill in yours"
          :key="skill.id"
          :title="skill.label"
          :subtitle="skill.summary"
          :open="openKey === skill.id"
          :data-skill="skill.name"
          @toggle="toggle(skill.id)"
        >
          <template #badges>
            <span
              v-if="skill.command"
              class="flex-none text-xs font-mono text-surface-500 dark:text-surface-400"
              >{{ skill.command }}</span
            >
          </template>
          <SkillEditor :key="skill.id" :skill-id="skill.id" :story-id="storyId" @close="shut" />
        </CardItem>
        <!-- One being written, which is not a skill until it is saved. -->
        <CardItem
          v-if="drafting"
          title="New skill"
          open
          data-skill-draft
          @toggle="drafting = false"
        >
          <SkillEditor :story-id="storyId" @made="made" @close="shut" />
        </CardItem>
      </div>
    </CardList>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import Menu from 'primevue/menu'
import CardList from '@/components/common/CardList.vue'
import CardHeading from '@/components/common/CardHeading.vue'
import CardItem from '@/components/common/CardItem.vue'
import SkillEditor from './SkillEditor.vue'
import BuiltInSkillEditor from './BuiltInSkillEditor.vue'
import SkillImportDialog from './SkillImportDialog.vue'
import HeaderButton from '../layout/HeaderButton.vue'
import { useSectionHeading } from '@/components/common/sectionHeading.js'
import { BUILT_IN_SKILLS, skillLabel } from '@/ai/skills/index.js'
import { parseSkill } from '@/ai/skills/format.js'
import { formFromText, nameFromTitle } from '@/ai/skills/form.js'
import { writerCalls } from '@/ai/skills/runner.js'
import { entriesFromFiles, findSkills } from '@/ai/skills/bundle.js'
import { COMMANDS } from '@/ai/commands.js'
import { useSkills } from '@/composables/useSkills'
import { useChatSettings } from '@/composables/useChatSettings'
import { useToast } from '@/composables/useToast'

/**
 * The library: the ones that ship with the app, to reword for the profile
 * the chat showing runs on, and the writer's own, to write and change, each
 * a card that opens on its editor; a new one, written in a card under the
 * rest, and an import, from beside the heading. The library is app-wide: a skill is not
 * any one project's. See `.llm/skills_rework_design.md`.
 *
 * @typedef {Object} Props
 * @property {string} [storyId] - The project open
 * @property {string} [chatId] - The chat showing in it, whose profile's
 *   wording of the built-ins this is
 */
const props = defineProps({
  storyId: { type: String, default: '' },
  chatId: { type: String, default: '' },
})

const skillsApi = useSkills()
const { selectedProfileId, isSkillReworded } = useChatSettings(props.storyId, () => props.chatId)
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
      toast.error('No skills found. A skill is a SKILL.md, or a Markdown file with frontmatter.')
      return
    }
    importing.value = { key: ++imports, visible: true, found: skills, stray }
  } catch (error) {
    console.error('Failed to read skills to import:', error)
    toast.error(`The file couldn’t be read. ${error.message}`)
  }
}

/** Where the plus and the import go: beside the section's heading. */
const heading = useSectionHeading()

/**
 * The card open: one of the writer's skills by its id, or a built-in as
 * `built-in:<name>`.
 */
const openKey = ref(/** @type {string|null} */ (null))

/** A new skill being written, in a card of its own under the rest. */
const drafting = ref(false)

/** @param {string} key */
const toggle = key => {
  drafting.value = false
  openKey.value = openKey.value === key ? null : key
}

/** Shut whichever card is open. */
const shut = () => {
  drafting.value = false
  openKey.value = null
}

/**
 * What the list calls a skill: what its file's name was written as, read as
 * a word where it is only a name, and the name it is kept under where the
 * file gives none.
 *
 * @param {string} written
 * @param {string} kept
 * @returns {string}
 */
const labelOf = (written, kept) => {
  if (!written) return skillLabel({ name: kept })
  return written === nameFromTitle(written) ? skillLabel({ name: written }) : written
}

/** A new skill: a card to write it in, kept once it is saved. */
const startNew = () => {
  openKey.value = null
  drafting.value = true
}

/**
 * The new skill was saved: it is one of the list's now, open where it is.
 *
 * @param {string} id
 */
const made = id => {
  drafting.value = false
  openKey.value = id
}

/**
 * Each of the writer's skills, as the list shows it: what its file calls it
 * and says of it, however much else of the file reads, and its command once
 * it can be called.
 */
const yours = computed(() =>
  skillsApi.skills.value.map(stored => {
    const fields = formFromText(stored.text)
    const read = parseSkill(stored.text)
    const skill = 'skill' in read ? read.skill : null
    const usable = skill && !skillsApi.problemOf(stored)
    return {
      id: stored.id,
      name: stored.name,
      label: labelOf('form' in fields ? fields.form.name : '', stored.name),
      command: usable && writerCalls(skill) ? `/${skill.name}` : '',
      summary: skill?.summary ?? ('form' in fields ? fields.form.description : ''),
    }
  })
)

/** The skills that ship with the app, by name, and whether the profile rewords each. */
const builtIns = computed(() =>
  BUILT_IN_SKILLS.map(skill => ({
    name: skill.name,
    label: skillLabel(skill),
    command: skill.user && skill.name in COMMANDS ? `/${skill.name}` : '',
    summary: skill.summary,
    reworded: isSkillReworded(skill.name),
  })).sort((a, b) => a.label.localeCompare(b.label))
)
</script>
