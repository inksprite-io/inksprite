<template>
  <Dialog
    :visible="document !== null"
    modal
    :header="`Versions of “${title}”`"
    :style="{ width: '56rem', maxWidth: '95vw' }"
    data-versions-dialog
    @update:visible="shown => !shown && panel.close()"
  >
    <DrawnApart>
      <div class="grid grid-cols-1 sm:grid-cols-[14rem_1fr] gap-3 h-[60vh] min-h-0">
        <!-- The versions, newest first, by day. -->
        <div
          class="min-h-0 overflow-y-auto sm:border-r border-surface-200 dark:border-surface-700 sm:pr-2 max-h-48 sm:max-h-none"
          data-versions-list
        >
          <p
            v-if="loaded && versions.length === 0"
            class="px-2 py-1 text-sm text-surface-500"
            data-no-versions
          >
            No versions yet.
          </p>
          <section v-for="day in days" :key="day.label" class="mb-2">
            <h3 class="px-2 py-1 text-xs font-medium text-surface-500 dark:text-surface-400">
              {{ day.label }}
            </h3>
            <button
              v-for="version in day.versions"
              :key="version.id"
              type="button"
              class="w-full text-left rounded px-2 py-1.5 text-sm flex flex-col focus-visible:outline-2 focus-visible:outline-primary-500"
              :class="
                version.id === selectedId
                  ? 'bg-primary-50 dark:bg-primary-950 text-surface-900 dark:text-surface-0'
                  : 'text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800'
              "
              :aria-pressed="version.id === selectedId"
              :data-version="version.id"
              @click="selectedId = version.id"
            >
              <span class="truncate" :class="{ 'font-medium': version.name }">
                {{ version.name || timeOf(version.at) }}
              </span>
              <span class="text-xs text-surface-500 dark:text-surface-400 truncate">
                {{ detailOf(version) }}
              </span>
            </button>
          </section>
        </div>

        <!-- The version picked, against the text now. -->
        <div class="min-h-0 flex flex-col gap-2">
          <template v-if="selected">
            <div class="flex items-center gap-1 min-h-8">
              <InputText
                v-if="naming"
                v-model="nameDraft"
                size="small"
                class="flex-1"
                placeholder="Name this version"
                aria-label="Name this version"
                data-field="version-name"
                @keydown.enter.prevent="saveName"
                @keydown.escape.stop.prevent="naming = false"
                @blur="saveName"
              />
              <span v-else class="flex-1 text-sm text-surface-600 dark:text-surface-300 truncate">
                {{ selected.name || whenOf(selected.at) }}
              </span>
              <HeaderButton
                icon="pi pi-pencil"
                label="Name"
                data-action="name-version"
                @click="startNaming"
              />
              <HeaderButton
                icon="pi pi-trash"
                label="Delete version"
                data-action="delete-version"
                @click="removeSelected"
              />
            </div>
            <VersionText
              v-if="compared"
              class="flex-1 min-h-0 rounded border border-surface-200 dark:border-surface-700"
              :doc="compared"
              :story-id="storyId"
              :document-id="document.id"
            />
            <!-- A plain document's text, or a change that can't be laid
                 out, as it is written. -->
            <div
              v-else
              class="flex-1 min-h-0 overflow-y-auto rounded border border-surface-200 dark:border-surface-700 p-3 text-sm leading-relaxed whitespace-pre-wrap break-words text-surface-800 dark:text-surface-100"
              data-version-text
              data-version-written
            >
              <template v-for="(piece, i) in pieces" :key="i">
                <ins
                  v-if="piece.in === 'second'"
                  class="no-underline rounded-sm bg-green-100 dark:bg-green-900/60"
                  data-comes-back
                  >{{ piece.text }}</ins
                ><del
                  v-else-if="piece.in === 'first'"
                  class="rounded-sm text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/60"
                  data-goes
                  >{{ piece.text }}</del
                ><template v-else>{{ piece.text }}</template>
              </template>
            </div>
            <p v-if="same" class="text-xs text-surface-500 dark:text-surface-400" data-version-same>
              The same as the text now.
            </p>
          </template>
        </div>
      </div>
    </DrawnApart>

    <template #footer>
      <DrawnApart>
        <div class="w-full flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <template v-if="keeping">
              <InputText
                v-model="keepDraft"
                size="small"
                placeholder="Name"
                aria-label="Name for the version"
                data-field="keep-name"
                autofocus
                @keydown.enter.prevent="keepNow"
                @keydown.escape.stop.prevent="keeping = false"
              />
              <Button
                label="Keep"
                size="small"
                :disabled="!keepDraft.trim()"
                data-action="keep-now"
                @click="keepNow"
              />
            </template>
            <Button
              v-else
              label="Keep a version…"
              size="small"
              text
              data-action="keep-version"
              @click="startKeeping"
            />
          </div>
          <Button
            label="Restore"
            size="small"
            :disabled="!selected || same"
            data-action="restore-version"
            @click="restoreSelected"
          />
        </div>
      </DrawnApart>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, defineComponent, ref, shallowRef, watch } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import HeaderButton from '../layout/HeaderButton.vue'
