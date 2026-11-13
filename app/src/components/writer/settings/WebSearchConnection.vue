<template>
  <div class="flex flex-col gap-2" data-web-search>
    <CardList>
      <ConnectionCard
        v-for="service in services"
        :key="service.id"
        :name="service.name"
        :address="hostOf(service.address)"
        :status="statusOf(service)"
        :tone="reachable(service) ? 'bad' : 'neutral'"
        :open="open === service.id"
        :active="setup.service === service.id"
        :data-web-service="service.id"
        @toggle="toggle(service)"
      >
        <label class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300">
          Key
          <InputText
            v-model="keyDrafts[service.id]"
            size="small"
            type="password"
            :placeholder="service.needsKey ? '' : 'Optional'"
            data-field="web-key"
            @blur="setKey(service.id, keyDrafts[service.id] || '')"
            @keydown.enter="connectService(service)"
          />
        </label>
        <p v-if="service.note" class="text-xs text-surface-500 dark:text-surface-400">
          {{ service.note }}
        </p>
        <p
          v-if="checks[service.id] && 'error' in checks[service.id]"
          class="text-xs text-red-600 dark:text-red-400"
          data-web-check
        >
          {{ checks[service.id].error }}
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <Button
            label="Connect"
            size="small"
            :loading="checking === service.id"
            :disabled="service.needsKey && !(keyDrafts[service.id] || '').trim()"
            data-action="web-connect"
            @click="connectService(service)"
          />
          <Button
            v-if="setup.service !== service.id"
            label="Use for web search"
            size="small"
            severity="secondary"
            outlined
            :disabled="service.needsKey && !(keyDrafts[service.id] || '').trim()"
            data-action="web-use"
            @click="useService(service)"
          />
        </div>
      </ConnectionCard>
    </CardList>
  </div>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import CardList from '@/components/common/CardList.vue'
import ConnectionCard from '../connections/ConnectionCard.vue'
import { useWebSearch } from '@/composables/useWebSearch.js'
import { hostOf } from '@/composables/useConnections.js'

/**
 * Settings → Connections → Web search: a card for each service the model can
 * search the web through, with its key and whether it refused it. The one
 * used is tinted, and another is made the one from its card, as it is in
 * Settings › Extensions › Web search; which chats search is each chat's,
 * among its tools. See composables/useWebSearch.js.
 */

const { setup, services, reachable, checks, checking, choose, setKey, connect } = useWebSearch()

/** @typedef {import('@/web/services.js').WebService} WebService */

/** The service whose settings are open, if one's are. */
const open = ref(/** @type {string|null} */ (null))

/** Each service's key as it is being typed. */
const keyDrafts = reactive(/** @type {Record<string, string>} */ ({}))

watch(
  () => setup.value.keys,
  keys => {
    for (const service of services) keyDrafts[service.id] = keys?.[service.id] || ''
  },
  { immediate: true }
)

/** @param {WebService} service */
const toggle = service => {
  if (!reachable(service)) return
  open.value = open.value === service.id ? null : service.id
}

/**
 * What its card says beside it: that it can't be used here, or that it
 * refused the key when last checked. Nothing of one that answered.
 * @param {WebService} service
 */
const statusOf = service => {
  if (!reachable(service)) return 'Desktop app only'
  const check = checks.value[service.id]
  return checking.value !== service.id && check && 'error' in check ? 'Not connected' : ''
}

/**
 * Keep a service's key and check it; with none in use yet, the one that
 * answers becomes the one in use.
 * @param {WebService} service
 */
const connectService = async service => {
  await connect(service.id, keyDrafts[service.id] || '')
  const check = checks.value[service.id]
  if (check && !('error' in check) && !setup.value.service) {
    await choose(service.id, { checked: true })
  }
}

/**
 * Search with this service from now on, with the key typed in.
 * @param {WebService} service
 */
const useService = async service => {
  setKey(service.id, keyDrafts[service.id] || '')
  await choose(service.id)
}
</script>
