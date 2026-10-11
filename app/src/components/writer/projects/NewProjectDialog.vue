<template>
  <Dialog
    :visible="visible"
    class="w-screen md:w-[30rem]"
    modal
    :closable="true"
    :draggable="false"
    header="New project"
    :pt="{ root: { class: 'shadow-xl' } }"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="flex flex-col gap-4">
      <!-- Title input. The dialog puts the focus here as it opens, so the
           writer can type the name straight away. -->
      <div class="flex flex-col gap-2">
        <label
          for="new-project-title"
          class="text-sm font-medium text-surface-700 dark:text-surface-300"
          >Title</label
        >
        <InputText
          id="new-project-title"
          v-model="title"
          placeholder="Untitled project"
          class="w-full"
          autofocus
          @keydown.enter="handleCreate"
        />
      </div>
    </div>

    <template #footer>
      <div class="flex justify-end gap-2">
        <Button label="Cancel" severity="secondary" text @click="handleCancel" />
        <Button label="Create" @click="handleCreate" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, watch, toRef } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'

const props = defineProps({
  visible: {
    type: Boolean,
    required: true,
  },
})

const emit = defineEmits(['update:visible', 'create'])

const title = ref('')

// Reset form when dialog opens
watch(toRef(props, 'visible'), visible => {
  if (visible) title.value = ''
})

function handleCancel() {
  emit('update:visible', false)
}

function handleCreate() {
  emit('create', { title: title.value.trim() || 'Untitled project' })
  emit('update:visible', false)
}
</script>
