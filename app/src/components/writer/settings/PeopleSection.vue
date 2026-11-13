<template>
  <!-- Adding someone and showing those blocked, beside the heading. -->
  <Teleport defer :to="heading" :disabled="!heading">
    <HeaderButton
      v-if="blocked.length > 0"
      icon="pi pi-ban"
      :label="showingBlocked ? 'Hide blocked' : 'Show blocked'"
      :class="{ '!text-surface-900 dark:!text-surface-0': showingBlocked }"
      :aria-pressed="showingBlocked"
      data-action="show-blocked"
      @click="showingBlocked = !showingBlocked"
    />
    <HeaderButton
      icon="pi pi-plus"
      label="Add person"
      data-action="add-person"
      @click="startAdding"
    />
  </Teleport>
  <div class="flex flex-col gap-1" data-sync-people>
    <InputText
      v-if="adding"
      ref="field"
      v-model="code"
      size="small"
      autocomplete="off"
      spellcheck="false"
      placeholder="Friend code"
      aria-label="Friend code"
      class="w-full"
      :disabled="busy"
      data-field="add-person"
      @keydown.enter="add"
      @keydown.escape.stop="stopAdding"
      @blur="code.trim() || stopAdding()"
    />

    <ul class="flex flex-col">
      <li
        v-for="person in listed"
        :key="person.account"
        tabindex="0"
        class="flex items-center justify-between gap-2 px-1 py-1 rounded text-sm text-surface-700 dark:text-surface-200 focus-visible:outline-2 focus-visible:outline-primary-500 cursor-default"
        :class="{ 'bg-surface-100 dark:bg-surface-800': menuFor?.account === person.account }"
        :data-person="person.account"
        @contextmenu.prevent="showMenu($event, person)"
        @touchstart.passive="pressOn($event, person)"
        @touchmove.passive="press.touchmove"
        @touchend="press.touchend"
        @touchcancel="press.touchend"
      >
        <span class="truncate" data-person-name>{{ person.name }}</span>
        <span
          v-if="person.blocked"
          class="flex-none text-xs text-surface-500 dark:text-surface-400"
          data-person-blocked
          >Blocked</span
        >
      </li>
    </ul>

    <p v-if="failure" class="text-xs text-red-600 dark:text-red-400" data-people-error>
      {{ failure }}
    </p>
  </div>
  <ContextMenu ref="menu" :model="menuItems" @hide="menuFor = null" />
</template>

<script setup>
import { computed, nextTick, onMounted, ref } from 'vue'
import ContextMenu from 'primevue/contextmenu'
import InputText from 'primevue/inputtext'
import HeaderButton from '../layout/HeaderButton.vue'
import { useSectionHeading } from '@/components/common/sectionHeading.js'
import { readFriendCode } from '@/cloud/crypto.js'
import { sharedBetween, useBlocking } from '@/composables/useBlocking.js'
import { useCloudSync } from '@/composables/useCloudSync.js'
import { useLongPress } from '@/composables/useLongPress.js'
import { useToast } from '@/composables/useToast.js'

/**
 * Settings › Sync and sharing › People: the people this account shares
 * with, kept by the server, by name. Right-clicked, or held under a finger,
 * one is copied by their friend code, let go of (only while nothing is
 * shared between the two) or blocked. The +, beside the heading, adds someone by their friend
 * code. Those blocked are listed only when asked for, with Unblock. See
 * composables/useCloudSync.js.
 *
 * @typedef {import('@/cloud/api.js').Person} Person
 * @typedef {Person & {blocked?: boolean}} Listed
 */

const cloud = useCloudSync()
const toast = useToast()
const { block } = useBlocking()

const heading = useSectionHeading()
const field = ref()
const menu = ref()

const adding = ref(false)
const code = ref('')
const busy = ref(false)
/** @type {import('vue').Ref<string|null>} */
const failure = ref(null)
const showingBlocked = ref(false)

const blocked = computed(() => cloud.people.value?.blocked ?? [])

/** The people, and those blocked once asked for. @type {import('vue').ComputedRef<Listed[]>} */
const listed = computed(() => [
  ...(cloud.people.value?.people ?? []),
  ...(showingBlocked.value ? blocked.value.map(person => ({ ...person, blocked: true })) : []),
])

/** Whom the menu is open for. @type {import('vue').Ref<Listed|null>} */
const menuFor = ref(null)
/** @type {import('vue').Ref<Array<Object>>} */
const menuItems = ref([])

/**
 * Whether any project is shared between this account and another, either way.
 * @param {number} account
 */
const shares = account => {
  const between = sharedBetween(account)
  return between.mine.length > 0 || between.theirs.length > 0
}

/**
 * Someone's menu.
 * @param {Event} event
 * @param {Listed} person
 */
function showMenu(event, person) {
  menuFor.value = person
  menuItems.value = [
    ...(person.friend
      ? [{ label: 'Copy friend code', icon: 'pi pi-copy', command: () => copy(person) }]
      : []),
    ...(person.blocked
      ? [
          {
            label: 'Unblock',
            icon: 'pi pi-undo',
            command: () => run(() => cloud.unblock(person.account)),
          },
        ]
      : [
          ...(shares(person.account)
            ? []
            : [
                {
                  label: 'Forget',
                  icon: 'pi pi-times',
                  command: () => run(() => cloud.forgetPerson(person.account)),
                },
              ]),
          { label: 'Block', icon: 'pi pi-ban', command: () => run(() => block(person)) },
        ]),
  ]
  menu.value?.show(event)
}

/** Whom a finger went down on. @type {Listed|null} */
let pressedOn = null

const press = useLongPress(({ x, y }) => {
  if (!pressedOn) return
  showMenu(
    /** @type {any} */ ({
      pageX: x + window.scrollX,
      pageY: y + window.scrollY,
      stopPropagation() {},
      preventDefault() {},
    }),
    pressedOn
  )
})

/**
 * @param {TouchEvent} event
 * @param {Listed} person
 */
const pressOn = (event, person) => {
  pressedOn = person
  press.touchstart(event)
}

/** @param {Listed} person */
async function copy(person) {
  try {
    await navigator.clipboard.writeText(readFriendCode(person.friend ?? '') ?? person.friend ?? '')
    toast.success('Friend code copied.')
  } catch {
    toast.error("The friend code couldn't be copied.")
  }
}

/**
 * Do something, saying why if it couldn't be done.
 * @param {() => Promise<unknown>} work
 */
async function run(work) {
  if (busy.value) return
  busy.value = true
  failure.value = null
  try {
    await work()
  } catch (error) {
    failure.value = /** @type {Error} */ (error).message
  } finally {
    busy.value = false
  }
}

/** Open the field a friend code goes in. */
async function startAdding() {
  adding.value = true
  failure.value = null
  await nextTick()
  field.value?.$el?.focus()
}

function stopAdding() {
  adding.value = false
  code.value = ''
}

/** Keep the account the code is of among the people. */
async function add() {
  if (!readFriendCode(code.value)) {
    failure.value = "That isn't a friend code."
    return
  }
  await run(async () => {
    await cloud.addPerson(code.value)
    stopAdding()
  })
}

onMounted(() => {
  cloud.refreshPeople().catch(error => console.warn('The people could not be listed:', error))
})
</script>
