<template>
  <div class="flex flex-col gap-3 pt-2 pb-1" data-share>
    <div v-if="owns" class="flex flex-col gap-1">
      <label for="share-code" class="text-xs font-medium text-surface-700 dark:text-surface-200"
        >Share with</label
      >
      <div class="flex items-center gap-2">
        <!-- The people this account shares with are offered as a name or a
             friend code is typed, and the arrows and Enter pick one. -->
        <div class="relative flex-1 min-w-0">
          <InputText
            id="share-code"
            v-model="code"
            size="small"
            autocomplete="off"
            spellcheck="false"
            placeholder="Name or friend code"
            class="w-full"
            role="combobox"
            aria-autocomplete="list"
            aria-haspopup="listbox"
            :aria-expanded="suggesting"
            :aria-controls="suggestionsId"
            :aria-activedescendant="suggesting ? `${suggestionsId}_${highlighted}` : undefined"
            :disabled="busy"
            data-field="share-code"
            @focus="suggestionsOpen = true"
            @input="suggestionsOpen = true"
            @blur="suggestionsOpen = false"
            @keydown="onKey"
          />
          <ul
            v-if="suggesting"
            :id="suggestionsId"
            role="listbox"
            aria-label="People"
            class="absolute z-10 left-0 right-0 mt-1 py-1 rounded-md bg-surface-0 dark:bg-surface-900 ring-1 ring-surface-300 dark:ring-surface-600 shadow-lg text-sm"
            data-share-suggestions
          >
            <li
              v-for="(person, at) in suggestions"
              :id="`${suggestionsId}_${at}`"
              :key="person.account"
              role="option"
              :aria-selected="at === highlighted"
              class="flex items-baseline justify-between gap-3 px-3 py-1 cursor-pointer"
              :class="{ 'bg-surface-100 dark:bg-surface-800': at === highlighted }"
              :data-suggestion="person.account"
              @mousedown.prevent="pick(person)"
              @mousemove="highlighted = at"
            >
              <span class="truncate text-surface-800 dark:text-surface-100">{{ person.name }}</span>
              <code
                class="flex-none text-xs tracking-wide text-surface-400 dark:text-surface-500"
                >{{ codeOf(person) }}</code
              >
            </li>
          </ul>
        </div>
        <Button
          label="Share"
          icon="pi pi-user-plus"
          size="small"
          outlined
          severity="secondary"
          :loading="busy"
          :disabled="!ready"
          data-action="share"
          @click="go"
        />
      </div>
    </div>
    <p v-if="failure" class="text-xs text-red-600 dark:text-red-400" data-share-error>
      {{ failure }}
    </p>

    <!-- Each one's name, and their friend code to tell two of a name apart
         by; who they are to this project goes beside them once there are
         kinds of member. -->
    <section v-if="members.length > 0" class="flex flex-col gap-1">
      <span class="text-xs font-medium text-surface-700 dark:text-surface-200">People</span>
      <ul class="flex flex-col" data-share-members>
        <li
          v-for="member in members"
          :key="member.account"
          class="grid grid-cols-[minmax(0,1fr)_auto_1.5rem] items-center gap-2 py-1 text-sm text-surface-700 dark:text-surface-200"
          :data-member="member.account"
        >
          <span class="flex items-baseline gap-2 min-w-0">
            <span class="truncate" data-member-name>{{ member.display || 'Someone' }}</span>
            <span
              v-if="member.invited"
              class="flex-none text-xs text-surface-500 dark:text-surface-400"
              data-member-invited
              >Invited</span
            >
            <span
              v-if="tagOf(member)"
              class="flex-none text-xs text-surface-500 dark:text-surface-400"
              data-member-tag
              >{{ tagOf(member) }}</span
            >
          </span>
          <code
            class="text-xs tracking-wide select-all text-surface-500 dark:text-surface-400"
            data-member-friend
            >{{ codeOf(member) }}</code
          >
          <button
            v-if="owns && !member.owner"
            v-tooltip.bottom="member.invited ? 'Take back' : 'Remove'"
            type="button"
            class="w-6 h-6 rounded flex items-center justify-center text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-surface-0"
            :aria-label="`Remove ${member.display || 'them'}`"
            :disabled="busy"
            data-action="remove-member"
            @click="remove(member.account)"
          >
            <i class="pi pi-times" style="font-size: 0.7rem" />
          </button>
          <span v-else />
        </li>
      </ul>
    </section>

    <template v-if="owns && choosesDocuments">
      <div class="flex items-center justify-between gap-2">
        <label for="share-whole" class="text-xs font-medium text-surface-700 dark:text-surface-200"
          >Share entire project</label
        >
        <ToggleSwitch
          :model-value="!selective"
          input-id="share-whole"
          class="flex-none"
          :disabled="busy"
          data-field="share-whole"
          @update:model-value="whole => choose(!whole)"
        />
      </div>
      <!-- Each its own box: ticked where shared, half where seen only on
           the way to something shared. A click goes for everything in it,
           and leaves the folders above as they are. Shared whole, it is all
           ticked, and greyed until the switch is turned off. -->
      <div
        class="max-h-[min(18rem,40vh)] overflow-y-auto"
        :class="{ 'opacity-50': !selective }"
        :aria-disabled="!selective || undefined"
        data-share-tree
      >
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
            <label
              class="flex items-center gap-2"
              :class="selective ? 'cursor-pointer' : 'cursor-default'"
              :data-share-node="node.key"
            >
              <Checkbox
                :model-value="!selective || shares.sharingOf(node.key) === 'shared'"
                :indeterminate="selective && shares.sharingOf(node.key) === 'partly'"
                binary
                size="small"
                :disabled="!selective"
                @update:model-value="value => shares.setShared(node.key, value)"
              />
              <span>{{ node.label }}</span>
            </label>
          </template>
        </Tree>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, useId, watch } from 'vue'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import InputText from 'primevue/inputtext'
