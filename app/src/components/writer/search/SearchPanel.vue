<template>
  <div class="w-full h-full flex flex-col">
    <PanelHeader title="Search" />

    <!-- Keys stay here: Enter goes to the next match, Shift-Enter to the one
         before, as in a document's find. -->
    <div
      role="search"
      class="flex-none flex items-center gap-1 px-2 py-1.5 border-b border-surface-200 dark:border-surface-700"
    >
      <InputText
        ref="field"
        v-model="query"
        :size="fieldSize"
        class="flex-1 min-w-0"
        placeholder="Search"
        aria-label="Search the project"
        autocomplete="off"
        autocapitalize="off"
        spellcheck="false"
        data-search-query
        @keydown.enter.prevent="step($event.shiftKey ? -1 : 1)"
      />
      <button
        v-tooltip.bottom="'Match case'"
        type="button"
        :class="toggleClass(matchCase)"
        aria-label="Match case"
        :aria-pressed="matchCase"
        data-action="match-case"
        @click="matchCase = !matchCase"
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
        @click="wholeWord = !wholeWord"
      >
        <span class="border-x border-b border-current px-px pb-px leading-none">ab</span>
      </button>
    </div>

    <p
      v-if="status"
      class="flex-none px-3 py-1.5 text-xs text-surface-500 dark:text-surface-400"
      aria-live="polite"
      data-search-status
    >
      {{ status }}
    </p>

    <ScrollPanel class="flex-1 min-h-0 overflow-auto">
      <div class="flex flex-col pb-16">
        <section
          v-for="group in groups"
          :key="group.id"
          class="flex flex-col"
          :data-search-document="group.id"
        >
          <div class="flex items-center gap-0.5 px-1 pt-1">
            <button
              type="button"
              class="flex-none w-6 h-6 rounded flex items-center justify-center text-surface-500 dark:text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700 disabled:invisible"
              :aria-label="collapsed.has(group.id) ? 'Show matches' : 'Hide matches'"
              :aria-expanded="!collapsed.has(group.id)"
              :disabled="group.lines.length === 0"
              data-action="collapse"
              @click="toggle(group.id)"
            >
              <i
                :class="collapsed.has(group.id) ? 'pi pi-chevron-right' : 'pi pi-chevron-down'"
                style="font-size: 0.625rem"
              ></i>
            </button>
            <!-- The document, opened at its first match. -->
            <button
              type="button"
              class="flex-1 min-w-0 flex items-baseline gap-1.5 px-1 py-0.5 rounded text-left hover:bg-surface-200 dark:hover:bg-surface-700 cursor-pointer"
              :title="group.path"
              :data-open="group.id === documentId || undefined"
              data-action="open-document"
              @click="open(group.id, group.lines[0] ?? null)"
            >
              <span
                class="flex-none max-w-full truncate text-sm font-semibold"
                :class="
                  group.id === documentId
                    ? 'text-primary-600 dark:text-primary-400'
                    : 'text-surface-700 dark:text-surface-200'
                "
              >
                <template v-if="group.inTitle">
                  <template v-for="(part, at) in titleParts(group.title)" :key="at">
                    <mark v-if="part.match" class="find-match rounded-sm">{{ part.text }}</mark>
                    <template v-else>{{ part.text }}</template>
                  </template>
                </template>
                <template v-else>{{ group.title }}</template>
              </span>
              <span class="flex-1 min-w-0 truncate text-xs text-surface-500 dark:text-surface-400">
                {{ group.folder }}
              </span>
            </button>
            <span
              v-if="group.count > 0"
              class="flex-none px-1.5 rounded-full bg-surface-200 dark:bg-surface-700 text-[10px] leading-4 tabular-nums text-surface-600 dark:text-surface-300"
              data-search-count
            >
              {{ group.count }}
            </span>
          </div>

          <template v-if="!collapsed.has(group.id)">
            <button
              v-for="line in group.lines"
              :key="line.index"
              type="button"
              class="w-full pl-8 pr-2 py-0.5 text-left text-xs truncate text-surface-600 dark:text-surface-300 hover:bg-surface-200 dark:hover:bg-surface-700 cursor-pointer"
              :class="{
                'bg-primary-500/10': isChosen(group.id, line.index),
              }"
              :data-search-line="line.index"
              @click="open(group.id, line)"
            >
              {{ line.before
              }}<mark class="find-match rounded-sm text-surface-900 dark:text-surface-0">{{
                line.match
              }}</mark
              >{{ line.after }}
            </button>
          </template>
        </section>
      </div>
    </ScrollPanel>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import InputText from 'primevue/inputtext'
import ScrollPanel from 'primevue/scrollpanel'
import PanelHeader from '../layout/PanelHeader.vue'
import { useDocuments } from '@/composables/useDocuments'
import { focusRequests, takeSearchField, useProjectSearch } from '@/composables/useProjectSearch.js'
import { useScreenSize } from '@/composables/useScreenSize'
import { LINE_LIMIT } from '@/editor/projectSearch.js'
import { patternFor } from '@/editor/search.js'

