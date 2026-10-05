<template>
  <!-- One line, the height of the text: a spinner, what the job is doing cut
       short rather than wrapped, and how long the job has run, which is
       never cut. The characters coming back are what tell a long answer
       from a hung one; the time is what the whole job has taken so far. -->
  <div
    class="flex-1 min-w-0 h-5 flex items-center gap-2 text-xs font-medium text-surface-500 dark:text-surface-400"
    role="status"
    data-job-status-line
  >
    <i class="pi pi-spin pi-spinner text-xs flex-none" aria-hidden="true" />
    <span class="truncate" :title="line">{{ line }}</span>
    <span v-if="elapsed" class="flex-none tabular-nums" data-job-status-time>· {{ elapsed }}</span>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatElapsed } from '@/composables/useJobs.js'

/**
 * What a running job is doing now: the step in hand, how the model is
 * getting on with it, and how long the job has run in all. The same line
 * the chat's thinking box shows for a turn, but timed over the whole job:
 * a step's time says little when there are twenty of them, and the total
 * is what says how long the next one of these will take.
 *
 * @typedef {Object} Props
 * @property {string} step - The step's label: `Pages 12–19`
 * @property {import('@/jobs/live.js').JobActivity|null} activity
 * @property {number} elapsed - How long the job ran before this run, in ms
 */
const props = defineProps({
  step: { type: String, default: '' },
  /** @type {import('vue').PropType<import('@/jobs/live.js').JobActivity|null>} */
  activity: { type: Object, default: null },
  elapsed: { type: Number, default: 0 },
})

const TICK_MS = 250
const now = ref(Date.now())
/** @type {number|undefined} */
let ticking
onMounted(() => {
  ticking = window.setInterval(() => (now.value = Date.now()), TICK_MS)
})
watch(
  () => props.activity?.since,
  () => (now.value = Date.now())
)
onBeforeUnmount(() => window.clearInterval(ticking))

const elapsed = computed(() => {
  const started = props.activity?.started
  return started ? formatElapsed(props.elapsed + (now.value - started)) : ''
})

const line = computed(() => {
  const { phase, detail, chars } = props.activity || {}
  const what = {
    asking: chars ? `${chars.toLocaleString()} characters back` : 'waiting for the model',
    checking: 'checking the answer',
    retrying: 'asking again in two halves',
    fallback: 'keeping the text as read for a part that would not convert',
    finishing: 'writing the result',
  }[phase || 'asking']
  return [props.step, detail, what].filter(Boolean).join(' · ')
})
</script>
