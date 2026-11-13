<template>
  <div class="flex flex-col gap-3" data-skill-editor data-built-in>
    <div class="flex flex-col gap-1">
      <SettingLabel
        label="Instructions"
        :overridden="isSkillReworded(name)"
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
        @input="setSkillPrompt(name, draft)"
      />
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import Textarea from 'primevue/textarea'
import SettingLabel from '@/components/common/SettingLabel.vue'
import { BUILT_IN_SKILLS, skillLabel } from '@/ai/skills/index.js'
import { useChatSettings } from '@/composables/useChatSettings'

/**
 * A skill that ships with the app, reworded for the profile the chat showing
 * runs on, in its card in the skill library, which names it. Only its
 * instructions are the writer's: what the model calls it by, and the code
 * that runs it, are the app's, and keep improving with it. Saved as it is
 * typed, on the profile, for every chat on it (`setSkillPrompt`).
 *
 * @typedef {Object} Props
 * @property {string} name - The built-in's name
 * @property {string} [storyId] - The project open
 * @property {string} [chatId] - The chat showing in it; with none, the
 *   profile is the one new chats start on
 */
const props = defineProps({
  name: { type: String, required: true },
  storyId: { type: String, default: '' },
  chatId: { type: String, default: '' },
})

const { skillPromptOf, setSkillPrompt, resetSkill, isSkillReworded } = useChatSettings(
  props.storyId,
  () => props.chatId
)

const label = skillLabel(
  /** @type {import('@/ai/skills/index.js').Skill} */ (
    BUILT_IN_SKILLS.find(one => one.name === props.name)
  )
)

/**
 * The text as it is being typed. Read once, when the editor opens, which it
 * does afresh for each profile: a value echoed back mid-keystroke would move
 * the caret.
 */
const draft = ref(skillPromptOf(props.name))

const reset = () => {
  resetSkill(props.name)
  draft.value = skillPromptOf(props.name)
}
</script>
