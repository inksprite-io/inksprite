<template>
  <component :is="Analytics" v-if="Analytics" />
  <AppToast />
  <JobsToastHost />
  <LibraryMoveToast />
  <RouterView />
  <ConfirmDialog :pt="{ root: { class: 'max-w-lg' } }" />
</template>

<script setup>
import { defineAsyncComponent, onBeforeUnmount, onMounted, watch } from 'vue'
import { RouterView } from 'vue-router'
import ConfirmDialog from 'primevue/confirmdialog'
import AppToast from './components/common/AppToast.vue'
import JobsToastHost from './components/writer/jobs/JobsToastHost.vue'
import LibraryMoveToast from './components/writer/settings/LibraryMoveToast.vue'
import { useTheme } from './composables/useSystemSettings'
import { useSkills } from './composables/useSkills'
import { useApplicationState } from './composables/useApplicationState'
import { setExperimentalSkills } from './ai/skills/index.js'
import { useUpdates } from './composables/useUpdates'
import { useSaveBeforeClosing } from './composables/useSaveBeforeClosing'
import { useLibraryNotices } from './composables/useLibraryNotices'
import { useLibraryMove } from './composables/useLibraryMove'
import { useSettingsFileNotice } from './composables/useSettingsFile'
import { projectsToMove } from './storage/open.js'
import { useJobsStore } from './stores/jobsStore.js'
import { useCardLibraryStore } from './stores/cardLibraryStore.js'
import { decideExtensions } from './extensions/index.js'
import { openLinkClicked } from './platform/open.js'

// Page views go to Vercel Web Analytics only from a build that asks for them
// with VITE_VERCEL_ANALYTICS=true, as the project's own site does. The value
// is fixed when the app is built, so any other build — a fork, the desktop
// app, a local server — leaves the package out entirely and sends nothing.
const Analytics =
  import.meta.env.VITE_VERCEL_ANALYTICS === 'true'
    ? defineAsyncComponent(() => import('@vercel/analytics/vue').then(module => module.Analytics))
    : null

// The writer's own skills are the model's tools and the writer's commands, in
// every chat, so the library is read as the app opens rather than when a
// screen that lists it first does.
useSkills()

// The experimental skills come and go with the writer's switches for them, in
// the same moment, so nothing made from the skills reads a switch as it was.
const { experimentalSkills } = useApplicationState()
watch(experimentalSkills, names => setExperimentalSkills(names), {
  immediate: true,
  flush: 'sync',
})

// The jobs left from before are counted as the app opens, so the Jobs button
// is there for them; they are read in when the jobs toast first opens.
useJobsStore().countJobs()

// The card library is counted the same way, so its button is there once it
// has cards in it; they are read in when it first opens.
useCardLibraryStore().countCards()

// An extension never decided is decided once, from whether what it holds is
// already in use: roleplay stays on for a writer who roleplays.
decideExtensions()

// The page is in the writer's theme, and follows the system's while that is
// the theme chosen.
useTheme()

// In the desktop app, an update is looked for as it opens, and offered once
// it is downloaded.
useUpdates()

// In the desktop app, what the writer just did is saved before the window
// closes or the app quits.
useSaveBeforeClosing()

// In the desktop app, a file changed elsewhere and saved over goes to the
// trash first, and the writer is told.
useLibraryNotices()

// In the desktop app, what the settings file a script left changed as the app
// opened, or why it couldn't be imported.
useSettingsFileNotice()

// In the desktop app, projects the app kept that are still to be moved into
// the folder are moved as it opens: the first time it opens with one, or
// after it was closed during a move.
const libraryMove = useLibraryMove()

onMounted(() => {
  if (projectsToMove()) libraryMove.moveIn()
  // A link to another site, in a chat or anywhere else, opens outside the
  // app rather than in its place.
  document.addEventListener('click', openLinkClicked)
})

onBeforeUnmount(() => document.removeEventListener('click', openLinkClicked))
</script>
