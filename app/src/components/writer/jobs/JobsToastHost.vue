<template>
  <!-- A stack of its own, bottom left beside the rail's Jobs button, apart
       from the passing toasts at the top right and clear of the chat's
       input. On a phone, which has no rail (`useScreenSize`, under 768px),
       it spans the width. -->
  <Toast
    group="jobs"
    position="bottom-left"
    :style="{ width: '24rem', left: 'calc(48px + 0.75rem)', bottom: '0.75rem' }"
    :breakpoints="{ '767px': { width: 'calc(100vw - 1.5rem)', left: '0.75rem', right: '0.75rem' } }"
  >
    <template #container="{ closeCallback }">
      <JobsToast @close="close(closeCallback)" />
    </template>
  </Toast>
</template>

<script setup>
import { watch } from 'vue'
import Toast from 'primevue/toast'
import { useToast } from 'primevue/usetoast'
import JobsToast from './JobsToast.vue'
import { useJobsToast } from '@/composables/useJobsToast.js'

/**
 * Shows the jobs toast when it is opened — a job started, the rail's Jobs
 * button — and takes it away when it is put away from the rail. One toast,
 * however many jobs.
 */
const toast = useToast()
const jobsToast = useJobsToast()

watch(
  () => jobsToast.state.open,
  open => {
    if (!open) {
      toast.removeGroup('jobs')
      return
    }
    // No severity of PrimeVue's, and none of its frame: the card is the toast.
    toast.add({
      group: 'jobs',
      severity: 'jobs',
      summary: 'Jobs',
      styleClass: '!bg-transparent !border-0 !shadow-none !outline-none',
    })
  }
)

/** @param {() => void} closeCallback */
const close = closeCallback => {
  closeCallback()
  jobsToast.closed()
}
</script>
