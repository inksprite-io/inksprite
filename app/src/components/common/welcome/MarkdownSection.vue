<template>
  <!-- eslint-disable-next-line vue/no-v-html -- the welcome's Markdown is ours, and markdown-it escapes HTML -->
  <div :class="TEXT" v-html="html" />
</template>

<script setup>
/**
 * One of the welcome's sections, written in a Markdown file beside it
 * (`welcome.md`, `getting-started.md`, `feedback.md`, `terms.md`).
 */
import { computed } from 'vue'
import { TEXT, render } from './markdown.js'

const props = defineProps({
  /** The section's Markdown. */
  source: { type: String, required: true },
  /** Whether each part the Markdown names is shown. */
  when: { type: Object, default: () => ({}) },
})

const html = computed(() => render(props.source, { when: props.when }))
</script>
