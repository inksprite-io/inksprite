<template>
  <div class="flex flex-col gap-3">
    <div v-for="list in LISTS" :key="list.field" class="flex flex-col gap-1">
      <SettingLabel
        :label="list.label"
        :overridden="slugs[list.field].length > 0"
        :reset-tooltip="list.resetTooltip"
        @reset="emit('update', { [list.field]: undefined })"
      />
      <OpenRouterProviderSelect
        :model-value="slugs[list.field]"
        :model="model"
        :placeholder="list.placeholder"
        :label="list.label"
        @update:model-value="
          emit('update', { [list.field]: $event.length > 0 ? $event : undefined })
        "
      />
    </div>
  </div>
</template>

<script setup>
/**
 * The upstream providers OpenRouter may serve a model from, and the ones it
 * may not, beside the model: on a preset, and on a workflow that runs on a
 * model of its own.
 *
 * Not the connection's, because they are choices about the model: the one
 * upstream that serves it well, or the few that serve it at all, or the one
 * that serves it badly, are not the same for the next model on the same
 * account. The ignored ones here are left out as well as the connection's,
 * not instead of them. The rest of the routing policy holds for every model,
 * and stays with the connection (ProviderRouting.vue). Shown for OpenRouter
 * alone; nothing else routes.
 *
 * @typedef {Object} Props
 * @property {import('@/ai/routing.js').ModelUpstreams} [upstreams] - The lists; absent sets neither
 * @property {string} [model] - The model they are for, to offer the providers serving it
 */
import { computed } from 'vue'
import SettingLabel from '@/components/common/SettingLabel.vue'
import OpenRouterProviderSelect from './OpenRouterProviderSelect.vue'
import { toSlugList } from '@/ai/routing.js'

const props = defineProps({
  upstreams: {
    type: Object,
    default: undefined,
  },
  model: {
    type: String,
    default: '',
  },
})

/**
 * A patch of the one list that changed. An emptied list is emitted as
 * `undefined`, so a list with nothing in it stores nothing.
 */
const emit = defineEmits(['update'])

/** @type {Array<{field: 'allowedProviders'|'ignoredProviders', label: string, placeholder: string, resetTooltip: string}>} */
const LISTS = [
  {
    field: 'allowedProviders',
    label: 'Allowed providers',
    placeholder: 'Any provider',
    resetTooltip: 'Allow any provider',
  },
  {
    field: 'ignoredProviders',
    label: 'Ignored providers',
    placeholder: 'None',
    resetTooltip: 'Clear',
  },
]

const slugs = computed(() => ({
  allowedProviders: toSlugList(props.upstreams?.allowedProviders),
  ignoredProviders: toSlugList(props.upstreams?.ignoredProviders),
}))
</script>
