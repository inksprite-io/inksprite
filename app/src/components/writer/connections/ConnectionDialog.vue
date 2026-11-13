<template>
  <Dialog
    :visible="visible"
    :header="current?.name || 'Add connection'"
    :modal="true"
    class="w-full max-w-lg"
    :pt="settingsLook()"
    data-connection-dialog
    @update:visible="open => open || close()"
  >
    <ConnectionEditor
      :provider-id="providerId"
      :kind-id="kindId"
      :does="does"
      @shown="shownId = $event"
      @removed="emit('close', null)"
    />

    <template #footer>
      <div class="flex w-full items-center justify-end gap-2">
        <Button label="Done" size="small" data-action="done" @click="close" />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, ref } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import { settingsLook } from '@/components/common/settingsLook.js'
import ConnectionEditor from './ConnectionEditor.vue'
import { useAIConfig } from '@/composables/useAIConfig'

/**
 * A connection's settings in a dialog (`ConnectionEditor`): where a chat's
 * failed reply opens them, and setup's. Settings › Connections opens them in
 * the connection's card instead.
 *
 * @typedef {Object} Props
 * @property {boolean} visible
 * @property {string} [providerId] - The connection; none to add one
 * @property {string} [kindId] - The provider a new one starts on
 * @property {import('@/ai/providers.js').ProviderKind} [does] - What a new
 *   one must be able to do
 */
const props = defineProps({
  visible: { type: Boolean, default: false },
  providerId: { type: String, default: null },
  kindId: { type: String, default: null },
  does: { type: String, default: null },
})

/** `close`: with the connection it is on, which may be one it made, or null. */
const emit = defineEmits(['close'])

const aiConfig = useAIConfig()

/** The connection the form is on: the one given, or the one it made. */
const shownId = ref(/** @type {string|null} */ (props.providerId))
const current = computed(() => (shownId.value ? aiConfig.getProvider(shownId.value) : null))

/** Close, saying which connection it was on. */
const close = () => emit('close', current.value?.id ?? null)
</script>
