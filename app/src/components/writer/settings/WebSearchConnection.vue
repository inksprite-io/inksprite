<template>
  <section class="flex flex-col gap-2" data-web-search>
    <h3 class="text-sm font-semibold text-surface-800 dark:text-surface-100">Web search</h3>
    <Select
      :model-value="setup.service || NONE"
      :options="options"
      option-label="label"
      option-value="value"
      option-disabled="disabled"
      class="w-full dark:!bg-surface-900"
      size="small"
      aria-label="Web search service"
      data-field="web-service"
      @update:model-value="choose($event === NONE ? null : $event)"
    >
      <template #option="{ option }">
        <span class="flex items-baseline gap-2">
          {{ option.label }}
          <span v-if="option.disabled" class="text-xs text-surface-500">Desktop app only</span>
        </span>
      </template>
    </Select>

    <template v-if="current">
      <label class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300">
        Key
        <InputText
          v-model="keyDraft"
          size="small"
          type="password"
          :placeholder="current.needsKey ? '' : 'Optional'"
          data-field="web-key"
          @blur="saveKey"
          @keydown.enter="saveKey"
        />
      </label>
      <p v-if="current.note" class="text-xs text-surface-500 dark:text-surface-400">
        {{ current.note }}
      </p>
      <p v-if="checking === current.id" class="text-xs text-surface-500" data-web-check>
        Checking…
      </p>
      <p
        v-else-if="check && 'error' in check"
        class="text-xs text-red-600 dark:text-red-400"
        data-web-check
      >
        {{ check.error }}
      </p>
      <p v-else-if="check" class="text-xs text-surface-500" data-web-check>Connected</p>

      <div class="flex flex-col gap-1">
        <span class="text-xs font-medium text-surface-700 dark:text-surface-200">
          Used in chats on
        </span>
        <div class="flex flex-wrap gap-x-4 gap-y-1">
          <label
            v-for="profile in profiles"
            :key="profile.id"
            class="flex items-center gap-2 text-xs"
          >
            <ToggleSwitch
              :model-value="(setup.profiles || []).includes(profile.id)"
              :aria-label="`Search the web in chats on ${profile.name}`"
              @update:model-value="setProfile(profile.id, $event)"
            />
            {{ profile.name }}
          </label>
        </div>
      </div>
    </template>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import InputText from 'primevue/inputtext'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { useWebSearch } from '@/composables/useWebSearch.js'
import { useProfiles } from '@/composables/useProfiles'
import { getWebService } from '@/web/services.js'

/**
 * Settings → Connections → Web search: the service the model searches the
 * web through, its key, and the profiles whose chats search. See
 * composables/useWebSearch.js.
 */

const { setup, services, reachable, checks, checking, choose, setKey, setProfile } = useWebSearch()
const { profiles } = useProfiles()

/**
 * The value None is chosen by: a value of its own, since a dropdown shows no
 * choice at all for null.
 */
const NONE = 'none'

/** None, then each service, a service the desktop app alone can reach shown and not choosable. */
const options = computed(() => [
  { label: 'None', value: NONE, disabled: false },
  ...services.map(service => ({
    label: service.name,
    value: service.id,
    disabled: !reachable(service),
  })),
])

/** The service in use, when one is. */
const current = computed(() => {
  const service = getWebService(setup.value.service)
  return service && reachable(service) ? service : null
})

/** What the last check of the service in use found. */
const check = computed(() => (current.value ? checks.value[current.value.id] : undefined))

/** The key as it is being typed, for the service in use. */
const keyDraft = ref('')

watch(
  () => current.value?.id,
  id => {
    keyDraft.value = (id && setup.value.keys?.[id]) || ''
  },
  { immediate: true }
)

function saveKey() {
  if (current.value) setKey(current.value.id, keyDraft.value)
}
</script>
