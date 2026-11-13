<template>
  <div class="flex flex-col md:flex-row h-full min-h-0 bg-surface-0 dark:bg-surface-800">
    <!-- The sections, down the side where there is room and across the top
         where there is not. Across the top it is swiped, as a phone's strips
         are, and draws no scrollbar. -->
    <nav
      ref="strip"
      class="flex md:flex-col md:w-48 shrink-0 gap-1 p-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b md:border-b-0 md:border-r border-surface-200 dark:border-surface-700 bg-surface-100 dark:bg-surface-900/40"
      :aria-label="label"
    >
      <!-- What stands over the sections, where there is something: a chat's
           profile, in its settings. -->
      <slot name="nav-start" />
      <template v-for="section in sections" :key="section.id">
        <button
          type="button"
          class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left whitespace-nowrap transition-colors duration-150 text-surface-700 dark:text-surface-200"
          :class="[
            section.id === active.id
              ? 'bg-surface-200 dark:bg-surface-700 font-semibold'
              : 'hover:bg-surface-200/60 dark:hover:bg-surface-700/60',
            // Down the side, the part under it is the one marked.
            section.id === active.id && activePart ? 'md:bg-transparent' : '',
          ]"
          :aria-current="section.id === active.id ? (activePart ? 'true' : 'page') : undefined"
          :aria-expanded="section.parts?.length ? section.id === active.id : undefined"
          :data-section="section.id"
          @click="$emit('update:modelValue', section.id)"
        >
          <component
            :is="section.icon"
            :size="18"
            class="shrink-0 text-surface-600 dark:text-surface-300"
          />
          <span>{{ section.label }}</span>
        </button>
        <!-- The open section's parts under it, one shown at a time, where
             the list is down the side. -->
        <div
          v-if="section.id === active.id && activePart"
          class="hidden md:flex flex-col gap-1"
          data-section-parts
        >
          <button
            v-for="one in section.parts"
            :key="one.id"
            type="button"
            class="pl-[2.375rem] pr-3 py-1.5 rounded-lg text-sm text-left whitespace-nowrap transition-colors duration-150 text-surface-700 dark:text-surface-200"
            :class="
              one.id === activePart.id
                ? 'bg-surface-200 dark:bg-surface-700 font-semibold'
                : 'hover:bg-surface-200/60 dark:hover:bg-surface-700/60'
            "
            :aria-current="one.id === activePart.id ? 'page' : undefined"
            :data-part="one.id"
            @click="$emit('update:part', one.id)"
          >
            {{ one.label }}
          </button>
        </div>
      </template>
    </nav>

    <!-- The open section's parts in a strip of their own under the
         sections, where those are across the top. -->
    <div
      v-if="activePart"
      class="flex md:hidden shrink-0 gap-1 px-2 py-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden border-b border-surface-200 dark:border-surface-700"
      data-section-parts
    >
      <button
        v-for="one in active.parts"
        :key="one.id"
        type="button"
        class="px-3 py-1.5 rounded-lg text-sm text-left whitespace-nowrap transition-colors duration-150 text-surface-700 dark:text-surface-200"
        :class="
          one.id === activePart.id
            ? 'bg-surface-200 dark:bg-surface-700 font-semibold'
            : 'hover:bg-surface-200/60 dark:hover:bg-surface-700/60'
        "
        :aria-current="one.id === activePart.id ? 'page' : undefined"
        :data-part="one.id"
        @click="$emit('update:part', one.id)"
      >
        {{ one.label }}
      </button>
    </div>

    <ScrollPanel class="flex-1 min-w-0 min-h-0">
      <div class="p-4 pb-16 max-w-2xl">
        <div class="flex items-center justify-between gap-2 mb-3">
          <h2 class="text-base font-semibold text-surface-800 dark:text-surface-100">
            {{ activePart?.label ?? active.title ?? active.label }}
          </h2>
          <!-- What the open section makes, where it makes something: a new
               profile, in a chat's settings, or a skill, which the section
               puts here itself (`useSectionHeading`). -->
          <div :id="headingEnd" class="flex items-center gap-1 -my-1.5">
            <slot name="heading-end" :section="active" />
          </div>
        </div>
        <component :is="active.component" v-bind="active.props" :part="activePart?.id" />
      </div>
    </ScrollPanel>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, provide, ref, useId, watch } from 'vue'
import ScrollPanel from 'primevue/scrollpanel'
import { SECTION_HEADING } from './sectionHeading.js'

/**
 * One section at a time, picked from a list: the settings' layout, and the
 * welcome's. Sized to fill whatever holds it — a dialog on the desktop, a tab
 * on a phone.
 *
 * @typedef {Object} Section
 * @property {string} id
 * @property {string} label - What the list calls it.
 * @property {string} [title] - The heading over it, when that is not the label.
 * @property {import('vue').Component} icon
 * @property {import('vue').Component} component
 * @property {Record<string, unknown>} [props] - Handed to the component.
 * @property {{id: string, label: string}[]} [parts] - What it is split into,
 *   listed under it while it is open and shown one at a time: the component
 *   is told which as its `part`, and the heading is the part's.
 */

const props = defineProps({
  /** @type {import('vue').PropType<Section[]>} */
  sections: { type: Array, required: true },
  /** The open section's id. */
  modelValue: { type: String, default: '' },
  /** The open section's part, of those it has; its first when not one of them. */
  part: { type: String, default: '' },
  /** What the list is called, for a screen reader. */
  label: { type: String, required: true },
})

defineEmits(['update:modelValue', 'update:part'])

/** Where the open section's own buttons go, beside its heading. */
const headingEnd = `section_heading_${useId()}`
provide(SECTION_HEADING, `#${headingEnd}`)

const active = computed(
  () => props.sections.find(section => section.id === props.modelValue) ?? props.sections[0]
)

/** The part of the open section shown, where it has parts. */
const activePart = computed(() => {
  const parts = active.value.parts
  if (!parts?.length) return null
  return parts.find(part => part.id === props.part) ?? parts[0]
})

/** @type {import('vue').Ref<HTMLElement|null>} */
const strip = ref(null)

/**
 * Bring the open section's button into the strip's view. Across the top of a
 * phone, the one opened on may be past the edge, and nothing would say which
 * section this is.
 */
const showActive = () => {
  strip.value
    ?.querySelector('[data-section][aria-current]')
    ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
}

onMounted(showActive)

watch(
  () => active.value.id,
  async () => {
    await nextTick()
    showActive()
  }
)
</script>
