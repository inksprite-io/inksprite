<template>
  <div class="flex flex-col" data-sync>
    <div class="flex flex-col gap-3 px-2 pt-1 pb-2">
      <template v-if="account">
        <!-- A recovery code just made, shown this once. -->
        <div
          v-if="shownCode"
          class="flex flex-col gap-2 rounded border border-surface-200 dark:border-surface-700 p-3"
          data-recovery-shown
        >
          <span class="text-xs font-medium text-surface-700 dark:text-surface-200">
            Recovery code
          </span>
          <code
            class="text-sm tracking-wide select-all text-surface-900 dark:text-surface-0"
            data-recovery-code
            >{{ shownCode }}</code
          >
          <p class="text-xs text-surface-500 dark:text-surface-400">
            It signs in to this account if the passphrase is forgotten. Keep it where you keep the
            passphrase.
          </p>
          <div class="flex justify-end gap-2">
            <Button
              :label="copied ? 'Copied' : 'Copy'"
              :icon="copied ? 'pi pi-check' : 'pi pi-copy'"
              size="small"
              text
              data-action="copy-recovery"
              @click="copyCode"
            />
            <Button
              label="Done"
              size="small"
              data-action="recovery-done"
              @click="shownCode = null"
            />
          </div>
        </div>

        <p class="text-xs text-surface-700 dark:text-surface-200" data-sync-account>
          Signed in as {{ account.name }} on {{ host(account.server) }}
        </p>
        <!-- What sync is doing, with a sync to start by hand, and what the
             account keeps of its quota. -->
        <div class="flex items-center gap-2 text-xs">
          <button
            v-tooltip.bottom="'Sync now'"
            type="button"
            class="flex-none w-6 h-6 -ml-1 rounded flex items-center justify-center text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-surface-0"
            aria-label="Sync now"
            :disabled="status.phase === 'syncing'"
            data-action="sync-now"
            @click="syncNow"
          >
            <i
              class="pi pi-sync"
              :class="{ 'pi-spin': status.phase === 'syncing' }"
              style="font-size: 0.75rem"
            />
          </button>
          <span
            class="min-w-0"
            :class="
              status.phase === 'error' || status.full
                ? 'text-red-600 dark:text-red-400'
                : 'text-surface-500 dark:text-surface-400'
            "
            data-sync-status
            >{{ said }}</span
          >
          <Button
            v-if="update"
            label="Update"
            size="small"
            text
            class="!py-0"
            data-action="sync-update"
            @click="update.apply()"
          />
          <span
            v-if="kept"
            class="ml-auto flex-none text-surface-500 dark:text-surface-400"
            data-sync-usage
            >{{ kept }}</span
          >
        </div>
        <p
          v-if="keptHere"
          class="text-xs text-surface-500 dark:text-surface-400"
          data-sync-kept-here
        >
          {{ keptHere }}
        </p>
      </template>

      <template v-else>
        <p v-if="notice" class="text-xs text-red-600 dark:text-red-400" data-sync-notice>
          {{ notice }}
        </p>
        <p class="text-xs text-surface-500 dark:text-surface-400" data-sync-preview>
          Sync is in private preview. An account needs an invitation.
        </p>
        <SelectButton
          v-model="mode"
          :options="MODES"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          aria-label="Sign in, create an account, or recover one"
          data-field="sync-mode"
        />
        <label
          v-if="choosesServer"
          class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300"
        >
          Server
          <InputText
            v-model="server"
            size="small"
            placeholder="https://sync.example.com"
            autocomplete="url"
            data-field="sync-server"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300">
          Name
          <InputText v-model="name" size="small" autocomplete="username" data-field="sync-name" />
          <span
            v-if="mode === 'create'"
            class="text-surface-500 dark:text-surface-400"
            data-sync-name-format
            >{{ SHORTEST_NAME }} to {{ LONGEST_NAME }} letters, digits and hyphens</span
          >
        </label>
        <label
          v-if="mode === 'recover'"
          class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300"
        >
          Recovery code
          <InputText
            v-model="recoveryCode"
            size="small"
            autocomplete="off"
            spellcheck="false"
            data-field="sync-recovery-code"
          />
        </label>
        <label class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300">
          {{ mode === 'recover' ? 'New passphrase' : 'Passphrase' }}
          <InputText
            v-model="passphrase"
            size="small"
            type="password"
            :autocomplete="mode === 'sign-in' ? 'current-password' : 'new-password'"
            data-field="sync-passphrase"
            @keydown.enter="go"
          />
        </label>
        <label
          v-if="mode === 'create'"
          class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300"
        >
          Sign-up code
          <InputText v-model="code" size="small" data-field="sync-code" @keydown.enter="go" />
        </label>
        <div class="flex items-center justify-end gap-3">
          <p v-if="failure" class="mr-auto text-xs text-red-600 dark:text-red-400" data-sync-error>
            {{ failure }}
          </p>
          <Button
            :label="ACTIONS[mode]"
            size="small"
            :loading="working"
            :disabled="!ready"
            data-action="sync-sign-in"
            @click="go"
          />
        </div>
      </template>
    </div>

    <template v-if="account">
      <!-- The devices signed in, any of which can sign another out. -->
      <ExpandableSection
        v-if="deviceList.length > 0"
        title="Devices"
        storage-key="ui.settings.sync.devices"
        subsection
        container-class="pt-2"
        content-wrapper-class="flex flex-col"
      >
        <ul class="flex flex-col pt-1 pb-1" data-sync-devices>
          <li
            v-for="device in deviceList"
            :key="device.id"
            class="flex items-center gap-2 py-1 text-xs text-surface-700 dark:text-surface-200"
            :data-device="device.current ? 'this' : device.id"
          >
            <span class="flex-1 min-w-0 truncate">{{ device.device || 'A device' }}</span>
            <span class="text-surface-500 dark:text-surface-400">
              {{ device.current ? 'This device' : formatRelativeTime(device.used) }}
            </span>
            <button
              v-if="!device.current"
              v-tooltip.bottom="'Sign out'"
              type="button"
              class="flex-none w-6 h-6 rounded flex items-center justify-center text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-surface-0"
              :aria-label="`Sign out ${device.device || 'this device'}`"
              data-action="sign-out-device"
              @click="signOutOther(device)"
            >
              <i class="pi pi-sign-out" style="font-size: 0.7rem" />
            </button>
            <span v-else class="flex-none w-6" />
          </li>
        </ul>
      </ExpandableSection>

      <!-- The name the people this account shares with see, and the friend
           code they share with it by. Each project is shared from Settings ›
           Project. -->
      <ExpandableSection
        v-if="profile"
        title="Sharing"
        storage-key="ui.settings.sync.sharing"
        subsection
        container-class="pt-2"
        content-wrapper-class="flex flex-col"
      >
        <div class="flex flex-col gap-3 pt-2 pb-1" data-sync-sharing>
          <div class="flex flex-col gap-1">
            <label
              for="sync-display"
              class="text-xs font-medium text-surface-700 dark:text-surface-200"
              >Name others see</label
            >
            <InputText
              id="sync-display"
              v-model="display"
              size="small"
              autocomplete="name"
              data-field="sync-display"
              @keydown.enter="saveDisplay"
              @blur="saveDisplay"
            />
          </div>
          <div class="flex items-center gap-2" data-sync-friend>
            <span class="text-xs font-medium text-surface-700 dark:text-surface-200"
              >Friend code</span
            >
            <code
              class="flex-1 min-w-0 truncate text-xs tracking-wide select-all text-surface-900 dark:text-surface-0"
              data-friend-code
              >{{ profile.friend }}</code
            >
            <button
              v-tooltip.bottom="friendCopied ? 'Copied' : 'Copy'"
              type="button"
              class="flex-none w-6 h-6 rounded flex items-center justify-center text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700 hover:text-surface-900 dark:hover:text-surface-0"
              aria-label="Copy friend code"
              data-action="copy-friend-code"
              @click="copyFriendCode"
            >
              <i :class="friendCopied ? 'pi pi-check' : 'pi pi-copy'" style="font-size: 0.7rem" />
            </button>
          </div>
        </div>
      </ExpandableSection>

      <!-- This device's diagnostics, and what signs in: a new recovery code,
           a new passphrase, and signing out. -->
      <ExpandableSection
        title="Account"
        storage-key="ui.settings.sync.account"
        subsection
        container-class="pt-2"
        content-wrapper-class="flex flex-col"
      >
        <div class="flex flex-col gap-3 pt-2 pb-1">
          <div class="flex items-center justify-between gap-2">
            <label
              for="sync-diagnostics"
              class="text-xs font-medium text-surface-700 dark:text-surface-200"
              >Send diagnostics</label
            >
            <ToggleSwitch
              :model-value="sync.sendsDiagnostics.value"
              input-id="sync-diagnostics"
              class="flex-none"
              data-sync-diagnostics
              @update:model-value="sync.setSendsDiagnostics"
            />
          </div>

          <div v-if="!asking" class="flex flex-wrap gap-2">
            <Button
              :label="hasCode ? 'New recovery code…' : 'Make a recovery code…'"
              icon="pi pi-key"
              size="small"
              outlined
              severity="secondary"
              data-action="make-recovery"
              @click="ask('recovery')"
            />
            <Button
              label="Change passphrase…"
              icon="pi pi-lock"
              size="small"
              outlined
              severity="secondary"
              data-action="change-passphrase"
              @click="ask('passphrase')"
            />
            <Button
              label="Sign out"
              icon="pi pi-sign-out"
              size="small"
              outlined
              severity="secondary"
              data-action="sync-sign-out"
              @click="signOut"
            />
          </div>
          <div v-else class="flex flex-col gap-2" data-sync-asking>
            <label class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300">
              {{ asking === 'passphrase' ? 'Current passphrase' : 'Passphrase' }}
              <InputText
                v-model="current"
                size="small"
                type="password"
                autocomplete="current-password"
                data-field="sync-current"
                @keydown.enter="finish"
              />
            </label>
            <label
              v-if="asking === 'passphrase'"
              class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300"
            >
              New passphrase
              <InputText
                v-model="next"
                size="small"
                type="password"
                autocomplete="new-password"
                data-field="sync-next"
                @keydown.enter="finish"
              />
            </label>
            <p
              v-if="asking === 'recovery' && hasCode"
              class="text-xs text-surface-500 dark:text-surface-400"
            >
              The code you have now stops working.
            </p>
            <div class="flex items-center justify-end gap-2">
              <p
                v-if="askFailure"
                class="mr-auto text-xs text-red-600 dark:text-red-400"
                data-sync-error
              >
                {{ askFailure }}
              </p>
              <Button
                label="Cancel"
                size="small"
                text
                severity="secondary"
                @click="asking = null"
              />
              <Button
                :label="asking === 'recovery' ? 'Make code' : 'Change'"
                size="small"
                :loading="working"
                :disabled="!current || (asking === 'passphrase' && !next)"
                data-action="sync-confirm"
                @click="finish"
              />
            </div>
          </div>
        </div>
      </ExpandableSection>
    </template>

    <ExpandableSection
      title="Backup"
      storage-key="ui.settings.sync.backup"
      subsection
      container-class="pt-2"
      content-wrapper-class="flex flex-col"
    >
      <BackupSection />
    </ExpandableSection>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import SelectButton from 'primevue/selectbutton'
