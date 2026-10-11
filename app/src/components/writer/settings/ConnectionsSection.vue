<template>
  <div class="flex flex-col gap-4 px-2 pt-2 pb-1" data-connections-section>
    <WebSearchConnection />

    <h3
      class="pt-2 text-sm font-semibold text-surface-800 dark:text-surface-100"
      data-heading="mcp"
    >
      MCP servers
    </h3>
    <p class="-mt-2 text-sm text-surface-600 dark:text-surface-300">
      Servers must accept connections from web pages.
    </p>

    <!-- Adding: an address, or a pasted block of servers, then a look at what
         each offers — which is what the model will be told — before keeping it. -->
    <section
      v-if="adding"
      class="flex flex-col gap-3 rounded-lg border border-surface-200 dark:border-surface-700 p-3"
      data-adding
    >
      <div class="flex gap-2">
        <Button
          label="By address"
          size="small"
          :severity="mode === 'url' ? undefined : 'secondary'"
          :outlined="mode !== 'url'"
          data-mode="url"
          @click="mode = 'url'"
        />
        <Button
          label="Paste a config"
          size="small"
          :severity="mode === 'json' ? undefined : 'secondary'"
          :outlined="mode !== 'json'"
          data-mode="json"
          @click="mode = 'json'"
        />
      </div>

      <template v-if="mode === 'url'">
        <label class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300">
          Address
          <InputText
            ref="addressField"
            v-model="draft.url"
            size="small"
            placeholder="https://example.com/mcp"
            :invalid="Boolean(addressProblem)"
            aria-label="Address"
            :aria-describedby="addressProblem ? 'mcp-address-problem' : undefined"
            data-field="url"
            @update:model-value="addressProblem = ''"
          />
          <!-- Inside the label, so it is named "Address" outright: otherwise
               what is wrong with it would be read as part of its name. -->
          <span
            v-if="addressProblem"
            id="mcp-address-problem"
            class="text-red-600 dark:text-red-400"
            data-address-problem
          >
            {{ addressProblem }}
          </span>
        </label>
        <label class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300">
          Name
          <InputText
            v-model="draft.name"
            size="small"
            :placeholder="draft.url ? nameFromUrl(draft.url) : 'What to call it'"
            data-field="name"
          />
        </label>
        <div class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300">
          Header (optional)
          <div class="flex gap-2">
            <InputText
              v-model="draft.headerName"
              size="small"
              class="w-2/5"
              placeholder="Authorization"
              aria-label="Header name"
              data-field="header-name"
            />
            <InputText
              v-model="draft.headerValue"
              size="small"
              class="flex-1"
              type="password"
              placeholder="Bearer …"
              aria-label="Header value"
              data-field="header-value"
            />
          </div>
        </div>
      </template>

      <label v-else class="flex flex-col gap-1 text-xs text-surface-600 dark:text-surface-300">
        The <span class="font-mono">mcpServers</span> block from another app's settings
        <Textarea
          v-model="draft.json"
          rows="6"
          class="font-mono text-xs"
          placeholder='{ "mcpServers": { "deepwiki": { "url": "https://mcp.deepwiki.com/mcp" } } }'
          data-field="json"
        />
      </label>

      <p v-for="problem in problems" :key="problem" class="text-xs text-red-600 dark:text-red-400">
        {{ problem }}
      </p>

      <div class="flex gap-2">
        <Button
          label="Connect"
          size="small"
          :loading="connecting"
          :disabled="!canConnect"
          data-action="connect"
          @click="connect"
        />
        <Button
          label="Cancel"
          size="small"
          text
          severity="secondary"
          data-action="cancel"
          @click="closeAdding"
        />
      </div>

      <!-- What each server offered, read before it is kept. -->
      <div
        v-for="candidate in candidates"
        :key="candidate.key"
        class="flex flex-col gap-1 rounded-lg bg-surface-50 dark:bg-surface-900/40 px-3 py-2"
        data-candidate
      >
        <span class="text-sm font-medium">{{ candidate.server.name }}</span>
        <span class="text-xs text-surface-500 font-mono truncate">
          {{ candidate.server.url || candidate.server.command }}
        </span>
        <template v-if="candidate.error">
          <span v-if="!candidate.signIn" class="text-xs text-red-600 dark:text-red-400">
            {{ candidate.error }}
          </span>
          <span v-else class="flex flex-wrap items-center gap-2 text-xs text-surface-600">
            Sign in to see what it offers.
            <Button
              label="Sign in"
              size="small"
              :loading="signingIn === candidate.key"
              data-action="sign-in"
              @click="signInCandidate(candidate)"
            />
            <!-- A tab closed before it finished says nothing; this frees the button. -->
            <Button
              v-if="signingIn === candidate.key"
              label="Cancel"
              size="small"
              text
              severity="secondary"
              data-action="cancel-sign-in"
              @click="signingIn = null"
            />
          </span>
        </template>
        <span
          v-else-if="!candidate.server.url"
          class="text-xs italic text-surface-500 dark:text-surface-400"
        >
          Runs as a program, so it needs an HTTP bridge.
        </span>
        <template v-else-if="candidate.preview">
          <span class="text-xs text-surface-500 dark:text-surface-400">
            {{ offers(candidate.preview) }}:
          </span>
          <ul class="flex flex-col gap-1 pl-3">
            <li
              v-for="tool in candidate.preview.tools"
              :key="tool.name"
              class="text-xs text-surface-600 dark:text-surface-300"
            >
              <span class="font-mono">{{ tool.name }}</span>
              <span v-if="tool.annotations?.readOnlyHint" class="text-surface-400">
                · reads only</span
              >
              <span v-if="tool.description"> — {{ tool.description }}</span>
            </li>
          </ul>
        </template>
      </div>

      <template v-if="candidates.length > 0">
        <div class="flex flex-col gap-1">
          <span class="text-xs text-surface-600 dark:text-surface-300"> Used in chats on </span>
          <div class="flex flex-wrap gap-x-4 gap-y-1">
            <label
              v-for="profile in profiles"
              :key="profile.id"
              class="flex items-center gap-2 text-xs"
            >
              <ToggleSwitch
                :model-value="draft.profiles.includes(profile.id)"
                :aria-label="`Use in chats on ${profile.name}`"
                @update:model-value="toggleDraftProfile(profile.id, $event)"
              />
              {{ profile.name }}
            </label>
          </div>
        </div>
        <div class="flex gap-2">
          <Button
            :label="keepable.length === 1 ? 'Keep it' : `Keep ${keepable.length}`"
            size="small"
            :disabled="keepable.length === 0"
            data-action="keep"
            @click="keep"
          />
        </div>
      </template>
    </section>

    <div v-else class="flex flex-wrap gap-2">
      <Button
        label="Add a server"
        icon="pi pi-plus"
        size="small"
        data-action="add-server"
        @click="openAdding"
      />
    </div>

    <section class="flex flex-col gap-2" data-list="servers">
      <p v-if="servers.length === 0" class="text-sm text-surface-500 dark:text-surface-400">
        None yet.
      </p>
      <div
        v-for="server in servers"
        :key="server.id"
        class="flex flex-col gap-2 rounded-lg px-3 py-2 border border-surface-200 dark:border-surface-700"
        :data-server="server.id"
      >
        <button
          type="button"
          class="flex flex-col gap-0.5 text-left"
          :aria-expanded="open === server.id"
          @click="toggleOpen(server)"
        >
          <span class="flex items-center gap-2 min-w-0">
            <span class="text-sm font-medium truncate">{{ server.name }}</span>
            <span class="text-xs text-surface-500">{{ summaryOf(server) }}</span>
          </span>
          <span class="text-xs text-surface-500 font-mono truncate">
            {{ server.url || server.command }}
          </span>
          <span v-if="!server.url" class="text-xs italic text-surface-500 dark:text-surface-400">
            Runs as a program, so it needs an HTTP bridge.
          </span>
          <span
            v-else-if="missingHeaders(server).length"
            class="text-xs text-red-600 dark:text-red-400"
            data-key-missing
          >
            Its key was left out of a backup.
          </span>
          <span v-else-if="server.error" class="text-xs text-red-600 dark:text-red-400">
            {{ server.error }}
          </span>
          <span
            v-if="server.url && isSignedIn(server.url)"
            class="text-xs text-surface-500"
            data-signed-in
            >Signed in</span
          >
        </button>
        <div v-if="needsSignIn(server)" class="flex gap-2">
          <Button
            label="Sign in"
            size="small"
            :loading="signingIn === server.id"
            data-action="sign-in"
            @click="signInServer(server)"
          />
          <Button
            v-if="signingIn === server.id"
            label="Cancel"
            size="small"
            text
            severity="secondary"
            data-action="cancel-sign-in"
            @click="signingIn = null"
          />
        </div>

        <div v-if="open === server.id" class="flex flex-col gap-3 pt-1">
          <div
            v-if="server.url && headerDrafts[server.id]"
            class="flex flex-col gap-1"
            data-headers
          >
            <span class="text-xs font-medium text-surface-700 dark:text-surface-200">
              {{ headerDrafts[server.id].length > 1 ? 'Headers' : 'Header' }}
            </span>
            <div v-for="(row, index) in headerDrafts[server.id]" :key="index" class="flex gap-2">
              <InputText
                v-model="row.name"
                size="small"
                class="w-2/5"
                placeholder="Authorization"
                aria-label="Header name"
                data-field="server-header-name"
              />
              <InputText
                v-model="row.value"
                size="small"
                class="flex-1"
                type="password"
                placeholder="Bearer …"
                aria-label="Header value"
                data-field="server-header-value"
              />
            </div>
            <div v-if="headersChanged(server)">
              <Button
                label="Save"
                size="small"
                :loading="refreshing === server.id"
                data-action="save-headers"
                @click="saveHeaders(server)"
              />
            </div>
          </div>

          <div v-if="server.url" class="flex flex-col gap-1">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-medium text-surface-700 dark:text-surface-200">Tools</span>
              <label
                v-if="server.tools.length > 0"
                class="flex items-center gap-2 text-xs text-surface-500"
              >
                Always allow all of them
                <ToggleSwitch
                  :model-value="Boolean(server.allowAll)"
                  :aria-label="`Always allow all of ${server.name}'s tools`"
                  data-allow-all
                  @update:model-value="updateServer(server.id, { allowAll: $event })"
                />
              </label>
            </div>
            <p v-if="server.tools.length === 0" class="text-xs text-surface-500">It offers none.</p>
            <div
              v-for="tool in server.tools"
              :key="tool.name"
              class="flex items-start justify-between gap-2"
            >
              <span class="text-xs text-surface-600 dark:text-surface-300 min-w-0">
                <span class="font-mono">{{ tool.title || tool.name }}</span>
                <span v-if="tool.description" class="text-surface-500">
                  — {{ tool.description }}</span
                >
              </span>
              <span v-if="tool.annotations?.readOnlyHint" class="text-xs text-surface-400 flex-none"
                >Reads only</span
              >
              <span v-else-if="server.allowAll" class="text-xs text-surface-400 flex-none"
                >Allowed</span
              >
              <label v-else class="flex items-center gap-2 text-xs text-surface-500 flex-none">
                Always allow
                <ToggleSwitch
                  :model-value="(server.allowed || []).includes(tool.name)"
                  :aria-label="`Always allow ${tool.name}`"
                  @update:model-value="setAllowed(server, tool.name, $event)"
                />
              </label>
            </div>
          </div>

          <div v-if="server.url && server.prompts?.length" class="flex flex-col gap-1">
            <span class="text-xs font-medium text-surface-700 dark:text-surface-200">Prompts</span>
            <div
              v-for="prompt in server.prompts"
              :key="prompt.name"
              class="text-xs text-surface-600 dark:text-surface-300"
              data-prompt
            >
              <span class="font-mono">{{ commandFor(server, prompt) || prompt.name }}</span>
              <span v-if="prompt.description" class="text-surface-500">
                — {{ prompt.description }}</span
              >
              <span v-if="!commandFor(server, prompt)" class="italic text-surface-500">
                · needs {{ requiredArguments(prompt) }} arguments, so it isn’t in the
                <span class="font-mono">/</span> menu</span
              >
            </div>
          </div>

          <div v-if="server.url" class="flex flex-col gap-1">
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
                  :model-value="(server.profiles || []).includes(profile.id)"
                  :aria-label="`Use ${server.name} in chats on ${profile.name}`"
                  @update:model-value="setProfile(server, profile.id, $event)"
                />
                {{ profile.name }}
              </label>
            </div>
          </div>

          <div class="flex gap-2">
            <Button
              v-if="server.url"
              label="List its tools again"
              size="small"
              severity="secondary"
              outlined
              :loading="refreshing === server.id"
              data-action="refresh"
              @click="refresh(server.id)"
            />
            <Button
              v-if="server.url && isSignedIn(server.url)"
              label="Sign out"
              size="small"
              severity="secondary"
              text
              data-action="sign-out"
              @click="signOut(server.url)"
            />
            <Button
              label="Remove"
              size="small"
              severity="danger"
              text
              data-action="remove"
              @click="removeServer(server.id)"
            />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, nextTick, reactive, ref } from 'vue'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Textarea from 'primevue/textarea'
