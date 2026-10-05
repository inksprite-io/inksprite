<template>
  <!-- One line, whatever it says: a spinner is the height of the text beside
       it, and a long name is cut short rather than wrapped, so the box stays
       the height of "Thinking…" as the line changes. What is cut is the
       description and never the time, which is the part that tells a long
       wait from a hung one. -->
  <div
    class="flex-1 min-w-0 h-5 flex items-center gap-2 text-sm font-medium text-surface-500"
    role="status"
    data-chat-status
  >
    <i class="pi pi-spin pi-spinner text-xs flex-none" aria-hidden="true" />
    <span v-if="line" class="truncate" :title="line" data-chat-status-line>{{ line }}</span>
    <span v-if="elapsed" class="flex-none tabular-nums" data-chat-status-time>· {{ elapsed }}</span>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { describeRound } from '@/ai/tools/progress.js'

/**
 * What a turn is doing while nothing streams: its tools running, or the model
 * taking in what they returned before it says anything more. The second is
 * the long one — a whole document read in before the first token — and
 * nothing comes back from the provider during it, so the line says how long
 * it has been rather than leave the writer wondering whether anything is
 * happening at all.
 *
 * Shown in the head of the message's thinking box, which says "Thinking…"
 * the rest of the time, so the turn's status is always in the one place.
 *
 * @typedef {Object} Props
 * @property {import('@/composables/useAIChat.js').TurnActivity} activity
 */
const props = defineProps({
  /** @type {import('vue').PropType<import('@/composables/useAIChat.js').TurnActivity>} */
  activity: { type: Object, required: true },
})

/** A wait shorter than this says nothing about time: a clock that flickers is noise. */
const SHOW_TIME_AFTER_MS = 3000

/**
 * How often the clock looks. Four times a second rather than once: ticking
 * each second from whenever the line appeared, it ran up to a second behind
 * the wait it was counting.
 */
const TICK_MS = 250

const now = ref(Date.now())
/** @type {number|undefined} */
let ticking
onMounted(() => {
  ticking = window.setInterval(() => (now.value = Date.now()), TICK_MS)
})
// A new wait starts counting from its own start, not from the last tick.
watch(
  () => props.activity.since,
  () => (now.value = Date.now())
)
onBeforeUnmount(() => window.clearInterval(ticking))

/**
 * @param {number} ms
 * @returns {string}
 */
const formatElapsed = ms => {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}

const elapsed = computed(() => {
  const since = props.activity.since
  if (!since) return ''
  const ms = now.value - since
  return ms >= SHOW_TIME_AFTER_MS ? formatElapsed(ms) : ''
})

const calls = computed(() => props.activity.calls || [])

/** What the wait is, without how long: the time is kept apart, so it is never cut. */
const line = computed(() => {
  const { phase } = props.activity
  if (phase === 'calling' || phase === 'running') return `${describeRound(calls.value, false)}…`
  const parts = [
    calls.value.length ? describeRound(calls.value, true) : '',
    // Before the turn's first call, the wait says nothing until it has gone
    // on long enough to have a time to show.
    calls.value.length || elapsed.value ? 'waiting for the model' : '',
  ].filter(Boolean)
  const text = parts.join(' · ')
  return text.charAt(0).toUpperCase() + text.slice(1)
})
</script>
