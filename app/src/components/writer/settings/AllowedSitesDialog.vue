<template>
  <Dialog
    :visible="visible"
    modal
    header="Allowed sites"
    :style="{ width: '24rem', maxWidth: '95vw' }"
    @update:visible="emit('update:visible', $event)"
    @show="draft = ''"
  >
    <InputText
      v-model="draft"
      class="w-full mb-2"
      size="small"
      placeholder="Add a site"
      aria-label="Add a site"
      data-add-site
      @keydown.enter.prevent="add"
    />
    <ul class="h-72 overflow-y-auto" aria-label="Allowed sites" data-allowed-sites>
      <li
        v-for="site in sorted"
        :key="site"
        class="flex items-center justify-between gap-2 rounded px-2 py-1 text-sm text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800"
        data-allowed-site
      >
        <span class="min-w-0 truncate">{{ site }}</span>
        <button
          type="button"
          class="flex-none w-6 h-6 rounded-full flex items-center justify-center text-xs text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700"
          :aria-label="`Remove ${site}`"
          @click="web.disallowSite(site)"
        >
          <i class="pi pi-times" />
        </button>
      </li>
      <li v-if="sorted.length === 0" class="px-2 py-1 text-sm text-surface-500" data-no-sites>
        No sites yet.
      </li>
    </ul>
  </Dialog>
</template>

<script setup>
import { computed, ref } from 'vue'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import { useWebSearch } from '@/composables/useWebSearch.js'
import { compareNames } from '@/utils/compareNames.js'
import { siteOf } from '@/web/addresses.js'

/**
 * The sites whose pages the model reads without asking: each added from the
 * question in a chat (Always allow), or typed here, and taken out here. As
 * the spelling dictionary is kept, in a dialog of its own, since the list
 * grows.
 */

defineProps({
  visible: { type: Boolean, default: false },
})

const emit = defineEmits(['update:visible'])

const web = useWebSearch()

const sorted = computed(() => [...(web.setup.value.allowedSites || [])].sort(compareNames))

const draft = ref('')

/** Add each site typed, by its name or by any address on it. */
const add = () => {
  for (const typed of draft.value.split(/[\s,]+/).filter(Boolean)) {
    const site = siteOf(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`)
    if (site) web.allowSite(site)
  }
  draft.value = ''
}
</script>
