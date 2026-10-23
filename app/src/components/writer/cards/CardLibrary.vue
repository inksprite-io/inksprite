<template>
  <div
    class="relative flex flex-col min-h-0"
    data-card-library
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <CardDetail
      v-if="selected"
      :card="selected"
      :actions="actionsFor(selected)"
      :places="placesOf(selected)"
      :busy="busy"
      @back="selectedId = null"
      @open-project="$emit('open-project', $event)"
      @download="download"
      @remove="confirmRemove"
      @tag="filterByTag"
    />

    <template v-else>
      <div class="flex items-center gap-2 px-3 pt-3">
        <!-- Typing a tag's start offers it as a filter, `tag:female`, which
             the arrows and Enter pick. -->
        <div class="relative flex-1 min-w-0">
          <IconField icon-position="left" class="w-full">
            <InputIcon class="pi pi-search text-surface-300 dark:text-surface-600" />
            <InputText
              v-model="query"
              type="text"
              class="rounded-full! w-full dark:!bg-surface-900"
              size="small"
              placeholder="Search cards…"
              aria-label="Search cards"
              role="combobox"
              aria-autocomplete="list"
              aria-haspopup="listbox"
              :aria-expanded="suggesting"
              :aria-controls="suggestionsId"
              :aria-activedescendant="suggesting ? `${suggestionsId}_${highlighted}` : undefined"
              data-card-search
              @input="suggestionsOpen = true"
              @keydown="onSearchKey"
              @blur="suggestionsOpen = false"
            />
          </IconField>
          <ul
            v-if="suggesting"
            :id="suggestionsId"
            role="listbox"
            aria-label="Tags"
            class="absolute z-10 left-0 right-0 mt-1 py-1 rounded-md bg-surface-0 dark:bg-surface-900 ring-1 ring-surface-300 dark:ring-surface-600 shadow-lg text-sm"
            data-tag-suggestions
          >
            <li
              v-for="(suggestion, at) in suggestions"
              :id="`${suggestionsId}_${at}`"
              :key="suggestion.tag"
              role="option"
              :aria-selected="at === highlighted"
              class="flex items-center justify-between gap-3 px-3 py-1 cursor-pointer"
              :class="{ 'bg-surface-100 dark:bg-surface-800': at === highlighted }"
              :data-suggestion="suggestion.tag"
              @mousedown.prevent="pickTag(suggestion.tag)"
              @mousemove="highlighted = at"
            >
              <span class="truncate text-surface-800 dark:text-surface-100"
                >tag:{{ tagLabel(suggestion.tag) }}</span
              >
              <span class="flex-none text-xs text-surface-400 dark:text-surface-500">{{
                suggestion.count
              }}</span>
            </li>
          </ul>
        </div>
        <Select
          v-model="order"
          :options="ORDERS"
          option-label="label"
          option-value="value"
          aria-label="Sort cards"
          size="small"
          class="w-36 sm:w-48 flex-none dark:!bg-surface-900"
          data-card-order
        />
        <!-- Whether cards tagged NSFW or NSFL show their pictures: the eye shut
             while they are blurred. Kept in the settings, for next time. -->
        <HeaderButton
          :icon="appState.blurNsfw.value ? 'pi pi-eye-slash' : 'pi pi-eye'"
          label="Blur NSFW pictures"
          :aria-pressed="appState.blurNsfw.value"
          data-action="blur-nsfw"
          @click="appState.setBlurNsfw(!appState.blurNsfw.value)"
        />
        <HeaderButton
          icon="pi pi-link"
          label="Add from a link"
          data-action="add-link"
          @click="linkDialogVisible = true"
        />
        <HeaderButton
          icon="pi pi-plus"
          label="Add cards"
          :loading="adding"
          data-action="add-cards"
          @click="choose"
        />
      </div>

      <!-- The tags chosen, then the library's most used, as filters: no more
           than two lines of them, and the rest found by typing. Every tag
           chosen must be on a card for it to show. The space under them is
           outside the grid's scroll, so pictures scrolled up stop short of
           them rather than running into them. -->
      <div v-if="tagChips.length > 0" class="px-3 pt-2 pb-3">
        <div class="flex flex-wrap gap-1.5 max-h-[2.875rem] overflow-hidden" data-card-tags>
          <button
            v-for="tag in tagChips"
            :key="tag"
            type="button"
            class="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs cursor-pointer"
            :class="
              isChosen(tag)
                ? 'bg-primary-500 text-white'
                : 'bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-200 hover:bg-primary-100 dark:hover:bg-primary-900'
            "
            :aria-pressed="isChosen(tag)"
            :data-tag="tag"
            @click="toggleTag(tag)"
          >
            {{ tagLabel(tag) }}
            <i v-if="isChosen(tag)" class="pi pi-times text-[0.6rem]" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        class="flex-1 min-h-0 overflow-auto px-3 pb-3"
        :class="tagChips.length > 0 ? 'pt-1' : 'pt-3'"
      >
        <div
          v-if="shown.length > 0"
          class="grid gap-x-3 gap-y-2 grid-cols-[repeat(auto-fill,minmax(8rem,1fr))]"
          data-card-grid
        >
          <CardTile
            v-for="card in shown"
            :key="card.id"
            :card="card"
            :menu-open="menuCardId === card.id"
            @open="selectedId = $event"
            @menu="showMenu"
          />
        </div>
        <div
          v-else-if="library.loaded"
          class="h-full flex flex-col items-center justify-center gap-1 text-center text-sm text-surface-500 dark:text-surface-400"
          data-card-empty
        >
          <template v-if="library.allCards.length === 0">
            <p>No character cards yet.</p>
            <p class="text-xs">Drop PNG or JSON cards here, or add them with +.</p>
          </template>
          <p v-else>No cards match.</p>
        </div>
      </div>
    </template>

    <!-- Where files being dragged in would go. -->
    <div
      v-if="dragging"
      class="pointer-events-none absolute inset-2 rounded border-2 border-dashed border-primary-500 bg-primary-500/10 flex items-center justify-center"
      data-drop-hint
    >
      <span
        class="px-3 py-1 rounded bg-surface-0 dark:bg-surface-900 text-sm text-surface-700 dark:text-surface-200 shadow"
      >
        Drop to add to the library
      </span>
    </div>

    <CardLinkDialog v-model:visible="linkDialogVisible" @added="report" />

    <!-- One menu for every tile: what is done with the card it was opened on. -->
    <ContextMenu ref="menu" :model="menuItems" data-card-menu @hide="menuCardId = null" />

    <input
      ref="fileInput"
      type="file"
      class="hidden"
      multiple
      accept=".png,.json,image/png,application/json"
      @change="readChosen"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, ref, useId, watch } from 'vue'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import ContextMenu from 'primevue/contextmenu'
