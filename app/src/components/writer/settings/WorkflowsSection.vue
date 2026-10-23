<template>
  <div class="flex flex-col gap-6 px-2 pt-2 pb-1">
    <WorkflowSettings v-slot="{ settings, pick }" name="convert" title="Convert to Markdown">
      <div class="flex items-center justify-between gap-2">
        <label
          for="workflow-convert-on-import"
          class="text-xs font-medium text-surface-700 dark:text-surface-200"
        >
          Convert documents on import
        </label>
        <ToggleSwitch
          input-id="workflow-convert-on-import"
          :model-value="settings.onImport === true"
          class="flex-none"
          @update:model-value="pick({ onImport: $event })"
        />
      </div>
    </WorkflowSettings>
  </div>
</template>

<script setup>
import ToggleSwitch from 'primevue/toggleswitch'
import WorkflowSettings from './WorkflowSettings.vue'

/**
 * The workflows, each on a model of its own: converting a document to
 * Markdown. Explore runs on the chat's model, and has no workflow.
 */
</script>
