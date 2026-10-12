<template>
  <component :is="Analytics" v-if="Analytics" />
  <AppToast />
  <JobsToastHost />
  <LibraryMoveToast />
  <RouterView />
  <ConfirmDialog :pt="{ root: { class: 'max-w-lg' } }" />
</template>

<script setup>
import { defineAsyncComponent, onBeforeUnmount, onMounted } from 'vue'
import { RouterView } from 'vue-router'
import ConfirmDialog from 'primevue/confirmdialog'
import AppToast from './components/common/AppToast.vue'
import JobsToastHost from './components/writer/jobs/JobsToastHost.vue'
import LibraryMoveToast from './components/writer/settings/LibraryMoveToast.vue'
import { applyTheme } from './composables/useSystemSettings'
import { useApplicationState } from './composables/useApplicationState'
import { useSkills } from './composables/useSkills'
import { useUpdates } from './composables/useUpdates'
import { useLibraryNotices } from './composables/useLibraryNotices'
import { useLibraryMove } from './composables/useLibraryMove'
import { projectsToMove } from './storage/open.js'
import { useJobsStore } from './stores/jobsStore.js'
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

// The jobs left from before are counted as the app opens, so the Jobs button
// is there for them; they are read in when the jobs toast first opens.
useJobsStore().countJobs()

// In the desktop app, an update is looked for as it opens, and offered once
// it is downloaded.
useUpdates()

// In the desktop app, a file changed elsewhere and saved over goes to the
// trash first, and the writer is told.
useLibraryNotices()

// In the desktop app, projects the app kept that are still to be moved into
// the folder are moved as it opens: the first time a run from the checkout
// opens, or after it was closed during a move.
const libraryMove = useLibraryMove()

onMounted(() => {
  if (projectsToMove()) libraryMove.moveIn()
  const { theme } = useApplicationState()
  applyTheme(theme.value)
  // A link to another site, in a chat or anywhere else, opens outside the
  // app rather than in its place.
  document.addEventListener('click', openLinkClicked)
})

onBeforeUnmount(() => document.removeEventListener('click', openLinkClicked))
</script>
