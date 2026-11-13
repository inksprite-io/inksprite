<template>
  <Dialog
    :visible="visible"
    :header="header"
    modal
    :draggable="false"
    :dismissable-mask="true"
    class="w-[min(24rem,95vw)]"
    data-profile-name-dialog
    @update:visible="$emit('update:visible', $event)"
  >
    <form class="flex flex-col gap-4" @submit.prevent="submit">
      <!-- The dialog focuses what has autofocus as it opens. -->
      <InputText
        v-model="draft"
        size="small"
        class="w-full"
        aria-label="Name"
        autofocus
        data-field="profile-name"
        @focus="selectAll"
      />
      <div class="flex justify-end gap-2">
        <Button
          label="Cancel"
          size="small"
          severity="secondary"
          text
          @click="$emit('update:visible', false)"
        />
        <Button
          type="submit"
          :label="action"
          size="small"
          :disabled="!draft.trim()"
          data-action="save-profile-name"
        />
      </div>
    </form>
  </Dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'

/**
 * A profile's name, asked for: a new one's, or one being renamed. Opens with
 * the name given selected, so typing replaces it and Enter keeps it.
 *
 * @typedef {Object} Props
 * @property {boolean} visible
 * @property {string} header - What the dialog is for: New profile, Rename profile
 * @property {string} action - Its button: Create, Rename
 * @property {string} [name] - The name it opens with
 */
const props = defineProps({
  visible: { type: Boolean, default: false },
  header: { type: String, required: true },
  action: { type: String, required: true },
  name: { type: String, default: '' },
})

/** `save`: the name typed, trimmed. */
const emit = defineEmits(['update:visible', 'save'])

const draft = ref(props.name)

watch(
  () => [props.visible, props.name],
  () => {
    if (props.visible) draft.value = props.name
  }
)

/** @param {FocusEvent} event */
const selectAll = event => /** @type {HTMLInputElement} */ (event.target).select()

const submit = () => {
  const name = draft.value.trim()
  if (!name) return
  emit('save', name)
  emit('update:visible', false)
}
</script>