import ToggleSwitch from 'primevue/toggleswitch'
import WebSearchConnection from './WebSearchConnection.vue'
import { useMcpServers } from '@/composables/useMcpServers.js'
import { useProfiles } from '@/composables/useProfiles'
import { isWebAddress, nameFromUrl, parseServerConfig } from '@/mcp/config.js'
import { SIGN_IN_NEEDED } from '@/mcp/client.js'
import { missingHeaders, promptCommand, requiredArguments } from '@/mcp/servers.js'
import { CHAT_PROFILE_ID } from '@/ai/profiles/index.js'

/** @typedef {import('@/types/models.js').McpServer} McpServer */
/** @typedef {import('@/mcp/config.js').ConfiguredServer} ConfiguredServer */
/** @typedef {import('@/composables/useMcpServers.js').ServerPreview} ServerPreview */

/**
 * Settings → Connections: web search, then the writer's MCP servers, app-wide.
 */

const {
  servers,
  preview,
  addServer,
  refreshServer,
  updateServer,
  removeServer,
  isSignedIn,
  signIn,
  signOut,
} = useMcpServers()
const { profiles } = useProfiles()

const adding = ref(false)
/** @type {import('vue').Ref<'url'|'json'>} */
const mode = ref('url')
const connecting = ref(false)
/** @type {import('vue').Ref<string|null>} */
const open = ref(null)
/** @type {import('vue').Ref<string|null>} */
const refreshing = ref(null)
/** @type {import('vue').Ref<string[]>} */
const problems = ref([])
/** What is wrong with the address typed, said under it. */
const addressProblem = ref('')
/** @type {import('vue').Ref<any>} */
const addressField = ref(null)

