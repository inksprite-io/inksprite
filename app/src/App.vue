<template>
  <component :is="Analytics" v-if="Analytics" />
  <AppToast />
  <JobsToastHost />
  <RouterView />
  <ConfirmDialog />
</template>

<script setup>
import { defineAsyncComponent, onMounted } from 'vue'
import { RouterView } from 'vue-router'
import ConfirmDialog from 'primevue/confirmdialog'
import AppToast from './components/common/AppToast.vue'
import JobsToastHost from './components/writer/jobs/JobsToastHost.vue'
import { applyTheme } from './composables/useSystemSettings'
import { useApplicationState } from './composables/useApplicationState'
import { useSkills } from './composables/useSkills'

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

onMounted(() => {
  const { theme } = useApplicationState()
  applyTheme(theme.value)
})
</script>
