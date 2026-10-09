<template>
  <div class="flex flex-col gap-4" data-skill-editor data-built-in>
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
      <h3 class="flex-1 min-w-0 truncate text-base font-semibold">{{ label }}</h3>
      <span class="text-xs text-surface-400 flex-none">built-in</span>
    </div>

    <p class="text-xs text-surface-600 dark:text-surface-300">{{ skill.summary }}</p>

    <div class="flex flex-col gap-1">
      <SettingLabel
        label="Instructions"
        :overridden="changed"
        :reset-tooltip="`Back to the wording ${label} ships with`"
        @reset="reset"
      />
      <Textarea
        v-model="draft"
        auto-resize
        rows="12"
        size="small"
        class="w-full font-mono text-sm"
        :aria-label="`${label} instructions`"
        data-field="body"
        @input="save"
      />
      <p class="text-xs text-surface-500 dark:text-surface-400" data-scope>{{ scope }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import Textarea from 'primevue/textarea'
import SettingLabel from '@/components/common/SettingLabel.vue'
import { BUILT_IN_SKILLS, skillLabel } from '@/ai/skills/index.js'
import { useSkills } from '@/composables/useSkills'
import { useProfiles } from '@/composables/useProfiles'

/**
 * A skill that ships with the app, reworded for every chat. Only its
 * instructions are the writer's: what the model calls it by, and the code that
 * runs it, are the app's, and keep improving with it.
 *
 * Saved as it is typed, like a profile's wording of it in a chat's settings,
 * which still wins over this one in the chats on that profile.
 */

const props = defineProps({
  /** The built-in's name. */
  name: { type: String, required: true },
})

const emit = defineEmits(['close'])

const skillsApi = useSkills()
const { profiles } = useProfiles()

const skill = /** @type {import('@/ai/skills/index.js').Skill} */ (
  BUILT_IN_SKILLS.find(one => one.name === props.name)
)
const label = skillLabel(skill)

/**
 * The text as it is being typed. Read once, when the editor opens: nothing
 * else changes this wording, and a value echoed back mid-keystroke would move
 * the caret.
 */
const draft = ref(skillsApi.wordingOf(props.name) ?? skill.body)

const changed = computed(() => draft.value.trim() !== skill.body.trim())

const save = () => skillsApi.setWording(props.name, draft.value)

/** Back to the file's words, which the app keeps improving. */
const reset = () => {
  draft.value = skill.body
  save()
}

/**
 * Where this wording reaches: every chat, but those on a profile that words
 * the skill its own way, as Roleplay does Compact.
 */
const scope = computed(() => {
  const own = profiles.value
    .filter(profile => profile.settings?.skills?.[props.name]?.prompt?.trim())
    .map(profile => profile.name)
  if (own.length === 0) return 'Applies to every chat.'
  const names = own.length === 1 ? own[0] : `${own.slice(0, -1).join(', ')} and ${own.at(-1)}`
  return `Applies to every chat but those on ${names}, which ${own.length === 1 ? 'has its own' : 'have their own'}.`
})
</script>
