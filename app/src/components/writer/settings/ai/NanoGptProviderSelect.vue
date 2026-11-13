<template>
  <div class="flex flex-col gap-1">
    <MultiSelect
      :model-value="modelValue"
      :options="options"
      :loading="loading"
      option-label="name"
      option-value="slug"
      filter
      show-clear
      display="chip"
      :placeholder="placeholder"
      :aria-label="label || undefined"
      class="w-full"
      size="small"
      @update:model-value="emit('update:modelValue', $event || [])"
    >
      <template #option="{ option }">
        <div class="flex w-full items-center justify-between gap-3">
          <span>{{ option.name }}</span>
          <span class="text-xs text-surface-500 dark:text-surface-400">{{ option.price }}</span>
        </div>
      </template>
    </MultiSelect>
    <Message v-if="notOffered.length > 0" severity="warn" size="small" :closable="false">
      {{ notOfferedText }}
    </Message>
    <Message v-if="loadError" severity="warn" size="small" :closable="false">
      Couldn't load the provider list.
    </Message>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import MultiSelect from 'primevue/multiselect'
import Message from 'primevue/message'
import { useAIService } from '@/composables/useAIService'
import { formatPrice } from '@/utils/modelFacts.js'

/**
 * The providers NanoGPT serves a model from, picked by name and stored by
 * id, each with what it costs chosen, NanoGPT's fee included. While the
 * connection asks for zero data retention, only those that keep nothing:
 * NanoGPT would refuse a request held to any other.
 *
 * A chosen one it no longer offers stays chosen, and is said not to serve
 * the model, as OpenRouter's picker says it (OpenRouterProviderSelect.vue).
 *
 * @typedef {Object} Props
 * @property {string[]} modelValue - The chosen ids
 * @property {string} model - The model whose providers to offer
 * @property {boolean} [zdrOnly] - Offer only the providers that keep nothing
 * @property {string} [placeholder] - Shown when none are chosen
 * @property {string} [label] - What a screen reader calls the list
 */
const props = defineProps({
  modelValue: { type: Array, required: true },
  model: { type: String, required: true },
  zdrOnly: { type: Boolean, default: false },
  placeholder: { type: String, default: 'None' },
  label: { type: String, default: '' },
})

/** A cleared list is emitted as `[]`, never PrimeVue's `null`. */
const emit = defineEmits(['update:modelValue'])

const aiService = useAIService()

/** @type {import('vue').Ref<import('@/ai/models.js').NanoGptProvider[]>} */
const serving = ref([])
const loading = ref(false)
const loadError = ref(false)

watch(
  () => props.model,
  async model => {
    serving.value = []
    loadError.value = false
    loading.value = true
    try {
      const { providers } = await aiService.listNanoGptProviders(model)
      if (model === props.model) serving.value = providers
    } catch (error) {
      if (model !== props.model) return
      console.error(`Failed to load the providers serving ${model}:`, error)
      loadError.value = true
    } finally {
      if (model === props.model) loading.value = false
    }
  },
  { immediate: true }
)

/** The providers offered: those serving the model, and keeping nothing where that is asked. */
const offered = computed(() => serving.value.filter(provider => !props.zdrOnly || provider.zdr))

/**
 * What the list shows: the providers offered, with their prices, and any id
 * already chosen that they leave out, which the MultiSelect would otherwise
 * show unchosen and drop on the next edit.
 */
const options = computed(() => {
  const ids = new Set(offered.value.map(provider => provider.slug))
  const unlisted = /** @type {string[]} */ (props.modelValue)
    .filter(slug => !ids.has(slug))
    .map(slug => ({ slug, name: nameOf(slug), price: '' }))
  return [
    ...offered.value.map(provider => ({
      slug: provider.slug,
      name: provider.name,
      price: formatPrice(provider.pricing),
    })),
    ...unlisted,
  ]
})

/** @param {string} slug @returns {string} */
const nameOf = slug => serving.value.find(provider => provider.slug === slug)?.name || slug

/** Chosen ids NanoGPT doesn't offer for the model now; none until it has said. */
const notOffered = computed(() => {
  if (loading.value || loadError.value) return []
  const ids = new Set(offered.value.map(provider => provider.slug))
  return /** @type {string[]} */ (props.modelValue).filter(slug => !ids.has(slug))
})

const notOfferedText = computed(() => {
  const names = new Intl.ListFormat('en', { type: 'conjunction' }).format(
    notOffered.value.map(nameOf)
  )
  const verb = notOffered.value.length === 1 ? "doesn't" : "don't"
  return props.zdrOnly
    ? `${names} ${verb} serve this model with zero data retention.`
    : `${names} ${verb} serve this model.`
})
</script>