import ToggleSwitch from 'primevue/toggleswitch'
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import BackupSection from './BackupSection.vue'
import { HOSTED_SERVER } from '@/cloud/api.js'
import { takeInvite } from '@/cloud/invite.js'
import { LONGEST_NAME, SHORTEST_NAME } from '@/cloud/names.js'
import { hasDevFeatures } from '@/config/dev.js'
import { useCloudSync } from '@/composables/useCloudSync.js'
import { updateReady } from '@/composables/useUpdates.js'
import { useStoriesStore } from '@/stores/storiesStore'
import { useDocumentsStore } from '@/stores/documentsStore'
import { sizeLabel } from '@/files/inspect.js'
import { useReactiveTime } from '@/composables/useReactiveTime'
import { useToast } from '@/composables/useToast'

/**
 * Settings › Sync and sharing: signing this device in to a sync server,
 * making an account on one, or getting back into one with its recovery code;
 * once signed in, what sync is doing, with a sync to start by hand, how much
 * of its quota the account keeps, and which projects are kept on this device
 * only (each project's menu does that); the devices signed in, any of which
 * can be signed out from here; the name the people it shares projects with
 * see, and its friend code, which they share by (Settings › Project shares
 * each project); whether this device sends diagnostics, a new recovery code
 * or passphrase, and signing out; and, signed in or not, backups. Waiting for
 * an update, it offers the one ready. A recovery code is shown once, as it is
 * made. Opened from an invitation's link, it is ready to create an account
 * with its code. The server is ours, but in a build with dev features, where
 * it can be typed and an invitation's counts. See composables/useCloudSync.js.
 *
 * @typedef {import('@/cloud/api.js').Device} Device
 */

