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

      <template v-if="owns && choosesDocuments">
        <SelectButton
          :model-value="selective"
          :options="SCOPES"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          :disabled="busy"
          aria-label="What is shared"
          data-field="share-scope"
          @update:model-value="choose"
        />
        <!-- Each its own box: ticked where shared, half where seen only on
             the way to something shared. A click goes for everything in it,
             and leaves the folders above as they are. -->
        <div v-if="selective" class="max-h-[min(18rem,40vh)] overflow-y-auto" data-share-tree>
          <Tree
            v-model:expanded-keys="expanded"
            :value="nodes"
            :pt="{
              root: { class: '!p-0 !bg-transparent' },
              node: { class: '!outline-none' },
              nodeContent: { class: '!py-0.5 !px-1' },
              nodeLabel: { class: 'text-sm leading-snug' },
            }"
          >
            <template #default="{ node }">
              <label class="flex items-center gap-2 cursor-pointer" :data-share-node="node.key">
                <Checkbox
                  :model-value="shares.sharingOf(node.key) === 'shared'"
                  :indeterminate="shares.sharingOf(node.key) === 'partly'"
                  binary
                  size="small"
                  @update:model-value="value => shares.setShared(node.key, value)"
                />
                <span>{{ node.label }}</span>
              </label>
            </template>
          </Tree>
        </div>
      </template>

      <label
        v-if="owns"
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
import Checkbox from 'primevue/checkbox'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import SelectButton from 'primevue/selectbutton'
import Tree from 'primevue/tree'
import { readFriendCode } from '@/cloud/crypto.js'
import { me, sharing } from '@/cloud/people.js'
import { inPreview } from '@/config/preview.js'
import { useCloudSync } from '@/composables/useCloudSync.js'
import { useDocuments } from '@/composables/useDocuments'
import { useSharedDocuments } from '@/composables/useSharedDocuments.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { shareTree } from '@/utils/sharedDocuments.js'

/**
 * A project's people: who it is shared with, and, for its owner, sharing it
 * with someone else by their friend code, or taking someone out. The owner
 * also chooses whether it is shared whole or only some of its documents,
 * ticked in a tree of boxes; either takes effect at once. See
 * composables/useCloudSync.js and composables/useSharedDocuments.js.
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
const store = useDocumentsStore()
const { displayTitle } = useDocuments(props.storyId)
const shares = useSharedDocuments(props.storyId)

/** Whether the owner may share only some of the documents. */
const choosesDocuments = inPreview('selective-sharing')

const SCOPES = [
  { label: 'Entire project', value: false },
  { label: 'Only selected documents', value: true },
]

const code = ref('')
const busy = ref(false)
/** @type {import('vue').Ref<string|null>} */
const failure = ref(null)

/** This project as sync last heard of it, if it is shared. */
const shared = computed(() => sharing.value.projects[props.storyId] ?? null)

/** Whether it is this account's: shared by it, or shared with no one yet. */
const owns = computed(() => !shared.value || shared.value.role === 'owner')

const members = computed(() => shared.value?.members ?? [])

const ready = computed(() => Boolean(readFriendCode(code.value)))

/** Whether it is shared with only some of its documents, as last chosen. */
const selective = ref(false)

/** @type {import('vue').Ref<Record<string, boolean>>} */
const expanded = ref({})

/** The project's documents, as boxes. */
const nodes = computed(() => {
  const root = store.getRoot(props.storyId)
  return root ? shareTree(root, parentId => store.getChildrenOrdered(parentId), displayTitle) : []
})

watch(
  () => props.visible,
  open => {
    if (!open) return
    code.value = ''
    failure.value = null
    selective.value = choosesDocuments && sharing.value.selective.includes(props.storyId)
    const root = store.getRoot(props.storyId)
    expanded.value = root ? { [root.id]: true } : {}
  },
  { immediate: true }
)

/**
 * Share it whole, or only some of its documents.
 * @param {boolean} value
 */
async function choose(value) {
  if (busy.value || value === selective.value) return
  selective.value = value
  busy.value = true
  failure.value = null
  try {
    await cloud.setSelective(props.storyId, value)
  } catch (error) {
    selective.value = !value
    failure.value = /** @type {Error} */ (error).message
  } finally {
    busy.value = false
  }
}

/** Share the project with the account the code is of. */
async function go() {
  if (!ready.value || busy.value) return
  busy.value = true
  failure.value = null
  try {
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