/** Open the form for a new server, ready to take its address. */
async function openAdding() {
  adding.value = true
  await nextTick()
  addressField.value?.$el?.focus?.()
}

const draft = reactive({
  url: '',
  name: '',
  headerName: '',
  headerValue: '',
  json: '',
  /** @type {string[]} */
  profiles: [CHAT_PROFILE_ID],
})

/**
 * @typedef {Object} Candidate
 * @property {string} key
 * @property {ConfiguredServer} server
 * @property {ServerPreview} [preview]
 * @property {string} [error]
 * @property {boolean} [signIn] - The error is the server wanting the writer to sign in
 */

/** @type {import('vue').Ref<Candidate[]>} */
const candidates = ref([])

const canConnect = computed(() =>
  mode.value === 'url' ? Boolean(draft.url.trim()) : Boolean(draft.json.trim())
)

/** The ones that can be kept: listed, or waiting on a bridge. */
const keepable = computed(() =>
  candidates.value.filter(
    candidate => !candidate.error && (candidate.preview || !candidate.server.url)
  )
)

/**
 * @param {number} count
 * @param {string} noun
 */
const countOf = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`

/**
 * What a server offers, counted: "3 tools · 1 prompt".
 *
 * @param {ServerPreview} listed
 */
const offers = listed =>
  [
    countOf(listed.tools.length, 'tool'),
    ...(listed.prompts.length ? [countOf(listed.prompts.length, 'prompt')] : []),
  ].join(' · ')

/** @param {McpServer} server */
const summaryOf = server =>
  server.url
    ? [
        countOf((server.tools || []).length, 'tool'),
        ...(server.prompts?.length ? [countOf(server.prompts.length, 'prompt')] : []),
      ].join(' · ')
    : 'needs a bridge'

/**
 * The command a server's prompt is typed as, or nothing for one that is not
 * offered yet.
 *
 * @param {McpServer} server
 * @param {import('@/types/models.js').McpPrompt} prompt
 */
const commandFor = (server, prompt) => {
  const made = promptCommand(server, prompt)
  return made ? `/${made.name}${made.argument ? ` <${made.argument.name}>` : ''}` : ''
}

/** What was typed or pasted, as the servers it names. */
function configured() {
  if (mode.value === 'json') return parseServerConfig(draft.json)
  const url = draft.url.trim()
  const headerName = draft.headerName.trim()
  return {
    servers: [
      {
        name: draft.name.trim() || nameFromUrl(url),
        url,
        ...(headerName && draft.headerValue
          ? { headers: { [headerName]: draft.headerValue } }
          : {}),
      },
    ],
    errors: [],
  }
}

/** Connect to each server named and list what it offers. */
async function connect() {
  if (mode.value === 'url' && !isWebAddress(draft.url)) {
    addressProblem.value = 'That isn’t a web address.'
    candidates.value = []
    return
  }
  const { servers: named, errors } = configured()
  problems.value = errors
  connecting.value = true
  try {
    candidates.value = await Promise.all(
      named.map(async (server, index) => {
        const key = `${index}:${server.name}`
        if (!server.url) return { key, server }
        return { key, server, ...(await previewed(server)) }
      })
    )
  } finally {
    connecting.value = false
  }
}

/**
 * What a server offers, or why it would not say, as a candidate holds it.
 *
 * @param {ConfiguredServer} server
 * @returns {Promise<Partial<Candidate>>}
 */
async function previewed(server) {
  const listed = await preview(server)
  if ('preview' in listed) return { preview: listed.preview }
  return { error: listed.error, ...(listed.signIn ? { signIn: true } : {}) }
}

/** @type {import('vue').Ref<string|null>} */
const signingIn = ref(null)

/**
 * Whether a kept server wants the writer to sign in: one that was kept signed
 * in and is not now, or one that last said it wants signing in. Not one
 * missing its key, which refuses for want of that and not of a sign-in.
 *
 * @param {McpServer} server
 */
const needsSignIn = server =>
  Boolean(server.url) &&
  !isSignedIn(/** @type {string} */ (server.url)) &&
  missingHeaders(server).length === 0 &&
  (server.auth === 'oauth' || server.error === SIGN_IN_NEEDED)

/**
 * Sign in to a server being added, and list it again once signed in. Called
 * straight from the click, which is what lets it open a tab.
 *
 * @param {Candidate} candidate
 */
async function signInCandidate(candidate) {
  signingIn.value = candidate.key
  try {
    const outcome = await signIn(/** @type {string} */ (candidate.server.url))
    const fresh =
      'error' in outcome
        ? { error: outcome.error, signIn: true }
        : await previewed(candidate.server)
    candidates.value = candidates.value.map(one =>
      one.key === candidate.key ? { key: one.key, server: one.server, ...fresh } : one
    )
  } finally {
    if (signingIn.value === candidate.key) signingIn.value = null
  }
}

/**
 * Sign in to a server that has been kept, and list its tools again.
 *
 * @param {McpServer} server
 */
async function signInServer(server) {
  signingIn.value = server.id
  try {
    const outcome = await signIn(/** @type {string} */ (server.url))
    if ('signedIn' in outcome) {
      updateServer(server.id, { auth: 'oauth' })
      await refreshServer(server.id)
    }
  } finally {
    if (signingIn.value === server.id) signingIn.value = null
  }
}

/** Keep every server that listed, or that waits on a bridge. */
function keep() {
  for (const candidate of keepable.value) {
    addServer(candidate.server, candidate.preview, [...draft.profiles])
  }
  closeAdding()
}

function closeAdding() {
  adding.value = false
  candidates.value = []
  problems.value = []
  addressProblem.value = ''
  Object.assign(draft, {
    url: '',
    name: '',
    headerName: '',
    headerValue: '',
    json: '',
    profiles: [CHAT_PROFILE_ID],
  })
}

/**
 * @param {string} profileId
 * @param {boolean} on
 */
function toggleDraftProfile(profileId, on) {
  draft.profiles = on
    ? [...new Set([...draft.profiles, profileId])]
    : draft.profiles.filter(id => id !== profileId)
}

/**
 * @param {McpServer} server
 * @param {string} profileId
 * @param {boolean} on
 */
function setProfile(server, profileId, on) {
  const current = server.profiles || []
  updateServer(server.id, {
    profiles: on ? [...new Set([...current, profileId])] : current.filter(id => id !== profileId),
  })
}

/**
 * @param {McpServer} server
 * @param {string} tool - The server's name for it
 * @param {boolean} on
 */
function setAllowed(server, tool, on) {
  const current = server.allowed || []
  updateServer(server.id, {
    allowed: on ? [...new Set([...current, tool])] : current.filter(name => name !== tool),
  })
}

/**
 * A kept server's headers as they are being edited, by server id: made from
 * what it has each time its row opens.
 *
 * @type {Record<string, {name: string, value: string}[]>}
 */
const headerDrafts = reactive({})

/**
 * Open a server's row, or close it.
 *
 * @param {McpServer} server
 */
function toggleOpen(server) {
  if (open.value === server.id) {
    open.value = null
    return
  }
  const rows = Object.entries(server.headers || {}).map(([name, value]) => ({ name, value }))
  headerDrafts[server.id] = rows.length ? rows : [{ name: '', value: '' }]
  open.value = server.id
}

/**
 * The headers a server's draft makes: those with a name.
 *
 * @param {string} id
 * @returns {Record<string, string>}
 */
function draftedHeaders(id) {
  return Object.fromEntries(
    (headerDrafts[id] || []).map(row => [row.name.trim(), row.value]).filter(([name]) => name)
  )
}

/** @param {McpServer} server */
const headersChanged = server =>
  JSON.stringify(draftedHeaders(server.id)) !== JSON.stringify(server.headers || {})

/**
 * Keep a server's edited headers, and list it again with them.
 *
 * @param {McpServer} server
 */
async function saveHeaders(server) {
  const headers = draftedHeaders(server.id)
  updateServer(server.id, { headers: Object.keys(headers).length ? headers : undefined })
  await refresh(server.id)
}

/** @param {string} id */
async function refresh(id) {
  refreshing.value = id
  try {
    await refreshServer(id)
  } finally {
    refreshing.value = null
  }
}
</script>