const sync = useCloudSync()
const { account, status, notice, usage, signOut, syncNow } = sync
const toast = useToast()
const { formatRelativeTime } = useReactiveTime()

const MODES = [
  { label: 'Sign in', value: 'sign-in' },
  { label: 'Create account', value: 'create' },
  { label: 'Recover', value: 'recover' },
]

/** What the button says in each mode. @type {Record<string, string>} */
const ACTIONS = { 'sign-in': 'Sign in', create: 'Create account', recover: 'Recover account' }

/** Whether the server can be other than ours. */
const choosesServer = hasDevFeatures()

const mode = ref('sign-in')
const server = ref(HOSTED_SERVER)
const name = ref('')
const passphrase = ref('')
const code = ref('')
const recoveryCode = ref('')
const working = ref(false)
/** @type {import('vue').Ref<string|null>} */
const failure = ref(null)

/** A recovery code just made, shown until the writer says they have it. @type {import('vue').Ref<string|null>} */
const shownCode = ref(null)

const invitation = takeInvite()
if (invitation) {
  mode.value = 'create'
  if (choosesServer && invitation.server) server.value = invitation.server
  code.value = invitation.code
}

const storiesStore = useStoriesStore()
const documentsStore = useDocumentsStore()

/** The projects kept on this device only, by name, as a sentence. */
const keptHere = computed(() => {
  const names = [...storiesStore.stories.values()]
    // Another device's, brought back from the trash here, is this one's alone too.
    .filter(story => story.syncOff || (story.keptElsewhere && !story.trashed))
    .map(story => documentsStore.getRoot(story.id)?.title || 'Untitled')
    .sort((a, b) => a.localeCompare(b))
  if (names.length === 0) return ''
  const listed =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
  return `${listed} ${names.length === 1 ? 'is' : 'are'} kept on this device only.`
})

