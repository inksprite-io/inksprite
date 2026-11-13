<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-col gap-1">
      <SettingLabel
        label="Preferred providers"
        :overridden="changed('allowedProviders')"
        @reset="emit('update', { allowedProviders: undefined, fallbacks: undefined })"
      />
      <NanoGptProviderSelect
        v-if="service === 'nanogpt'"
        :model-value="preferred"
        :model="model"
        :zdr-only="zdrOnly"
        label="Preferred providers"
        @update:model-value="setPreferred"
      />
      <OpenRouterProviderSelect
        v-else
        :model-value="preferred"
        :model="model"
        placeholder="None"
        label="Preferred providers"
        @update:model-value="setPreferred"
      />
    </div>
    <div v-if="preferred.length > 0" class="flex items-center justify-between gap-2">
      <SettingLabel
        label="Fall back to others"
        :overridden="changed('fallbacks')"
        @reset="emit('update', { fallbacks: undefined })"
      />
      <ToggleSwitch
        :model-value="upstreams?.fallbacks === true"
        class="flex-none"
        aria-label="Fall back to others"
        data-field="fallbacks"
        @update:model-value="emit('update', { fallbacks: $event })"
      />
    </div>
    <div class="flex flex-col gap-1">
      <SettingLabel
        label="Ignored providers"
        :overridden="changed('ignoredProviders')"
        @reset="emit('update', { ignoredProviders: undefined })"
      />
      <NanoGptProviderSelect
        v-if="service === 'nanogpt'"
        :model-value="ignored"
        :model="model"
        :zdr-only="zdrOnly"
        label="Ignored providers"
        @update:model-value="emit('update', { ignoredProviders: $event ?? [] })"
      />
      <OpenRouterProviderSelect
        v-else
        :model-value="ignored"
        :model="model"
        placeholder="None"
        label="Ignored providers"
        @update:model-value="emit('update', { ignoredProviders: $event ?? [] })"
      />
    </div>
  </div>
</template>

<script setup>
/**
 * The upstream providers OpenRouter or NanoGPT serves a model from first,
 * whether it may fall back to others that pass the connection's floor, and
 * the ones it may never: the model's own, beside its other settings.
 *
 * Not the connection's, because they are choices about the model: the
 * upstream that serves it well, or the one that serves it badly, are not the
 * same for the next model on the same account. The ignored ones here are left
 * out as well as the connection's, not instead of them. The rest of the
 * routing policy holds for every model, and stays with the connection
 * (ProviderRouting.vue, or NanoGPT's zero data retention). Shown for those
 * two alone, and on NanoGPT for a model it lets them be chosen for; nothing
 * else routes.
 *
 * A recommended model starts with routing of its own (ai/recommended.js);
 * resetting a list goes back to that, and emptying one keeps it empty.
 *
 * @typedef {Object} Props
 * @property {import('@/ai/routing.js').ModelUpstreams} [upstreams] - What the model routes on now
 * @property {Partial<import('@/types/models.js').AIPreset>|null} [stored] - The writer's changes, where there are any
 * @property {string} [model] - The model they are for, to offer the providers serving it
 * @property {'openrouter'|'nanogpt'} [service] - Whose providers they are
 * @property {boolean} [zdrOnly] - NanoGPT: offer only the providers that keep nothing
 */
import { computed } from 'vue'
import ToggleSwitch from 'primevue/toggleswitch'
import SettingLabel from '@/components/common/SettingLabel.vue'
import OpenRouterProviderSelect from './OpenRouterProviderSelect.vue'
import NanoGptProviderSelect from './NanoGptProviderSelect.vue'
import { toSlugList } from '@/ai/routing.js'

const props = defineProps({
  upstreams: {
    type: Object,
    default: undefined,
  },
  stored: {
    type: Object,
    default: null,
  },
  model: {
    type: String,
    default: '',
  },
  service: {
    type: String,
    default: 'openrouter',
  },
  zdrOnly: {
    type: Boolean,
    default: false,
  },
})

/** A patch of what changed; `undefined` goes back to what the model starts with. */
const emit = defineEmits(['update'])

const preferred = computed(() => toSlugList(props.upstreams?.allowedProviders))
const ignored = computed(() => toSlugList(props.upstreams?.ignoredProviders))

/** @param {'allowedProviders'|'ignoredProviders'|'fallbacks'} field */
const changed = field => props.stored?.[field] !== undefined

/**
 * Keep the preferred providers. The first ones chosen may be fallen back
 * from, unless the writer says otherwise.
 * @param {string[]|null} picked - Null when the list is emptied
 */
function setPreferred(picked) {
  const slugs = picked ?? []
  const first = preferred.value.length === 0 && slugs.length > 0
  emit('update', {
    allowedProviders: slugs,
    ...(first && props.upstreams?.fallbacks === undefined ? { fallbacks: true } : {}),
  })
}
</script>
