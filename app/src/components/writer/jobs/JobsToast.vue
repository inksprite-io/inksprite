<template>
  <!-- The toast's own face, drawn whole: PrimeVue gives the container, this
       fills it with the jobs, the ways to stop, go on or clear each, and the
       way to close it. -->
  <div
    class="w-full rounded-lg border border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-900 shadow-lg p-3 flex flex-col gap-3"
    role="region"
    aria-label="Jobs"
    data-jobs-toast
  >
    <div class="flex items-center gap-2">
      <InProcessIcon :size="18" class="text-surface-500 dark:text-surface-400" />
      <span class="flex-1 text-sm font-semibold text-surface-800 dark:text-surface-100">Jobs</span>
      <span
        v-if="runningCount > 0"
        class="text-xs text-surface-500 dark:text-surface-400"
        data-jobs-running
      >
        {{ runningCount }} running
      </span>
      <Button
        icon="pi pi-times"
        text
        rounded
        size="small"
        severity="secondary"
        aria-label="Close"
        data-action="close-jobs-toast"
        @click="$emit('close')"
      />
    </div>

    <p
      v-if="jobs.length === 0"
      class="text-sm text-center text-surface-400 dark:text-surface-500 py-2"
      data-jobs-empty
    >
      No running jobs
    </p>
    <ul v-else class="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1">
      <li
        v-for="job in jobs"
        :key="job.id"
        class="flex flex-col gap-1"
        :data-job-id="job.id"
        :data-job-status="job.status"
      >
        <div class="flex items-start gap-2">
          <span
            class="flex-1 min-w-0 truncate text-xs font-medium text-surface-700 dark:text-surface-200"
          >
            {{ job.title }}
          </span>
          <span
            class="flex-none text-[11px] px-1.5 rounded-full"
            :class="toneOf(job.status)"
            data-job-badge
          >
            {{ job.status }}
          </span>
        </div>
        <!-- The project gives way first: how far the job got, and for how
             long, is what the line is for. -->
        <div class="flex min-w-0 text-xs text-surface-500 dark:text-surface-400" data-job-where>
          <span class="truncate">{{ projectOf(job) }}</span>
          <span class="flex-none whitespace-pre"> · {{ describe(job) }}</span>
        </div>
        <ProgressBar
          :value="Math.round(progressOf(job).fraction * 100)"
          :show-value="false"
          style="height: 4px"
        />
        <JobStatus
          v-if="job.status === 'running'"
          :step="stepOf(job)"
          :activity="activity[job.id] || null"
          :elapsed="job.elapsed || 0"
        />
        <p
          v-if="job.error"
          class="text-xs text-red-600 dark:text-red-400 break-words"
          data-job-error
        >
          {{ job.error }}
        </p>
        <div class="flex gap-1 justify-end">
          <Button
            v-if="job.status === 'running'"
            label="Pause"
            icon="pi pi-pause"
            size="small"
            text
            @click="pause(job.id)"
          />
          <Button
            v-if="job.status === 'paused' || job.status === 'failed' || job.status === 'queued'"
            :label="job.status === 'failed' ? 'Retry' : 'Resume'"
            icon="pi pi-play"
            size="small"
            text
            @click="resume(job.id)"
          />
          <Button
            v-if="job.status === 'running' || job.status === 'paused' || job.status === 'failed'"
            label="Cancel"
            icon="pi pi-times"
            size="small"
            text
            severity="secondary"
            @click="cancel(job.id)"
          />
          <Button
            v-if="job.status === 'done' || job.status === 'cancelled'"
            label="Clear"
            icon="pi pi-trash"
            size="small"
            text
            severity="secondary"
            @click="remove(job.id)"
          />
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import Button from 'primevue/button'
import ProgressBar from 'primevue/progressbar'
import JobStatus from './JobStatus.vue'
import InProcessIcon from '@/components/icons/InProcessIcon.vue'
import { formatElapsed, useJobs } from '@/composables/useJobs.js'

/**
 * The long jobs, all of them, whichever project each is for: what each is
 * doing, how far it is and how long it has run, and the ways to pause it,
 * take it up again, stop it, or clear it once it is over. A job interrupted
 * by a reload comes back paused, with its finished steps kept.
 */
defineEmits(['close'])

const { jobs, load, pause, resume, cancel, remove, progressOf, projectOf, activity } = useJobs()

onMounted(load)

const runningCount = computed(() => jobs.value.filter(job => job.status === 'running').length)

/** The label of the step a job is on. @param {import('@/types/models.js').Job} job */
const stepOf = job => job.steps.find(step => step.status === 'running')?.label || ''

/**
 * How far a job got and — once it has stopped — how long it ran. A running
 * job's time is on its status line.
 * @param {import('@/types/models.js').Job} job
 */
const describe = job => {
  const { done, total } = progressOf(job)
  const time = job.status !== 'running' && job.elapsed ? formatElapsed(job.elapsed) : ''
  return job.status === 'done'
    ? `${total} ${total === 1 ? 'step' : 'steps'} done${time ? ` in ${time}` : ''}`
    : `${done} of ${total} done${time ? ` · ${time}` : ''}`
}

/** @param {import('@/types/models.js').Job['status']} status */
const toneOf = status =>
  ({
    running: 'bg-primary-100 text-primary-800 dark:bg-primary-900 dark:text-primary-100',
    done: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
    paused: 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-100',
    cancelled: 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-200',
    queued: 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-200',
  })[status] || ''
</script>
