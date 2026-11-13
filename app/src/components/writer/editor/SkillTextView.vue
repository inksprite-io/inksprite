<template>
  <PlainText
    v-if="skill"
    ref="field"
    :text="skill.text"
    filename="SKILL.md"
    class="h-full w-full"
    @input="write"
  />
</template>

<script setup>
import { computed, ref } from 'vue'
import PlainText from './PlainText.vue'
import { useSkills } from '@/composables/useSkills.js'

/**
 * One of the writer's skills in a tab of the editor's, as its SKILL.md: the
 * frontmatter and the instructions under it, the whole of what the skill is.
 * The same file its card in the settings edits three fields of, kept as it is
 * typed, so what is typed here shows there and anything the card has no field
 * for is changed here.
 *
 * Loaded on its own, the first time one is opened, so that CodeMirror is not
 * in the app until then.
 *
 * @typedef {Object} Props
 * @property {string} skillId
 */
const props = defineProps({
  skillId: { type: String, required: true },
})

const skills = useSkills()

/** The skill as the library has it, or none until the library is read. */
const skill = computed(() => skills.getSkill(props.skillId))

/** @param {string} typed */
const write = typed => skills.writeSkill(props.skillId, typed)

/** @type {import('vue').Ref<{ openFind: () => boolean }|null>} */
const field = ref(null)
defineExpose({ openFind: () => field.value?.openFind() ?? false })
</script>
