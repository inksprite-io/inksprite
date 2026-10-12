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
      <button
        v-for="section in sections"
        :key="section.id"
        type="button"
        class="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-left whitespace-nowrap transition-colors duration-150 text-surface-700 dark:text-surface-200"
        :class="
          section.id === active.id
            ? 'bg-surface-200 dark:bg-surface-700 font-semibold'
            : 'hover:bg-surface-200/60 dark:hover:bg-surface-700/60'
        "
        :aria-current="section.id === active.id ? 'page' : undefined"
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
    </nav>

    <ScrollPanel class="flex-1 min-w-0 min-h-0">
      <div class="p-4 pb-16 max-w-2xl">
        <h2 class="text-base font-semibold text-surface-800 dark:text-surface-100 mb-3">
          {{ active.title ?? active.label }}
        </h2>
        <component :is="active.component" v-bind="active.props" />
      </div>
    </ScrollPanel>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import ScrollPanel from 'primevue/scrollpanel'

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
 */

const props = defineProps({
  /** @type {import('vue').PropType<Section[]>} */
  sections: { type: Array, required: true },
  /** The open section's id. */
  modelValue: { type: String, default: '' },
  /** What the list is called, for a screen reader. */
  label: { type: String, required: true },
})

defineEmits(['update:modelValue'])

const active = computed(
  () => props.sections.find(section => section.id === props.modelValue) ?? props.sections[0]
)

/** @type {import('vue').Ref<HTMLElement|null>} */
const strip = ref(null)

/**
 * Bring the open section's button into the strip's view. Across the top of a
 * phone, the one opened on may be past the edge, and nothing would say which
 * section this is.
 */
const showActive = () => {
  strip.value
    ?.querySelector('[aria-current="page"]')
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
