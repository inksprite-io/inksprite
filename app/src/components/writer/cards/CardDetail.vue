<template>
  <div class="h-full flex flex-col" :data-card-detail="card.id">
    <div
      class="flex items-center gap-2 px-3 py-2 border-b border-surface-200 dark:border-surface-700"
    >
      <HeaderButton
        icon="pi pi-arrow-left"
        label="Back"
        data-action="back"
        @click="$emit('back')"
      />
      <h2 class="flex-1 min-w-0 truncate font-semibold text-surface-800 dark:text-surface-100">
        {{ card.title }}
      </h2>
      <HeaderButton
        icon="pi pi-download"
        label="Download card"
        data-action="download-card"
        @click="$emit('download', card.id)"
      />
      <HeaderButton
        icon="pi pi-trash"
        label="Delete from library"
        data-action="delete-card"
        @click="$emit('remove', card.id)"
      />
      <!-- What the card is usually opened for, with the rest beside it. -->
      <SplitButton
        v-if="actions.length > 1"
        :label="actions[0].label"
        :model="rest"
        size="small"
        :disabled="busy"
        data-action="use-card"
        @click="actions[0].command()"
      />
      <Button
        v-else-if="actions.length === 1"
        :label="actions[0].label"
        size="small"
        :loading="busy"
        data-action="use-card"
        @click="actions[0].command()"
      />
    </div>

    <div class="flex-1 min-h-0 overflow-auto">
      <div class="flex flex-col sm:flex-row gap-6 p-4">
        <div class="sm:w-64 flex-none">
          <!-- A picture blurred for being NSFW shows when clicked, for as long
               as this card is open. -->
          <button
            v-if="imageUrl && blurred"
            type="button"
            class="relative block w-full max-w-64 mx-auto rounded-lg overflow-hidden ring-1 ring-surface-300 dark:ring-surface-600 cursor-pointer focus-visible:outline-2 focus-visible:outline-primary-500"
            aria-label="Show picture"
            data-action="show-picture"
            @click="revealed = true"
          >
            <img :src="imageUrl" alt="" class="w-full blur-2xl scale-110" data-blurred />
            <i
              class="pi pi-eye-slash absolute inset-0 m-auto h-fit w-fit text-3xl text-white/90 drop-shadow"
              aria-hidden="true"
            />
          </button>
          <img
            v-else-if="imageUrl"
            :src="imageUrl"
            alt=""
            class="w-full max-w-64 mx-auto rounded-lg ring-1 ring-surface-300 dark:ring-surface-600"
          />
          <div
            v-else
            class="w-full max-w-64 mx-auto aspect-[2/3] rounded-lg bg-surface-200 dark:bg-surface-700 flex items-center justify-center text-5xl font-semibold text-surface-400 dark:text-surface-500"
            aria-hidden="true"
          >
            {{ card.title.trim().charAt(0).toUpperCase() || '?' }}
          </div>
        </div>

        <div class="flex-1 min-w-0 flex flex-col gap-5">
          <div v-if="byline" class="text-sm text-surface-500 dark:text-surface-400">
            {{ byline }}
          </div>

          <!-- The projects it went into from the library, each a way back. -->
          <div
            v-if="places.length > 0"
            class="flex flex-wrap items-baseline gap-x-1.5 text-sm text-surface-500 dark:text-surface-400"
            data-card-places
          >
            <span>In</span>
            <template v-for="(place, at) in places" :key="place.storyId">
              <button
                type="button"
                class="text-primary-600 dark:text-primary-400 hover:underline cursor-pointer"
                :data-place="place.storyId"
                @click="$emit('open-project', place.storyId)"
              >
                {{ place.name }}</button
              ><span v-if="at < places.length - 1" aria-hidden="true">·</span>
            </template>
          </div>

          <div v-if="card.tags.length > 0" class="flex flex-wrap gap-1.5">
            <button
              v-for="tag in card.tags"
              :key="tag"
              type="button"
              class="px-2 py-0.5 rounded-full text-xs bg-surface-200 dark:bg-surface-700 text-surface-700 dark:text-surface-200 hover:bg-primary-100 dark:hover:bg-primary-900 cursor-pointer"
              :data-tag="tag"
              @click="$emit('tag', tag)"
            >
              {{ tagLabel(tag) }}
            </button>
          </div>

          <section v-for="section in sections" :key="section.heading" class="flex flex-col gap-1">
            <h3 :class="HEADING">{{ section.heading }}</h3>
            <p :class="TEXT">{{ section.text }}</p>
          </section>

          <section v-if="lore.length > 0" class="flex flex-col gap-1">
            <h3 :class="HEADING">
              Lorebook · {{ lore.length === 1 ? '1 entry' : `${lore.length} entries` }}
            </h3>
            <ul class="flex flex-col gap-0.5">
              <li v-for="(entry, at) in lore" :key="at" class="text-sm min-w-0 truncate">
                <span class="text-surface-700 dark:text-surface-200">{{ entry.title }}</span>
                <span v-if="entry.keys.length > 0" class="text-surface-400 dark:text-surface-500">
                  · {{ entry.keys.join(', ') }}</span
                >
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import Button from 'primevue/button'
import SplitButton from 'primevue/splitbutton'
import HeaderButton from '../layout/HeaderButton.vue'
import { readCard } from '@/cards/card.js'
import { isNsfw, plainText, tagLabel } from '@/cards/library.js'
import { useApplicationState } from '@/composables/useApplicationState'
import { useCardLibraryStore } from '@/stores/cardLibraryStore.js'