import VersionText from './VersionText.vue'
import { useVersions, useVersionsPanel } from '@/composables/useVersions.js'
import { useDocumentsStore } from '@/stores/documentsStore'
import { useToast } from '@/composables/useToast'
import { TAKEN_BEFORE } from '@/utils/versions.js'
import { textChanges } from '@/utils/wordDiff.js'
import { withThreadsOnly } from '@/editor/comments.js'
import { compareTexts } from '@/editor/comparison.js'
import { parseMarkdown } from '@/editor/markdown.js'

/**
 * A text document's versions: on the left, newest first and by day, each with
 * its time and its name or what it was taken before; on the right, the one
 * picked, shown as the editor shows text, with what a restore would bring
 * back marked, and what it would take out struck through (`VersionText`). A
 * plain document's are shown as they are written, compared word by word.
 * Restore keeps the text now as a version first. A version can be named,
 * which keeps it from ageing out, or deleted, and the text now kept under a
 * name.
 *
 * @typedef {import('@/types/models.js').Version} Version
 *
 * @typedef {Object} Props
 * @property {string} storyId - The project open
 */
const props = defineProps({
  storyId: { type: String, required: true },
})

/**
 * The dialog's body and its footer, each drawn by a component of its own, so
 * that picking a version draws them again and not the dialog around them.
 * Each time the dialog is drawn, PrimeVue's directives on its buttons write
 * their styles out again, and WebKit then works out the style of the whole
 * page again, a long version and the editor behind it included.
 */
const DrawnApart = defineComponent({
  name: 'DrawnApart',
  setup(_props, { slots }) {
    return () => slots.default?.()
  },
})

const panel = useVersionsPanel()
const versionsApi = useVersions(props.storyId)
const documentsStore = useDocumentsStore()
const toast = useToast()

/** The document showing, while it is one of this project's texts. */
const document = computed(() => {
  const id = panel.showing.value
  const found = id ? documentsStore.getDocument(id) : null
  return found?.type === 'text' && found.storyId === props.storyId ? found : null
})
const title = computed(() => document.value?.title?.trim() || 'Untitled')

/** @type {import('vue').Ref<Version[]>} */
const versions = ref([])
const loaded = ref(false)
/** @type {import('vue').Ref<string|null>} */
const selectedId = ref(null)
/** The document's text as it was when the list was read. */
const now = ref('')
/**
 * Its threads then: a comment whose thread is gone is its passage alone, as
 * the editor and a restore read it.
 * @type {import('vue').Ref<import('@/types/models.js').Document['comments']>}
 */
const threads = shallowRef(undefined)

const selected = computed(() => versions.value.find(v => v.id === selectedId.value) ?? null)

/** @param {string} markdown */
const read = markdown => parseMarkdown(withThreadsOnly(markdown, threads.value))

/** Whether the document is a plain one, whose text is shown as it is written. */
const plain = computed(() => !!document.value?.plain)

/** The text now as the editor has it, read once for every version compared with it. */
const nowDoc = computed(() => (plain.value ? null : read(now.value)))

/** The version picked, as the editor would hold it. */
const versionDoc = computed(() =>
  selected.value && nowDoc.value ? read(selected.value.content) : null
)

