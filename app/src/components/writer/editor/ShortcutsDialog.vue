<template>
  <Dialog
    :visible="visible"
    header="Keyboard shortcuts"
    modal
    dismissable-mask
    :draggable="false"
    class="w-screen md:w-[36rem]"
    @update:visible="$emit('update:visible', $event)"
  >
    <div class="grid gap-x-8 gap-y-5 sm:grid-cols-2">
      <section v-for="group in SHORTCUTS" :key="group.title" data-shortcut-group>
        <h3
          class="mb-1.5 text-xs font-semibold uppercase tracking-wide text-surface-500 dark:text-surface-400"
        >
          {{ group.title }}
        </h3>
        <dl class="flex flex-col gap-1 text-sm">
          <div
            v-for="shortcut in group.shortcuts"
            :key="shortcut.action"
            class="flex items-baseline justify-between gap-3"
          >
            <dt class="text-surface-700 dark:text-surface-200">{{ shortcut.action }}</dt>
            <dd class="flex-none">
              <kbd
                class="rounded border border-surface-200 dark:border-surface-700 bg-surface-50 dark:bg-surface-800 px-1.5 py-0.5 font-mono text-xs text-surface-700 dark:text-surface-200 whitespace-pre"
                >{{ shortcut.keys ? keyLabel(shortcut.keys) : shortcut.typed }}</kbd
              >
            </dd>
          </div>
        </dl>
      </section>
    </div>
  </Dialog>
</template>

<script setup>
import Dialog from 'primevue/dialog'
import { SHORTCUTS, keyLabel } from '@/editor/shortcuts.js'

/**
 * The editor's keys and typed shortcuts, listed. Opened with Mod-/ in the
 * editor, or from a tab's menu.
 *
 * @typedef {Object} Props
 * @property {boolean} visible
 */
defineProps({
  visible: { type: Boolean, default: false },
})

defineEmits(['update:visible'])
</script>