import { useToast } from 'primevue/usetoast'
import { useConfirm } from 'primevue/useconfirm'
import CardTile from './CardTile.vue'
import CardDetail from './CardDetail.vue'
import CardLinkDialog from './CardLinkDialog.vue'
import HeaderButton from '../layout/HeaderButton.vue'
import {
  cardDownload,
  cardMatches,
  commonTags,
  describeSkipped,
  sortCards,
  suggestTags,
  tagKey,
  tagLabel,
} from '@/cards/library.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { useCardLibraryStore } from '@/stores/cardLibraryStore.js'
import { downloadBlob } from '@/files/download.js'

/**
 * The writer's character cards: a grid to browse, a search and the library's
 * tags to narrow it, and a card in full once clicked. Typing the start of a
 * tag in the search offers it as a filter. The order chosen is kept for next
 * time, and so is whether the pictures of NSFW cards are blurred, which a
 * button beside the search switches. Cards come in from the add button, from
 * a link (a botbooru or Chub page, or the card's own address), or by dropping
 * files or a link on it. A card's menu, on a right-click or a long press,
 * offers what can be done with it, downloads it, or deletes it; its detail
 * does the same. What can be done with a card, and the projects it is in,
 * are the window's to say.
 *
 * @typedef {Object} Props
 * @property {(card: import('@/types/models.js').LibraryCard) => Array<{id: string, label: string, icon: string, command: () => void}>} [actionsFor] -
 *   What can be done with a card, the one it is usually opened for first
 * @property {(card: import('@/types/models.js').LibraryCard) => Array<{storyId: string, name: string}>} [placesOf] -
 *   The projects a card is in
 * @property {boolean} [busy] - A card is being written into a project
 */
const props = defineProps({
  actionsFor: { type: Function, default: () => [] },
  placesOf: { type: Function, default: () => [] },
  busy: { type: Boolean, default: false },
})

defineEmits(['open-project'])

/** How many of the library's tags are offered as filters; the rest are typed. */
const TAG_CHIPS = 12