/** What the account keeps, of how much it may. */
const kept = computed(() => {
  if (!usage.value) return ''
  const { used, quota } = usage.value
  return quota == null
    ? `${sizeLabel(used)} used`
    : `${sizeLabel(used)} of ${sizeLabel(quota)} used`
})

const ready = computed(
  () =>
    Boolean(server.value.trim() && name.value.trim() && passphrase.value) &&
    (mode.value !== 'create' || Boolean(code.value.trim())) &&
    (mode.value !== 'recover' || Boolean(recoveryCode.value.trim()))
)

/** The update sync waits for, once it is ready. */
const update = computed(() => (status.value.phase === 'held' ? updateReady.value : null))

/** A sync of this many changes or more says how many it has to send. */
const COUNTED_FROM = 100

/**
 * What sync is doing, in a few words. What waits after a round that went
 * through waits for what the writer can't hurry, such as a file's bytes
 * still on another device, and goes when it comes: here it is up to date.
 */
const said = computed(() => {
  const now = status.value
  if (now.phase === 'syncing') {
    return now.waiting >= COUNTED_FROM
      ? `Syncing ${now.waiting.toLocaleString()} changes…`
      : 'Syncing…'
  }
  if (now.phase === 'offline') {
    return navigator.onLine === false ? 'No network connection' : "Can't reach the sync server"
  }
  if (now.phase === 'held') return 'Update inksprite to keep syncing'
  if (now.error) return now.error
  if (now.full) return 'Sync storage is full'
  return now.last ? 'Up to date' : ''
})

/** @param {string} address */
function host(address) {
  try {
    return new URL(address).host
  } catch {
    return address
  }
}

async function go() {
  if (!ready.value || working.value) return
  working.value = true
  failure.value = null
  const details = {
    server: server.value.trim(),
    name: name.value.trim(),
    passphrase: passphrase.value,
  }
  try {
    if (mode.value === 'create') {
      shownCode.value = await sync.signUp({ ...details, code: code.value.trim() })
    } else if (mode.value === 'recover') {
      shownCode.value = await sync.recover({ ...details, code: recoveryCode.value })
    } else await sync.signIn(details)
    passphrase.value = ''
    code.value = ''
    recoveryCode.value = ''
  } catch (error) {
    failure.value = /** @type {Error} */ (error).message
  } finally {
    working.value = false
  }
}