/**
 * One card from the library, in full: its picture, who made it, its tags, and
 * everything it says, as the card has it, and the projects it is in. Read-only.
 * From here it goes into a project, new or open, or opens one it is in; out
 * as a file; or out of the library. A picture blurred for
 * being NSFW shows when clicked, until another card is opened.
 *
 * @typedef {Object} Props
 * @property {import('@/types/models.js').LibraryCard} card
 * @property {Array<{id: string, label: string, icon: string, command: () => void}>} [actions] -
 *   What can be done with it, the one it is usually opened for first
 * @property {Array<{storyId: string, name: string}>} [places] - The projects it is in
 * @property {boolean} [busy] - It is being written into a project
 */
const props = defineProps({
  card: { type: Object, required: true },
  actions: { type: Array, default: () => [] },
  places: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
})

defineEmits(['back', 'open-project', 'download', 'remove', 'tag'])

/** The actions after the first, for the split button's menu. */
const rest = computed(() =>
  props.actions.slice(1).map(({ label, icon, command }) => ({ label, icon, command }))
)

const HEADING = 'text-xs font-medium uppercase tracking-wide text-surface-500 dark:text-surface-400'
const TEXT = 'text-sm whitespace-pre-wrap break-words text-surface-700 dark:text-surface-200'

const library = useCardLibraryStore()

/** @type {import('vue').Ref<import('@/cards/card.js').Card|null>} */
const read = ref(null)
const notes = ref('')
const imageUrl = ref('')

const { blurNsfw } = useApplicationState()

/** Shown for this card, though it is one whose picture is blurred. */
const revealed = ref(false)

const blurred = computed(() => blurNsfw.value && isNsfw(props.card) && !revealed.value)

const byline = computed(() => {
  const bits = []
  // The character's own name, when the card is known by something else.
  if (props.card.name && props.card.name !== props.card.title) bits.push(props.card.name)
  if (props.card.creator) bits.push(`by ${props.card.creator}`)
  return bits.join(' · ')
})

/** What the card says, in the order somebody reading it would want. */
const sections = computed(() => {
  const card = read.value
  if (!card) return []
  const greetings = card.greetings.map((text, at) => ({
    heading: at === 0 ? 'First message' : `Greeting ${at + 1}`,
    text,
  }))
  return [
    { heading: "Creator's notes", text: notes.value },
    { heading: 'Description', text: card.description },
    { heading: 'Personality', text: card.personality },
    { heading: 'Scenario', text: card.scenario },
    ...greetings,
    { heading: 'Example dialogue', text: card.examples },
    { heading: 'System prompt', text: card.systemPrompt },
    { heading: 'Post-history instructions', text: card.rules },
  ].filter(section => section.text)
})

const lore = computed(() => read.value?.lore || [])

const release = () => {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = ''
}

let unmounted = false

watch(
  () => props.card.id,
  async id => {
    release()
    read.value = null
    notes.value = ''
    revealed.value = false
    const file = await library.cardFile(id)
    if (!file || unmounted || id !== props.card.id) return
    const value = file.card
    const data = value?.data && typeof value.data === 'object' ? value.data : value || {}
    read.value = readCard(value)
    notes.value = plainText(typeof data.creator_notes === 'string' ? data.creator_notes : '')
    if (file.image) imageUrl.value = URL.createObjectURL(file.image)
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  unmounted = true
  release()
})
</script>
