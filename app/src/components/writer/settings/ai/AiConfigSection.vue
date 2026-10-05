<template>
  <div class="flex flex-col px-2 pt-2 pb-1">
    <AiPresetGroup />
  </div>
</template>

<script setup>
/**
 * The AI settings, as the settings dialog shows them.
 *
 * The same group a chat's own settings show, and deliberately the same
 * component: the preset is app-wide, so two copies of the controls for it
 * would be two ways to change one thing, and the day they disagreed would be
 * somebody's bug report. This is the one that has to exist, because a fresh
 * install has no chat to open and no provider set up yet.
 */
import AiPresetGroup from './AiPresetGroup.vue'
</script>
