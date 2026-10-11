<template>
  <div class="flex flex-col" :class="containerClass">
    <div
      class="flex items-center cursor-pointer rounded-lg transition-colors duration-150"
      :class="headerClasses"
      @click="toggleExpanded"
    >
      <i v-if="subsection" class="pi leading-none!" :class="chevronClasses" aria-hidden="true" />
      <component
        :is="icon"
        v-if="icon"
        :size="iconSize"
        :class="iconClass"
        class="text-surface-600 dark:text-surface-300"
        aria-hidden="true"
      />
      <!-- The whole row opens it to a pointer. The title is the button, for a
           keyboard to reach and a screen reader to name, and looks as the
           title always has. -->
      <h3 class="font-semibold leading-tight" :class="titleClasses">
        <button
          type="button"
          class="cursor-pointer text-left rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500"
          :aria-expanded="isExpanded"
          :aria-controls="contentId"
          @click.stop="toggleExpanded"
        >
          {{ title }}
        </button>
      </h3>
      <!-- Controls that act on the whole section, such as a switch for all of
           it. A click on them is theirs, and does not open or close it. -->
      <div v-if="$slots.actions" class="ml-auto flex items-center gap-2" @click.stop>
        <slot name="actions" />
      </div>
      <i
        v-if="!subsection"
        class="pi leading-none!"
        :class="[chevronClasses, { 'ml-auto': !$slots.actions }]"
        aria-hidden="true"
      />
    </div>
    <Transition
      enter-from-class="max-h-0"
      enter-active-class="transition-all duration-200 ease-out"
      enter-to-class="max-h-[2000px]"
      leave-from-class="max-h-[2000px]"
      leave-active-class="transition-all duration-200 ease-out"
      leave-to-class="max-h-0"
    >
      <div v-show="isExpanded" :id="contentId" class="overflow-hidden" :class="contentClasses">
        <slot />
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, useId } from 'vue'
import { sessionStorage } from '@/utils/sessionStorage'

/**
 * @typedef {Object} Props
 * @property {string} title - The title text for the expandable section
 * @property {string} [storageKey] - Optional unique key for session storage persistence
 * @property {boolean} [defaultExpanded=false] - Default expanded state if no stored value exists
 * @property {'1'|'2'|'3'} [level='3'] - The hierarchical level: 1 (largest), 2 (medium), 3 (smallest)
 * @property {string} [containerClass=''] - Additional classes for the container
 * @property {string} [contentWrapperClass=''] - Additional classes for the content wrapper
 * @property {string} [titleClasses=''] - Additional classes for the title
 * @property {Object} [icon] - Optional icon component to display before the title
 * @property {number} [iconSize=20] - Size of the icon in pixels
 * @property {string} [iconClass=''] - Additional classes for the icon
 * @property {boolean} [subsection=false] - A section nested in another: the
 *   chevron ahead of a small title, as a tree has it, so that its `actions`
 *   line up with the rows under it; and the content hung from it by a line
 *   down from the chevron, so what is inside it is plainly its own.
 *
 * Slots: the default slot is the content; `actions` sits in the header, ahead
 * of the chevron, for controls over the whole section.
 */
const props = defineProps({
  title: {
    type: String,
    required: true,
  },
  storageKey: {
    type: String,
    default: '',
  },
  defaultExpanded: {
    type: Boolean,
    default: false,
  },
  level: {
    type: String,
    default: '3',
    validator: value => ['1', '2', '3', '4'].includes(value),
  },
  containerClass: {
    type: String,
    default: '',
  },
  contentWrapperClass: {
    type: String,
    default: '',
  },
  titleClasses: {
    type: String,
    default: '',
  },
  icon: {
    type: Object,
    default: null,
  },
  iconSize: {
    type: Number,
    default: 20,
  },
  iconClass: {
    type: String,
    default: '',
  },
  subsection: {
    type: Boolean,
    default: false,
  },
})

// The line starts under the middle of the chevron, and the content keeps as
// far from the right as the header's actions do, so switches line up.
const contentClasses = computed(() => [
  props.contentWrapperClass,
  props.subsection && 'ml-3.5 pl-3 pr-2 border-l border-surface-300 dark:border-surface-600',
])

const expandedState = ref(props.defaultExpanded)

/** What the title's button opens and closes, for a screen reader to follow. */
const contentId = `expandable_${useId()}`

/**
 * Get the session storage key for this expandable section
 * @returns {string|null}
 */
const getStorageKey = () => {
  if (!props.storageKey) {
    return null
  }
  return `expandable-section-${props.storageKey}`
}

/**
 * Computed property for expanded state with session storage persistence
 */
const isExpanded = computed({
  get() {
    return expandedState.value
  },
  set(value) {
    expandedState.value = value
    const key = getStorageKey()
    if (!key) {
      return
    }

    sessionStorage.set(key, value)
  },
})

/**
 * Toggle the expanded state
 */
const toggleExpanded = () => {
  isExpanded.value = !isExpanded.value
}

onMounted(() => {
  const key = getStorageKey()
  if (!key) {
    return
  }

  const stored = sessionStorage.get(key)
  if (stored !== null) {
    expandedState.value = stored
  }
})

const headerClasses = computed(() => {
  const baseClasses = 'hover:bg-surface-300 hover:dark:bg-surface-700'

  switch (props.level) {
    case '1':
      return `${baseClasses} p-3 gap-4`
    case '2':
      return `${baseClasses} p-3 gap-4`
    // A set height rather than padding, so that a header with a switch in its
    // actions stands as tall as one without.
    case '3':
      return `${baseClasses} h-8 px-2 gap-2`
    case '4':
      return `${baseClasses} h-8 px-2 gap-2`
    default:
      return `${baseClasses} h-8 px-2 gap-2`
  }
})

const titleClasses = computed(() => {
  if (props.subsection)
    return `${props.titleClasses} text-sm text-surface-700 dark:text-surface-200`

  let sizeClasses = ''

  switch (props.level) {
    case '1':
      sizeClasses = 'text-lg text-surface-600 dark:text-surface-300'
      break
    case '2':
      sizeClasses = 'text-lg text-surface-600 dark:text-surface-300'
      break
    case '3':
      sizeClasses = 'text-md text-surface-500 dark:text-surface-400'
      break
    case '4':
      sizeClasses = 'text-md text-surface-500 dark:text-surface-400'
      break
    default:
      sizeClasses = 'text-sm text-surface-500 dark:text-surface-400'
  }

  return `${props.titleClasses} ${sizeClasses}`
})

const chevronClasses = computed(() => [
  'text-surface-600 dark:text-surface-300 transition-transform duration-200',
  iconClasses.value,
  isExpanded.value ? 'pi-angle-down' : 'pi-angle-right',
])

const iconClasses = computed(() => {
  switch (props.level) {
    case '1':
      return 'text-md'
    case '2':
      return 'text-sm'
    case '3':
      return 'text-xs'
    case '4':
      return 'text-xs'
    default:
      return 'text-xs'
  }
})
</script>
