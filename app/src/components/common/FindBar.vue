<template>
  <!-- Keys stay here: Escape closes the find and nothing beneath it, such as a
       reply being written, which Escape also stops. -->
  <div
    role="search"
    class="flex-none flex flex-col gap-1 px-2 py-1 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700"
    data-find-bar
    @keydown.esc.stop.prevent="$emit('close')"
  >
    <div class="flex items-center gap-1">
      <Button
        v-if="replaceable"
        type="button"
        :icon="replacing ? 'pi pi-chevron-down' : 'pi pi-chevron-right'"
        severity="secondary"
        text
        rounded
        size="small"
        class="flex-none !w-7 !h-7 !p-0"
        :aria-label="replacing ? 'Hide replace' : 'Show replace'"
        :aria-expanded="replacing"
        data-action="toggle-replace"
        @click="replacing = !replacing"
      />
      <InputText
        ref="queryField"
        :model-value="query"
        :size="fieldSize"
        class="flex-1 min-w-0"
        placeholder="Find"
        aria-label="Find"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        data-find-query
        @update:model-value="$emit('update:query', $event ?? '')"
        @keydown.enter.prevent="$emit($event.shiftKey ? 'previous' : 'next')"
      />
      <template v-if="refinable">
        <button
          v-tooltip.bottom="'Match case'"
          type="button"
          :class="toggleClass(matchCase)"
          aria-label="Match case"
          :aria-pressed="matchCase"
          data-action="match-case"
          @click="$emit('update:matchCase', !matchCase)"
        >
          Aa
        </button>
        <button
          v-tooltip.bottom="'Whole words'"
          type="button"
          :class="toggleClass(wholeWord)"
          aria-label="Whole words"
          :aria-pressed="wholeWord"
          data-action="whole-word"
          @click="$emit('update:wholeWord', !wholeWord)"
        >
          <span class="border-x border-b border-current px-px pb-px leading-none">ab</span>
        </button>
      </template>
      <span
        class="flex-none min-w-16 text-center text-xs tabular-nums text-surface-500 dark:text-surface-400"
        aria-live="polite"
        data-find-status
        >{{ status }}</span
      >
      <Button
        type="button"
        icon="pi pi-chevron-up"
        severity="secondary"
        text
        rounded
        size="small"
        class="flex-none !w-7 !h-7 !p-0"
        aria-label="Previous match"
        :disabled="count === 0"
        data-action="previous"
        @click="$emit('previous')"
      />
      <Button
        type="button"
        icon="pi pi-chevron-down"
        severity="secondary"
        text
        rounded
        size="small"
        class="flex-none !w-7 !h-7 !p-0"
        aria-label="Next match"
        :disabled="count === 0"
        data-action="next"
        @click="$emit('next')"
      />
      <Button
        type="button"
        icon="pi pi-times"
        severity="secondary"
        text
        rounded
        size="small"
        class="flex-none !w-7 !h-7 !p-0"
        aria-label="Close find"
        data-action="close"
        @click="$emit('close')"
      />
    </div>
    <div v-if="replaceable && replacing" class="flex items-center gap-1 pl-8">
      <InputText
        ref="replacementField"
        :model-value="replacement"
        :size="fieldSize"
        class="flex-1 min-w-0"
        placeholder="Replace"
        aria-label="Replace with"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        data-find-replacement
        @update:model-value="$emit('update:replacement', $event ?? '')"
        @keydown.enter.prevent="$emit('replace')"
      />
      <Button
        type="button"
        label="Replace"
        severity="secondary"
        text
        size="small"
        class="flex-none"
        :disabled="current < 0"
        data-action="replace"
        @click="afterward('replace')"
      />
      <Button
        type="button"
        label="All"
        severity="secondary"
        text
        size="small"
        class="flex-none"
        aria-label="Replace all"
        :disabled="count === 0"
        data-action="replace-all"
        @click="afterward('replace-all')"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import { useScreenSize } from '@/composables/useScreenSize'

/**
 * The strip a panel finds in: what to look for, which match of how many, the
 * way between them, and for a panel that can replace, what to replace them
 * with. Presentational: the panel does the finding, and says what it found.
 *
 * Enter goes to the next match and Shift-Enter to the one before, as in the
 * browser's own find; Enter in the replacement replaces the match the writer
 * is on. Replace all says how many it replaced, until the writer moves on.
 *
 * @typedef {Object} Props
 * @property {string} query
 * @property {number} count - How many matches there are
 * @property {number} current - Which of them the writer is on, or -1 for none
 * @property {boolean} [refinable] - Whether the panel can match case and whole words
 * @property {boolean} [matchCase]
 * @property {boolean} [wholeWord]
 * @property {boolean} [replaceable] - Whether the panel can replace
 * @property {string} [replacement]
 */
const props = defineProps({
  query: { type: String, required: true },
  count: { type: Number, required: true },
  current: { type: Number, required: true },
  refinable: { type: Boolean, default: false },
  matchCase: { type: Boolean, default: false },
  wholeWord: { type: Boolean, default: false },
  replaceable: { type: Boolean, default: false },
  replacement: { type: String, default: '' },
})

const emit = defineEmits([
  'update:query',
  'update:matchCase',
  'update:wholeWord',
  'update:replacement',
  'next',
  'previous',
  'replace',
  'replace-all',
  'close',
])

const { isMobile } = useScreenSize()

// iOS zooms the page in on a field whose text is smaller than 16px, and does
// not zoom back out, so on a phone the fields keep the full size.
const fieldSize = computed(() => (isMobile.value ? undefined : 'small'))

const replacing = ref(false)

/**
 * @param {boolean} on
 * @returns {string[]}
 */
const toggleClass = on => [
  'flex-none w-7 h-7 rounded flex items-center justify-center text-xs font-semibold focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary-500',
  on
    ? 'bg-primary-500/15 text-primary-700 dark:text-primary-300'
    : 'text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700',
]

/**
 * How many the last Replace all replaced, until the search changes or the
 * writer is on a match again. Replace all leaves them on none.
 */
const replacedAll = ref(/** @type {number|null} */ (null))
watch(
  () => [props.query, props.matchCase, props.wholeWord],
  () => (replacedAll.value = null)
)
watch(
  () => props.current,
  current => {
    if (current >= 0) replacedAll.value = null
  }
)

const status = computed(() => {
  if (replacedAll.value !== null) return `Replaced ${replacedAll.value}`
  if (!props.query) return ''
  if (props.count === 0) return 'No results'
  return props.current < 0 ? `${props.count} found` : `${props.current + 1} of ${props.count}`
})

/** @type {import('vue').Ref<{ $el: HTMLInputElement }|null>} */
const queryField = ref(null)

/** Put the caret in the query with all of it selected, so typing starts a new one. */
const focus = () => {
  const field = queryField.value?.$el
  field?.focus()
  field?.select()
}

/** @type {import('vue').Ref<{ $el: HTMLInputElement }|null>} */
const replacementField = ref(null)

/**
 * Replace, and keep the keys in the bar: a button that has nothing left to do
 * is disabled, and takes the focus with it, so Escape would no longer close
 * the find.
 *
 * @param {'replace'|'replace-all'} what
 */
const afterward = what => {
  const count = props.count
  emit(what)
  if (what === 'replace-all') replacedAll.value = count
  nextTick(() => {
    const focused = document.activeElement
    if (!focused || focused === document.body || focused.matches(':disabled')) {
      replacementField.value?.$el?.focus()
    }
  })
}

defineExpose({ focus })
</script>
