<template>
  <Dialog
    :visible="visible"
    :header="page === 'connect' ? 'Connect an AI provider' : 'Choose a model'"
    :modal="true"
    :draggable="false"
    class="w-[min(36rem,95vw)] h-[min(36rem,90vh)]"
    :pt="settingsLook('flex-1 min-h-0 flex flex-col')"
    data-setup-wizard
    @update:visible="open => open || emit('update:visible', false)"
  >
    <div v-show="page === 'connect'" class="flex-1 min-h-0 overflow-y-auto">
      <ConnectionForm
        mode="setup"
        does="chat"
        :kind-id="startingKind"
        @shown="shownId = $event"
        @connected="connected"
      />
    </div>

    <div v-if="page === 'model' && shownId" class="flex-1 min-h-0 flex flex-col" data-setup-model>
      <ModelList
        class="flex-1 min-h-0"
        :provider-ids="[shownId]"
        :choice="{ providerId: shownId, model: picked }"
        @update:choice="choice => pick(choice.model)"
        @use="choice => (pick(choice.model), done())"
      />
    </div>

    <template #footer>
      <div class="flex w-full items-center justify-between gap-2">
        <Button
          v-if="page === 'model'"
          label="Back"
          size="small"
          severity="secondary"
          text
          data-action="back"
          @click="page = 'connect'"
        />
        <span v-else />
        <Button
          v-if="page === 'connect'"
          label="Next"
          size="small"
          :disabled="!ready"
          data-action="next"
          @click="toModels"
        />
        <Button
          v-else
          label="Done"
          size="small"
          :disabled="!picked"
          data-action="done"
          @click="done"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, ref } from 'vue'
import Dialog from 'primevue/dialog'
import { settingsLook } from '@/components/common/settingsLook.js'
import Button from 'primevue/button'
import ModelList from '../models/ModelList.vue'
import ConnectionForm from './ConnectionForm.vue'
import { useAIConfig } from '@/composables/useAIConfig'
import { useApplicationState } from '@/composables/useApplicationState'
import { useChatSettings } from '@/composables/useChatSettings'
import { useConnections } from '@/composables/useConnections.js'
import { useModelLists } from '@/composables/useModelLists'
import { useProfiles } from '@/composables/useProfiles'
import { BUILT_IN_PROFILES } from '@/ai/profiles/index.js'
import { kindOf } from '@/ai/providers.js'
import { suggestModel } from '@/ai/suggestions.js'

/**
 * Setting up the AI, from the chat's "No AI provider is connected": connect
 * a provider, then choose a model, with one picked already. Done puts the
 * chat that asked, every built-in profile and Convert on it.
 *
 * Design: `.llm/ai_setup_design.md`, "Step 2: setup".
 *
 * @typedef {Object} Props
 * @property {boolean} visible
 * @property {string} storyId
 * @property {string} chatId - The chat that asked, which can be the unstarted one
 */
const props = defineProps({
  visible: { type: Boolean, default: false },
  storyId: { type: String, required: true },
  chatId: { type: String, required: true },
})

/** `done`: the model is chosen, and the chat is on it. */
const emit = defineEmits(['update:visible', 'done'])

const aiConfig = useAIConfig()
const app = useApplicationState()
const connections = useConnections()
const modelLists = useModelLists()
const profiles = useProfiles()
const chat = useChatSettings(props.storyId, () => props.chatId)

const page = ref(/** @type {'connect'|'model'} */ ('connect'))

/** The provider the first page starts on: the writer's own, where they connected one already. */
const startingKind = (() => {
  const theirs = connections.connectionsFor('chat')[0]
  return theirs ? kindOf(theirs).id : null
})()

/** The connection the first page is on. */
const shownId = ref(/** @type {string|null} */ (null))
const provider = computed(() => (shownId.value ? aiConfig.getProvider(shownId.value) : null))

/** Whether the connection shown answered, so there is a list to choose from. */
const ready = computed(() => connections.stateOf(shownId.value) === 'connected')

/** What OpenRouter said of the account when it was last asked, by connection. */
const freeTier = ref(/** @type {Record<string, boolean>} */ ({}))

/** @param {{providerId: string, freeTier?: boolean}} result */
function connected({ providerId, freeTier: free }) {
  if (free !== undefined) freeTier.value = { ...freeTier.value, [providerId]: free }
}

const list = computed(() => (shownId.value ? modelLists.listOf(shownId.value) : undefined))
const models = computed(() => list.value?.models ?? [])
const picked = ref(/** @type {string|null} */ (null))

/**
 * Choose a model. Clicking the one chosen again leaves it chosen: the list
 * would take that for letting it go.
 * @param {string|null} id
 */
const pick = id => {
  if (id) picked.value = id
}

/** Ask the connection what it serves. */
async function loadModels() {
  if (!shownId.value) return
  await modelLists.load(shownId.value).catch(error => {
    console.error(`Listing ${provider.value?.name}'s models failed:`, error)
  })
}

/** On to the models, the suggested one picked. */
async function toModels() {
  const id = shownId.value
  if (!id || !provider.value) return
  page.value = 'model'
  // An OpenRouter connection set up before says nothing of the account until asked.
  if (provider.value.type === 'openrouter' && freeTier.value[id] === undefined) {
    connected({ providerId: id, freeTier: (await connections.check(id)).freeTier })
  }
  if (!list.value || list.value.models.length === 0) await loadModels()
  const kind = kindOf(provider.value).id
  if (!picked.value || !models.value.some(model => model.id === picked.value)) {
    picked.value = suggestModel(kind, models.value, { freeTier: freeTier.value[id] })
  }
}

/**
 * Put everything on the model: the chat that asked and its profile, every
 * built-in profile, and Convert.
 */
function done() {
  const providerId = shownId.value
  const model = picked.value
  if (!providerId || !model) return
  chat.setModel(providerId, model)
  for (const profile of BUILT_IN_PROFILES) {
    profiles.setProfileChoices(profile.id, { providerId, model })
  }
  app.setWorkflow('convert', { providerId, model })
  emit('update:visible', false)
  emit('done')
}
</script>