/** Whether the code has just been copied, for its button to say so. */
const copied = ref(false)

/** Put the code on the clipboard, with a tick on the button for a moment. */
async function copyCode() {
  if (!shownCode.value) return
  try {
    await navigator.clipboard.writeText(shownCode.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    toast.error("The recovery code couldn't be copied. Select it and copy it instead.")
  }
}

/** The account as the people it shares with know it, once asked. @type {import('vue').Ref<{display: string|null, friend: string}|null>} */
const profile = ref(null)
const display = ref('')

/** Keep the name others see, if it changed; one cleared is put back. */
async function saveDisplay() {
  if (!profile.value) return
  const typed = display.value.trim()
  if (!typed) display.value = profile.value.display ?? ''
  if (!typed || typed === profile.value.display) return
  try {
    await sync.setDisplay(typed)
    profile.value = { ...profile.value, display: typed }
  } catch (error) {
    toast.error(`The name couldn't be saved. ${/** @type {Error} */ (error).message}`)
  }
}

/** Whether the friend code has just been copied, for its button to say so. */
const friendCopied = ref(false)

async function copyFriendCode() {
  if (!profile.value) return
  try {
    await navigator.clipboard.writeText(profile.value.friend)
    friendCopied.value = true
    setTimeout(() => (friendCopied.value = false), 1500)
  } catch {
    toast.error("The friend code couldn't be copied. Select it and copy it instead.")
  }
}

/** @type {import('vue').Ref<Device[]>} */
const deviceList = ref([])
/** Whether the account has a recovery code. */
const hasCode = ref(true)

/** Read the devices signed in, whether there is a recovery code, and what the account keeps. */
async function look() {
  sync.refreshUsage()
  // The projects' names, for those kept on this device only.
  storiesStore.loadNames().catch(() => {})
  sync
    .profile()
    .then(asked => {
      profile.value = asked
      display.value = asked.display ?? ''
    })
    // A server from before sharing has none.
    .catch(() => (profile.value = null))
  try {
    const [listed, recovery] = await Promise.all([sync.devices(), sync.hasRecovery()])
    // This one first, then the rest as they were last seen.
    deviceList.value = [...listed].sort((a, b) => Number(b.current) - Number(a.current))
    hasCode.value = recovery
  } catch (error) {
    // A server from before devices had names lists none; sync goes on.
    deviceList.value = []
    console.error('The devices could not be listed:', error)
  }
}

watch(
  account,
  signedIn => {
    if (signedIn) look()
    else {
      deviceList.value = []
      profile.value = null
    }
  },
  { immediate: true }
)

/** @param {Device} device */
async function signOutOther(device) {
  try {
    await sync.signOutDevice(device.id)
    deviceList.value = deviceList.value.filter(other => other.id !== device.id)
  } catch (error) {
    toast.error(/** @type {Error} */ (error).message)
  }
}

/** What is being asked for: the passphrase, for a new recovery code or a new passphrase. @type {import('vue').Ref<'recovery'|'passphrase'|null>} */
const asking = ref(null)
const current = ref('')
const next = ref('')
/** @type {import('vue').Ref<string|null>} */
const askFailure = ref(null)

/** @param {'recovery'|'passphrase'} what */
function ask(what) {
  asking.value = what
  current.value = ''
  next.value = ''
  askFailure.value = null
}

async function finish() {
  if (!asking.value || !current.value || working.value) return
  if (asking.value === 'passphrase' && !next.value) return
  working.value = true
  askFailure.value = null
  try {
    if (asking.value === 'recovery') {
      shownCode.value = await sync.remakeRecovery(current.value)
      hasCode.value = true
    } else {
      await sync.changePassphrase(current.value, next.value)
      toast.success('Changed the passphrase')
    }
    asking.value = null
    current.value = ''
    next.value = ''
  } catch (error) {
    askFailure.value = /** @type {Error} */ (error).message
  } finally {
    working.value = false
  }
}
</script>
