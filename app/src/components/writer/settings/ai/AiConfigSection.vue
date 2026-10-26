<template>
  <div class="flex flex-col px-2 pt-2 pb-1">
    <AiPresetGroup />
  </div>
</template>

<script setup>
/**
 * The AI settings, as the settings dialog and the welcome show them: the
 * preset the AI runs on. Neither shows them while the AI is switched off,
 * which is done in Settings › System.
 *
 * The only place a preset is edited: a chat picks one, and its settings open
 * this on it. It has to be here rather than in a chat, because a fresh
 * install has no chat to open and no provider set up yet.
 */
import AiPresetGroup from './AiPresetGroup.vue'
</script>
