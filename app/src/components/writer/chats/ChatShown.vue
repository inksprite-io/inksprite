<template>
  <!-- An answer a tool put in front of the writer as it is, where the call
       sits in the turn: what explore made of a folder. Open, because reading
       it is the point, with anything long folded under it. -->
  <div
    class="rounded-lg bg-teal-500/10 border border-surface-200 dark:border-surface-700/50 overflow-hidden"
    data-shown
  >
    <div class="text-sm px-3 pt-2 flex items-center gap-2">
      <i
        v-if="shown.icon"
        class="pi text-xs text-teal-700 dark:text-teal-300"
        :class="shown.icon"
        aria-hidden="true"
      />
      <span class="text-sm font-medium text-surface-500" data-shown-title>{{ shown.title }}</span>
    </div>
    <div
      class="px-3 py-2 prose dark:prose-invert prose-sm max-w-none text-surface-700 dark:text-surface-200"
      data-find-text
      v-html="textHtml"
    />
    <div v-if="shown.more" class="px-3 pb-2 flex flex-col gap-1">
      <button
        type="button"
        class="self-start inline-flex items-center gap-1 text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-200"
        :aria-expanded="expanded"
        data-shown-toggle
        @click="expanded = !expanded"
      >
        <i
          class="pi text-[0.6rem]"
          :class="expanded ? 'pi-chevron-down' : 'pi-chevron-right'"
          aria-hidden="true"
        />
        {{ shown.more.title }}
      </button>
      <pre
        v-show="expanded"
        class="text-xs text-surface-600 dark:text-surface-400 whitespace-pre-wrap break-words m-0 max-h-96 overflow-auto"
        data-shown-more
        >{{ shown.more.text }}</pre
      >
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useTurnState } from '@/composables/useNearTurns.js'
import { renderMarkdown } from '@/utils/markdown'

const props = defineProps({
  /** @type {import('vue').PropType<import('@/types/models.js').ShownResult>} */
  shown: { type: Object, required: true },
  /** What its fold is kept under while the chat is open. See useTurnState. */
  stateKey: { type: String, required: true },
})

const expanded = useTurnState(`${props.stateKey}:more`, false)

const textHtml = computed(() => renderMarkdown(props.shown.text || ''))
</script>
