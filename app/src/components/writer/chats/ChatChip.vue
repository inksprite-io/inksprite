<template>
  <button
    type="button"
    class="flex-1 max-w-max min-w-0 inline-flex items-center gap-1 h-7 px-2.5 rounded-full text-xs border border-surface-200 dark:border-surface-700 bg-transparent cursor-pointer text-surface-600 dark:text-surface-300 hover:bg-surface-100 dark:hover:bg-surface-750 focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
    aria-haspopup="true"
  >
    <!-- One of the chips under the message box: what it is set to, and a menu
         or a popover of what else it can be on a click. In a row of them each
         has an even share, and never more than it needs, so a short one keeps
         its words and the longest are cut to the same width. Said in here,
         so the chip is one element and its $el the button. -->
    <slot />
    <i class="pi pi-chevron-down !text-[0.5rem] flex-none opacity-60" aria-hidden="true" />
  </button>
</template>
