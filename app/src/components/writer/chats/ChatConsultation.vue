<template>
  <!-- One skill the turn consulted, folded: its name and the gist of its
       answer; open, what it was asked, what it thought, the tools it called
       and what it answered. A skill it called in turn is a block like this
       one, inside. -->
  <div
    class="rounded-lg bg-emerald-500/15 border border-surface-200 dark:border-surface-700/50 overflow-hidden"
    data-consultation
  >
    <button
      class="w-full text-left text-sm px-3 py-2 flex items-center gap-2 hover:bg-emerald-400/10"
      :aria-expanded="expanded"
      @click="expanded = !expanded"
    >
      <i class="pi pi-sparkles text-xs text-emerald-700 dark:text-emerald-300" />
      <span v-if="consultation.pending" class="thinking-text text-sm font-medium"
        >{{ consultation.label }}…</span
      >
      <span v-else class="text-sm font-medium text-surface-500">{{ consultation.label }}</span>
      <span class="text-xs text-surface-400 truncate" data-consultation-summary>{{ summary }}</span>
    </button>
    <div
      v-show="expanded"
      class="px-3 py-2 border-t-1 border-emerald-500/20 flex flex-col gap-2"
      data-consultation-body
    >
      <div v-if="consultation.asked" class="flex flex-col gap-1">
        <div class="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-300">
          asked
        </div>
        <p class="text-sm text-surface-600 dark:text-surface-300 whitespace-pre-wrap m-0">
          {{ consultation.asked }}
        </p>
      </div>
      <div v-if="consultation.thinking" class="flex flex-col gap-1">
        <div class="text-xs font-mono font-semibold text-emerald-700 dark:text-emerald-300">
          thinking
        </div>
        <pre
          class="text-xs text-surface-500 whitespace-pre-wrap break-words m-0 pl-3 border-l-2 border-surface-300 dark:border-surface-700"
          >{{ consultation.thinking }}</pre
        >
      </div>
      <div v-if="consultation.calls.length > 0" class="flex flex-col gap-2 text-xs">
        <template v-for="(call, index) in consultation.calls" :key="index">
          <ChatConsultation
            v-if="call.skill"
            :consultation="call.skill"
            :state-key="stateKey ? `${stateKey}:${index}` : ''"
          />
          <div v-else class="flex flex-col gap-1">
            <div class="font-mono">
              <span class="font-semibold text-sky-700 dark:text-sky-300">{{ call.name }}</span>
              <span class="text-surface-500">({{ call.args }})</span>
            </div>
            <pre
              class="text-surface-600 dark:text-surface-400 whitespace-pre-wrap break-words m-0 pl-3 border-l-2 border-surface-300 dark:border-surface-700"
              >{{ call.result }}</pre
            >
          </div>
        </template>
      </div>
      <div
        v-if="consultation.answer"
        class="text-sm text-surface-600 dark:text-surface-300 prose dark:prose-invert prose-sm max-w-none"
        v-html="answerHtml"
      />
      <p v-if="consultation.reply" class="text-xs text-surface-500 italic m-0">
        Used as the reply.
      </p>
      <p v-if="consultation.error" class="text-xs text-surface-500 italic m-0">
        {{ consultation.error }}
      </p>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { useTurnState } from '@/composables/useNearTurns.js'
import { renderMarkdown } from '@/utils/markdown'

/** @typedef {import('@/ai/skills/consultations.js').ConsultationView} ConsultationView */

/** How much of the answer the closed header shows. */
const SUMMARY_LIMIT = 80

const props = defineProps({
  /** @type {import('vue').PropType<ConsultationView>} */
  consultation: { type: Object, required: true },
  /**
   * Where the block remembers being open, so it stays open as the chat
   * scrolls it out of view and back. Without one it is the block's own.
   */
  stateKey: { type: String, default: '' },
})

const expanded = props.stateKey ? useTurnState(props.stateKey, false) : ref(false)

/**
 * The gist, for the closed header. While it is still running there is no gist
 * — the pulsing label is already saying that, and a header that flickered
 * through the tail of its answer would be harder to read than silence. One
 * that wrote the reply says so, since the reply is right there below.
 */
const summary = computed(() => {
  const view = props.consultation
  if (view.pending) return ''
  if (view.reply) return 'Wrote the reply'
  const said = view.answer || view.error || ''
  const firstLine = said.split('\n').find(line => line.trim()) || ''
  return firstLine.length > SUMMARY_LIMIT ? `${firstLine.slice(0, SUMMARY_LIMIT)}…` : firstLine
})

/** The answer is prose written to be read, so it renders as prose. */
const answerHtml = computed(() => renderMarkdown(props.consultation.answer || ''))
</script>

<style scoped>
.thinking-text {
  animation: pulse 1.5s infinite ease-in-out;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
}
</style>