/** How many tags the search offers for a word being typed. */
const SUGGESTIONS = 6

/** Where the order chosen is kept, in this copy of the app's settings. */
const ORDER_KEY = 'ui.cardOrder'

/** @type {Array<{label: string, value: import('@/cards/library.js').CardOrder}>} */
const ORDERS = [
  { label: 'Recently added', value: 'added' },
  { label: 'Name', value: 'name' },
  { label: 'Recently used', value: 'used' },
]

const library = useCardLibraryStore()
const toast = useToast()
const confirm = useConfirm()
const appState = useApplicationState()

const query = ref('')

/**
 * The order the grid is in: as last chosen, here or on another opening.
 * @type {import('vue').WritableComputedRef<import('@/cards/library.js').CardOrder>}
 */
const order = computed({
  get: () => {
    const kept = appState.getState(ORDER_KEY)
    return ORDERS.some(option => option.value === kept) ? kept : 'added'
  },
  set: value => appState.setState(ORDER_KEY, value),
})
/** @type {import('vue').Ref<string[]>} */
const chosenTags = ref([])
/** @type {import('vue').Ref<string|null>} */
const selectedId = ref(null)
const adding = ref(false)
/** @type {import('vue').Ref<HTMLInputElement|null>} */
const fileInput = ref(null)

onMounted(() => library.ensureLoaded())

const selected = computed(() => (selectedId.value ? library.getCard(selectedId.value) : null))

const shown = computed(() =>
  sortCards(
    library.allCards.filter(card => cardMatches(card, query.value, chosenTags.value)),
    order.value
  )
)

/** The chosen tags first, then the library's most used. */
const tagChips = computed(() => {
  const chosen = new Set(chosenTags.value.map(tagKey))
  const common = commonTags(library.allCards, TAG_CHIPS).filter(tag => !chosen.has(tagKey(tag)))
  return [...chosenTags.value, ...common]
})

/** @param {string} tag */
const isChosen = tag => chosenTags.value.some(chosen => tagKey(chosen) === tagKey(tag))

/** @param {string} tag */
const toggleTag = tag => {
  chosenTags.value = isChosen(tag)
    ? chosenTags.value.filter(chosen => tagKey(chosen) !== tagKey(tag))
    : [...chosenTags.value, tag]
}

// The tags offered for the word being typed at the end of the search.
const suggestionsId = `card_tag_suggestions_${useId()}`
const suggestionsOpen = ref(false)
const highlighted = ref(0)

/** The last word of the search, without `tag:`, and whether it had it. */
const typing = computed(() => {
  const word = query.value.match(/(\S+)$/)?.[1] || ''
  const named = /^tag:/i.test(word)
  return { word: named ? word.slice(4) : word, named }
})

/** Offered once two letters are typed, or as soon as `tag:` is. */
const suggestions = computed(() => {
  const { word, named } = typing.value
  if (!named && word.length < 2) return []
  return suggestTags(library.allCards, word, chosenTags.value, SUGGESTIONS)
})

const suggesting = computed(() => suggestionsOpen.value && suggestions.value.length > 0)

watch(suggestions, () => (highlighted.value = 0))

/**
 * Take the word being typed out of the search, and choose its tag instead.
 * @param {string} tag
 */
const pickTag = tag => {
  query.value = query.value.replace(/\S+$/, '').trimEnd()
  if (!isChosen(tag)) chosenTags.value = [...chosenTags.value, tag]
  suggestionsOpen.value = false
}

/**
 * The arrows move through the tags offered, Enter or Tab picks one, and
 * Escape puts them away rather than closing the window.
 * @param {KeyboardEvent} event
 */
const onSearchKey = event => {
  if (!suggesting.value) return
  const count = suggestions.value.length
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    highlighted.value = (highlighted.value + step + count) % count
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    pickTag(suggestions.value[highlighted.value].tag)
  } else if (event.key === 'Escape') {
    event.stopPropagation()
    suggestionsOpen.value = false
  }
}

/**
 * A tag clicked on a card: back to the grid, showing the cards that have it.
 * @param {string} tag
 */
const filterByTag = tag => {
  if (!isChosen(tag)) chosenTags.value = [...chosenTags.value, tag]
  selectedId.value = null
}

const choose = () => {
  if (!fileInput.value) return
  // Cleared so that choosing the same file twice still fires a change.
  fileInput.value.value = ''
  fileInput.value.click()
}