import ToggleSwitch from 'primevue/toggleswitch'
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
 * Settings › Project › Sharing: who the project is shared with, each by name
 * and friend code, those invited and not yet answered marked so, and, for
 * its owner, sharing it with someone else by their friend code, or by the
 * name of someone among the people this account shares with, or taking
 * someone out, or an invitation back. The owner also chooses whether it is
 * shared whole or only some of its documents, ticked in a tree of boxes;
 * either takes effect at once. See composables/useCloudSync.js and
 * composables/useSharedDocuments.js.
 *
 * @typedef {import('@/cloud/api.js').Member} Member
 *
 * @typedef {Object} Props
 * @property {string} storyId
 */
const props = defineProps({
  storyId: { type: String, required: true },
})

const cloud = useCloudSync()
const store = useDocumentsStore()
const { displayTitle } = useDocuments(props.storyId)
const shares = useSharedDocuments(props.storyId)

/** Whether the owner may share only some of the documents. */
const choosesDocuments = inPreview('selective-sharing')

const code = ref('')
const busy = ref(false)
/** @type {import('vue').Ref<string|null>} */
const failure = ref(null)

/** This project as sync last heard of it, if it is shared. */
const shared = computed(() => sharing.value.projects[props.storyId] ?? null)

/** Whether it is this account's: shared by it, or shared with no one yet. */
const owns = computed(() => !shared.value || shared.value.role === 'owner')

const members = computed(() => shared.value?.members ?? [])

/** @param {Member} member */
const tagOf = member =>
  member.account === (me.value ?? sharing.value.me) ? 'You' : member.owner ? 'Owner' : ''

/** @param {{friend?: string|null}} member */
const codeOf = member => (member.friend ? (readFriendCode(member.friend) ?? member.friend) : '')

/** @typedef {import('@/cloud/api.js').Person} Person */

/** The saved person a name is, as typed. */
const named = computed(() => {
  const typed = code.value.trim().toLowerCase()
  return (cloud.people.value?.people ?? []).find(
    person => person.name.toLowerCase() === typed && person.friend
  )
})

/** The friend code to share with: as typed, or a saved person's. */
const chosenCode = computed(
  () => readFriendCode(code.value) ?? readFriendCode(named.value?.friend ?? '')
)

const ready = computed(() => Boolean(chosenCode.value))

// The saved people offered as the field is typed in.
const suggestionsId = `share_suggestions_${useId()}`
const suggestionsOpen = ref(false)
const highlighted = ref(0)

/** The saved people not in the project, whose name or friend code starts with what is typed. */
const suggestions = computed(() => {
  const typed = code.value.trim().toLowerCase()
  const inIt = new Set(members.value.map(member => member.account))
  return (cloud.people.value?.people ?? []).filter(
    person =>
      person.friend &&
      !inIt.has(person.account) &&
      (person.name.toLowerCase().startsWith(typed) ||
        person.friend.toLowerCase().replace(/-/g, '').startsWith(typed.replace(/-/g, '')))
  )
})

const suggesting = computed(
  () => owns.value && suggestionsOpen.value && suggestions.value.length > 0 && !named.value
)

watch(suggestions, () => (highlighted.value = 0))

/**
 * Put a saved person in the field.
 * @param {Person} person
 */
function pick(person) {
  code.value = person.name
  suggestionsOpen.value = false
}

/**
 * The arrows move through the people offered, Enter or Tab picks one, and
 * Escape puts them away; Enter shares once there is someone to share with.
 * @param {KeyboardEvent} event
 */
function onKey(event) {
  if (!suggesting.value) {
    if (event.key === 'Enter') go()
    return
  }
  const count = suggestions.value.length
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    highlighted.value = (highlighted.value + step + count) % count
  } else if (event.key === 'Enter' || event.key === 'Tab') {
    event.preventDefault()
    pick(suggestions.value[highlighted.value])
  } else if (event.key === 'Escape') {
    event.stopPropagation()
    suggestionsOpen.value = false
  }
}

onMounted(() => {
  if (cloud.account.value) cloud.refreshPeople().catch(() => {})
})

/** The choice being made, until sync has it. @type {import('vue').Ref<boolean|null>} */
const choosing = ref(null)

/** Whether it is shared with only some of its documents. */
const selective = computed(
  () => choosing.value ?? (choosesDocuments && sharing.value.selective.includes(props.storyId))
)

/** @type {import('vue').Ref<Record<string, boolean>>} */
const expanded = ref({ [store.getRoot(props.storyId)?.id ?? '']: true })

/** The project's documents, as boxes. */
const nodes = computed(() => {
  const root = store.getRoot(props.storyId)
  return root ? shareTree(root, parentId => store.getChildrenOrdered(parentId), displayTitle) : []
})

/**
 * Share it whole, or only some of its documents.
 * @param {boolean} value
 */
async function choose(value) {
  if (busy.value || value === selective.value) return
  choosing.value = value
  busy.value = true
  failure.value = null
  try {
    await cloud.setSelective(props.storyId, value)
  } catch (error) {
    failure.value = /** @type {Error} */ (error).message
  } finally {
    choosing.value = null
    busy.value = false
  }
}

/** Share the project with the account the code is of, or the person named. */
async function go() {
  if (!chosenCode.value || busy.value) return
  busy.value = true
  failure.value = null
  try {
    await cloud.share(props.storyId, chosenCode.value)
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