/**
 * The search across the project (`useProjectSearch`): the field, matching
 * case and whole words as a document's find can, and what it finds, by
 * document in the outline's order, each match the line it is on. Picking a
 * match opens its document on it, with the document's find open on the
 * query; picking a document opens it on its first. Enter in the field goes
 * to the match after the one last picked, through every document.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} [documentId] - The document open in the editor, whose name is marked
 */
const props = defineProps({
  storyId: { type: String, required: true },
  documentId: { type: String, default: '' },
})

const emit = defineEmits(['open-document'])

const api = useDocuments(props.storyId)
const { query, matchCase, wholeWord, found, current, goTo } = useProjectSearch(props.storyId)
const { isMobile } = useScreenSize()

// iOS zooms the page in on a field whose text is smaller than 16px, and does
// not zoom back out, so on a phone the field keeps the full size.
const fieldSize = computed(() => (isMobile.value ? undefined : 'small'))

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

/** The documents found, each with its title and the folders it is in. */
const groups = computed(() =>
  found.value.documents.map(document => {
    const titles = api.titlesOf(document.id)
    return {
      ...document,
      title: api.displayTitle(api.get(document.id)),
      folder: titles.slice(0, -1).join(' / '),
      path: api.pathOf(document.id),
    }
  })
)

/** @param {number} count */
const plural = (count, one, many = `${one}s`) =>
  `${count.toLocaleString()} ${count === 1 ? one : many}`

/** How many matches in how many documents, or that there are none. */
const status = computed(() => {
  if (!query.value || !current.value) return ''
  const { count, documents, cut } = found.value
  if (documents.length === 0) return 'No results'
  const named = documents.filter(document => document.count === 0).length
  const said =
    count === 0
      ? plural(named, 'title')
      : `${plural(count, 'result')} in ${plural(documents.length - named, 'document')}`
  return cut ? `${said}. The first ${LINE_LIMIT.toLocaleString()} are listed.` : said
})

/**
 * A title cut into what the query matches and what it does not, to mark.
 *
 * @param {string} title
 * @returns {Array<{text: string, match: boolean}>}
 */
const titleParts = title => {
  const pattern = patternFor(query.value, {
    matchCase: matchCase.value,
    wholeWord: wholeWord.value,
  })
  /** @type {Array<{text: string, match: boolean}>} */
  const parts = []
  let from = 0
  for (const hit of title.matchAll(pattern)) {
    const at = hit.index ?? 0
    if (at > from) parts.push({ text: title.slice(from, at), match: false })
    if (hit[0]) parts.push({ text: hit[0], match: true })
    from = at + hit[0].length
  }
  if (from < title.length) parts.push({ text: title.slice(from), match: false })
  return parts
}

/** The documents whose matches are folded away. */
const collapsed = reactive(new Set())

/** @param {string} id */
const toggle = id => (collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id))

/** The match last picked, by document and place. @type {import('vue').Ref<{id: string, index: number}|null>} */
const chosen = ref(null)

/**
 * @param {string} id
 * @param {number} index
 */
const isChosen = (id, index) => chosen.value?.id === id && chosen.value.index === index

// Another search starts the list again.
watch([query, matchCase, wholeWord], () => (chosen.value = null))

/**
 * Open a document on one of its matches, or with none, as it is.
 *
 * @param {string} id
 * @param {{index: number, at?: number}|null} line
 */
const open = (id, line) => {
  chosen.value = line ? { id, index: line.index } : null
  if (line) goTo(id, line)
  emit('open-document', id)
}

/**
 * Go to the match after the one last picked, or before it, through every
 * document listed, going round at the ends.
 *
 * @param {1|-1} direction
 */
const step = direction => {
  const lines = groups.value.flatMap(group => group.lines.map(line => ({ id: group.id, line })))
  if (lines.length === 0) return
  const at = chosen.value
    ? lines.findIndex(({ id, line }) => isChosen(id, line.index))
    : direction === 1
      ? -1
      : 0
  const next = lines[(at + direction + lines.length) % lines.length]
  collapsed.delete(next.id)
  open(next.id, next.line)
  nextTick(() =>
    document
      .querySelector(`[data-search-document="${next.id}"] [data-search-line="${next.line.index}"]`)
      ?.scrollIntoView?.({ block: 'nearest' })
  )
}

/** @type {import('vue').Ref<{ $el: HTMLInputElement }|null>} */
const field = ref(null)

/** Put the caret in the field, with what is in it selected. */
const focusField = () => {
  const element = field.value?.$el
  element?.focus()
  element?.select()
}

// The rail and Mod-Shift-F ask for the field, from wherever the writer is.
const takeField = () => {
  if (takeSearchField()) nextTick(focusField)
}
watch(focusRequests, takeField)
onMounted(takeField)
</script>