/** @param {Event} event */
const readChosen = event => {
  const files = /** @type {HTMLInputElement} */ (event.target).files
  if (files && files.length > 0) add([...files])
}

const linkDialogVisible = ref(false)

/**
 * Show what adding came to. One card added, or one already here, is opened,
 * since it is the one the writer is about to look at; several are left to
 * the order the writer chose. Only files with no card in them are said.
 *
 * @param {import('@/stores/cardLibraryStore.js').Added} result
 */
const report = result => {
  const skipped = describeSkipped(result.skipped)
  if (skipped) toast.add({ severity: 'warn', detail: skipped, life: 5000 })
  const [one] = result.added.length > 0 ? result.added : result.duplicates
  if (result.added.length + result.duplicates.length === 1) selectedId.value = one.id
}

/**
 * Add cards, from files or a link, and say what came of it.
 *
 * @param {() => Promise<import('@/stores/cardLibraryStore.js').Added>} work
 */
const addWith = async work => {
  adding.value = true
  try {
    report(await work())
  } catch (error) {
    toast.add({ severity: 'error', detail: `Nothing added. ${error.message}`, life: 6000 })
  } finally {
    adding.value = false
  }
}

/** @param {File[]} files */
const add = files => addWith(() => library.addFiles(files))

/** @type {import('vue').Ref<{ show: (event: any) => void }|null>} */
const menu = ref(null)

/** The card the menu was opened on. */
/** @type {import('vue').Ref<string|null>} */
const menuCardId = ref(null)

/**
 * Open the menu on a card, where it was asked for.
 * @param {any} event - A right-click, or something placed like one
 * @param {string} id
 */
const showMenu = (event, id) => {
  menuCardId.value = id
  menu.value?.show(event)
}

/** What can be done with the card, then a file of it, or out of the library. */
const menuItems = computed(() => {
  const id = menuCardId.value
  const card = id ? library.getCard(id) : null
  if (!id || !card) return []
  const actions = props.actionsFor(card)
  return [
    ...actions.map(({ label, icon, command }) => ({ label, icon, command })),
    ...(actions.length > 0 ? [{ separator: true }] : []),
    { label: 'Download', icon: 'pi pi-download', command: () => download(id) },
    { separator: true },
    { label: 'Delete', icon: 'pi pi-trash', command: () => confirmRemove(id) },
  ]
})

/**
 * Hand the writer the card as a file: the PNG it came in, or its JSON.
 * @param {string} id
 */
const download = async id => {
  const card = library.getCard(id)
  const file = await library.cardFile(id)
  if (!card || !file) return
  const { blob, filename } = cardDownload(card, file)
  downloadBlob(blob, filename)
}

/** @param {string} id */
const confirmRemove = id => {
  const card = library.getCard(id)
  if (!card) return
  confirm.require({
    header: 'Delete card?',
    message: `Delete ${card.title} from the library?`,
    icon: 'pi pi-trash',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Delete', severity: 'danger' },
    accept: async () => {
      await library.removeCard(id)
      if (selectedId.value === id) selectedId.value = null
    },
  })
}

// Files dragged in from the desktop, or a link from another page. Entering
// and leaving children fire their own events, so the hint counts them rather
// than trusting the last.
const dragging = ref(false)
let depth = 0

/** @param {DragEvent} event */
const carriesFiles = event => {
  const types = event.dataTransfer?.types || []
  return types.includes('Files') || types.includes('text/uri-list')
}

/** @param {DragEvent} event */
const onDragEnter = event => {
  if (!carriesFiles(event)) return
  event.preventDefault()
  depth++
  dragging.value = true
}

/** @param {DragEvent} event */
const onDragOver = event => {
  if (!carriesFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

/** @param {DragEvent} event */
const onDragLeave = event => {
  if (!carriesFiles(event)) return
  depth = Math.max(0, depth - 1)
  if (depth === 0) dragging.value = false
}

/** @param {DragEvent} event */
const onDrop = event => {
  if (!carriesFiles(event)) return
  event.preventDefault()
  depth = 0
  dragging.value = false
  const files = [...(event.dataTransfer?.files || [])]
  if (files.length > 0) return add(files)
  // A link dragged from another page: the first of them, comments aside.
  const link = (event.dataTransfer?.getData('text/uri-list') || '')
    .split(/\r?\n/)
    .find(line => line.trim() && !line.startsWith('#'))
  if (link) addWith(() => library.addLink(link))
}
</script>
