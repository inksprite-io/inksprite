<template>
  <div class="flex flex-col gap-2" data-ai-connections>
    <Teleport defer :to="heading" :disabled="!heading">
      <HeaderButton
        icon="pi pi-plus"
        label="Add connection"
        data-action="add-connection"
        @click="startAdding"
      />
    </Teleport>
    <!-- A new one, made as its form fills in, then listed with the rest. -->
    <CardList v-if="adding">
      <CardItem title="New connection" open data-adding-connection @toggle="stopAdding">
        <ConnectionEditor @shown="addedId = $event" @removed="stopAdding" />
        <div class="flex gap-2">
          <Button label="Done" size="small" data-action="done" @click="stopAdding" />
        </div>
      </CardItem>
    </CardList>

    <CardList v-if="listed.length > 0">
      <ConnectionCard
        v-for="provider in listed"
        :key="provider.id"
        :name="provider.name"
        :address="addressOf(provider)"
        :status="statusOf(provider.id)"
        :open="open === provider.id"
        :data-connection="provider.id"
        @toggle="open = open === provider.id ? null : provider.id"
      >
        <ConnectionEditor :provider-id="provider.id" in-card @removed="open = null" />
      </ConnectionCard>
    </CardList>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import { useSectionHeading } from '@/components/common/sectionHeading.js'
import CardList from '@/components/common/CardList.vue'
import CardItem from '@/components/common/CardItem.vue'
import HeaderButton from '../layout/HeaderButton.vue'
import ConnectionCard from './ConnectionCard.vue'
import ConnectionEditor from './ConnectionEditor.vue'
import { useConnections, STATE_LABELS, hostOf } from '@/composables/useConnections.js'
import { kindOf } from '@/ai/providers.js'

/** @typedef {import('@/composables/useConnections.js').ConnectionState} ConnectionState */

/**
 * The writer's AI connections, each a card with its address, and what went
 * wrong when it was last asked, opening on its settings; and the plus for
 * another.
 */
const heading = useSectionHeading()
const connections = useConnections()

/** Where the hosted services answer, which their rows don't say. */
const HOSTED = /** @type {Record<string, string>} */ ({
  openrouter: 'openrouter.ai',
  anthropic: 'api.anthropic.com',
  openai: 'api.openai.com',
  nanogpt: 'nano-gpt.com',
})

/** The connection whose settings are open, if one's are. */
const open = ref(/** @type {string|null} */ (null))

/** Whether a new one is being made, and the one it made, while it is. */
const adding = ref(false)
const addedId = ref(/** @type {string|null} */ (null))

/** Every connection, less the one being made, which shows in its own form. */
const listed = computed(() =>
  connections.connections.value.filter(provider => provider.id !== addedId.value)
)

const startAdding = () => {
  adding.value = true
  addedId.value = null
  open.value = null
}

const stopAdding = () => {
  adding.value = false
  addedId.value = null
}

/** @param {import('@/types/models.js').AIProvider} provider */
const addressOf = provider =>
  HOSTED[provider.type] || hostOf(provider.endpoint || kindOf(provider).endpoint || '')

/**
 * What went wrong the last time it was asked, if something did: a card says
 * nothing of one that answered.
 * @param {string} id
 */
const statusOf = id => {
  const state = connections.stateOf(id)
  return state && state !== 'connected' ? STATE_LABELS[/** @type {ConnectionState} */ (state)] : ''
}
</script>