/** The version picked against the text now, as one document to show. */
const compared = computed(() =>
  versionDoc.value ? compareTexts(versionDoc.value, nowDoc.value) : null
)

/**
 * Whether the version is the text now: written the same, or read the same,
 * comments and suggestions and all, where only how it is written differs.
 */
const same = computed(
  () =>
    selected.value?.content === now.value ||
    (!!versionDoc.value && versionDoc.value.eq(nowDoc.value))
)

/** The same, as the texts are written, where it isn't shown as the editor would. */
const pieces = computed(() =>
  selected.value && !compared.value ? textChanges(now.value, selected.value.content) : []
)

/** Read the list again, keeping the one picked where it still is. */
const load = async () => {
  const id = document.value?.id
  if (!id) return
  now.value = versionsApi.current(id)
  threads.value = document.value?.comments
  versions.value = await versionsApi.list(id)
  loaded.value = true
  const asked = panel.picking.value
  panel.picking.value = null
  if (asked && versions.value.some(v => v.id === asked)) selectedId.value = asked
  else if (!versions.value.some(v => v.id === selectedId.value)) {
    selectedId.value = versions.value[0]?.id ?? null
  }
}

/**
 * @param {number} at
 * @returns {string}
 */
const timeOf = at => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

/**
 * @param {number} at
 * @returns {string}
 */
const dayOf = at => {
  const day = new Date(at)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  if (day.toDateString() === today.toDateString()) return 'Today'
  if (day.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return day.toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(day.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  })
}

/**
 * @param {number} at
 * @returns {string}
 */
const whenOf = at => `${dayOf(at)}, ${timeOf(at)}`

/** The versions by the day each was taken. */
const days = computed(() => {
  /** @type {Array<{label: string, versions: Version[]}>} */
  const out = []
  for (const version of versions.value) {
    const label = dayOf(version.at)
    const last = out[out.length - 1]
    if (last?.label === label) last.versions.push(version)
    else out.push({ label, versions: [version] })
  }
  return out
})

/**
 * When a named version was taken, what a version was taken before, and how
 * long it was.
 * @param {Version} version
 * @returns {string}
 */
const detailOf = version =>
  [
    version.name ? timeOf(version.at) : '',
    version.by ? TAKEN_BEFORE[version.by] : '',
    `${version.words.toLocaleString()} ${version.words === 1 ? 'word' : 'words'}`,
  ]
    .filter(Boolean)
    .join(' · ')

const naming = ref(false)
const nameDraft = ref('')

const startNaming = () => {
  nameDraft.value = selected.value?.name ?? ''
  naming.value = true
}

const saveName = () => {
  if (!naming.value || !selected.value) return
  naming.value = false
  const renamed = versionsApi.rename(selected.value, nameDraft.value)
  versions.value = versions.value.map(v => (v.id === renamed.id ? renamed : v))
}

const removeSelected = () => {
  const version = selected.value
  if (!version) return
  versionsApi.remove(version)
  const at = versions.value.indexOf(version)
  versions.value = versions.value.filter(v => v.id !== version.id)
  selectedId.value = versions.value[Math.min(at, versions.value.length - 1)]?.id ?? null
}

const keeping = ref(false)
const keepDraft = ref('')

const startKeeping = () => {
  keepDraft.value = ''
  keeping.value = true
}

const keepNow = async () => {
  const id = document.value?.id
  if (!id || !keepDraft.value.trim()) return
  keeping.value = false
  const kept = await versionsApi.keepNamed(id, keepDraft.value)
  await load()
  if (kept) selectedId.value = kept.id
}

const restoreSelected = () => {
  const version = selected.value
  if (!version) return
  try {
    versionsApi.restore(version)
    panel.close()
  } catch (error) {
    console.error('Failed to restore the version:', error)
    toast.error(error.message)
  }
}

// A document opened for its versions starts on its newest.
watch(
  () => document.value?.id,
  id => {
    versions.value = []
    loaded.value = false
    selectedId.value = null
    naming.value = false
    keeping.value = false
    if (id) load()
  },
  { immediate: true }
)
</script>
