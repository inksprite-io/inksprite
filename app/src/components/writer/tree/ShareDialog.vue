<template>
  <Dialog
    :visible="visible"
    :header="owns ? `Share “${title}”` : `People in “${title}”`"
    :modal="true"
    class="w-full max-w-md"
    data-share-dialog
    @update:visible="value => emit('update:visible', value)"
  >
    <div class="flex flex-col gap-4">
      <ul v-if="members.length > 0" class="flex flex-col" data-share-members>
        <li
          v-for="member in members"
          :key="member.account"
          class="flex items-center gap-2 py-1 text-sm text-surface-700 dark:text-surface-200"
          :data-member="member.account"
        >
          <span class="flex-1 min-w-0 truncate">{{ member.display || 'Someone' }}</span>
          <span class="text-xs text-surface-500 dark:text-surface-400">
            {{ member.account === me ? 'You' : member.owner ? 'Owner' : '' }}
          </span>
          <button
            v-if="owns && !member.owner"
            v-tooltip.bottom="'Remove'"
            type="button"
            class="flex-none w-6 h-6 rounded flex items-center justify-center text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-surface-0"
            :aria-label="`Remove ${member.display || 'them'}`"
            :disabled="busy"
            data-action="remove-member"
            @click="remove(member.account)"
          >
            <i class="pi pi-times" style="font-size: 0.7rem" />
          </button>
        </li>
      </ul>

      <template v-if="owns">
        <label
          v-if="needsName"
          class="flex flex-col gap-1 text-xs font-medium text-surface-700 dark:text-surface-200"
        >
          Name others see
          <InputText
            v-model="display"
            size="small"
            autocomplete="name"
            :disabled="busy"
            data-field="share-display"
          />
        </label>
        <label
          class="flex flex-col gap-1 text-xs font-medium text-surface-700 dark:text-surface-200"
        >
          Friend code
          <InputText
            v-model="code"
            size="small"
            autocomplete="off"
            spellcheck="false"
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            :disabled="busy"
            data-field="share-code"
            @keydown.enter="go"
          />
        </label>
      </template>

      <div class="flex items-center justify-end gap-3">
        <p v-if="failure" class="mr-auto text-xs text-red-600 dark:text-red-400" data-share-error>
          {{ failure }}
        </p>
        <Button
          v-if="owns"
          label="Share"
          size="small"
          :loading="busy"
          :disabled="!ready"
          data-action="share"
          @click="go"
        />
      </div>
    </div>
  </Dialog>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import { readFriendCode } from '@/cloud/crypto.js'
import { me, sharing } from '@/cloud/people.js'
import { useCloudSync } from '@/composables/useCloudSync.js'

/**
 * A project's people: who it is shared with, and, for its owner, sharing it
 * with someone else by their friend code, or taking someone out. Shared with
 * no one yet, its owner may first have to give the name others see. See
 * composables/useCloudSync.js.
 *
 * @typedef {Object} Props
 * @property {boolean} visible
 * @property {string} storyId
 * @property {string} title - The project's
 */
const props = defineProps({
  visible: { type: Boolean, default: false },
  storyId: { type: String, required: true },
  title: { type: String, default: '' },
})

const emit = defineEmits(['update:visible'])

const cloud = useCloudSync()

const code = ref('')
const display = ref('')
const busy = ref(false)
/** @type {import('vue').Ref<string|null>} */
const failure = ref(null)
/** Whether the account has no name for others yet. */
const needsName = ref(false)

/** This project as sync last heard of it, if it is shared. */
const shared = computed(() => sharing.value.projects[props.storyId] ?? null)

/** Whether it is this account's: shared by it, or shared with no one yet. */
const owns = computed(() => !shared.value || shared.value.role === 'owner')

const members = computed(() => shared.value?.members ?? [])

const ready = computed(
  () => Boolean(readFriendCode(code.value)) && (!needsName.value || Boolean(display.value.trim()))
)

watch(
  () => props.visible,
  async open => {
    if (!open) return
    code.value = ''
    failure.value = null
    try {
      const profile = await cloud.profile()
      needsName.value = !profile.display
      display.value = profile.display ?? ''
    } catch (error) {
      failure.value = /** @type {Error} */ (error).message
    }
  },
  { immediate: true }
)

/** Share the project with the account the code is of. */
async function go() {
  if (!ready.value || busy.value) return
  busy.value = true
  failure.value = null
  try {
    if (needsName.value) {
      await cloud.setDisplay(display.value.trim())
      needsName.value = false
    }
    await cloud.share(props.storyId, code.value)
    code.value = ''
  } catch (error) {
    failure.value = /** @type {Error} */ (error).message
  } finally {
    busy.value = false
  }
}

/** @param {number} account */
async function remove(account) {
  busy.value = true
  failure.value = null
  try {
    await cloud.removeMember(props.storyId, account)
  } catch (error) {
    failure.value = /** @type {Error} */ (error).message
  } finally {
    busy.value = false
  }
}
</script>
