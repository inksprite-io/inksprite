<template>
  <div class="flex flex-col gap-1">
    <SettingLabel
      label="Allowed providers"
      :overridden="allowed.length > 0"
      reset-tooltip="Allow any provider"
      @reset="emit('update:modelValue', undefined)"
    />
    <OpenRouterProviderSelect
      :model-value="allowed"
      :model="model"
      placeholder="Any provider"
      label="Allowed providers"
      @update:model-value="emit('update:modelValue', $event.length > 0 ? $event : undefined)"
    />
  </div>
</template>

<script setup>
/**
 * The upstream providers OpenRouter may serve a model from, beside the model:
 * on a preset, and on a workflow that runs on a model of its own.
 *
 * Not the connection's, because it is a choice about the model: the one
 * upstream that serves it well, or the few that serve it at all, are not the
 * same for the next model on the same account. The rest of the routing policy
 * holds for every model, and stays with the connection (ProviderRouting.vue).
 * Shown for OpenRouter alone; nothing else routes.
 *
 * @typedef {Object} Props
 * @property {string[]} [modelValue] - The allowed slugs; absent allows any
 * @property {string} [model] - The model they are for, to offer the providers serving it
 */
import { computed } from 'vue'
import SettingLabel from '@/components/common/SettingLabel.vue'
import OpenRouterProviderSelect from './OpenRouterProviderSelect.vue'
import { toSlugList } from '@/ai/routing.js'

const props = defineProps({
  modelValue: {
    type: Array,
    default: undefined,
  },
  model: {
    type: String,
    default: '',
  },
})

/** An emptied list is emitted as `undefined`, so allowing any stores nothing. */
const emit = defineEmits(['update:modelValue'])

const allowed = computed(() => toSlugList(props.modelValue))
</script>
