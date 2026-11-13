<template>
  <MarkdownSection :source="welcome" :when="when" data-welcome />
</template>

<script setup>
/**
 * The welcome's first section, written in `welcome.md`: what inksprite is
 * and what people use it for, and in a browser, where the work is kept and
 * what can take it away.
 */
import { isDesktop } from '@/platform/desktop.js'
import { storageAdvice } from '@/platform/persistence.js'
import MarkdownSection from './MarkdownSection.vue'
import welcome from './welcome.md?raw'

/** What the writer is told about keeping their work; nothing in the desktop app, which keeps it on disk. */
const advice = isDesktop() ? null : storageAdvice()

const when = {
  browser: advice !== null,
  'desktop-app': Boolean(advice?.desktopApp),
  safari: Boolean(advice?.clearsAfterAWeek),
  'home-screen': Boolean(advice?.homeScreen),
}
</script>
