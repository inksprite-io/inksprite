<template>
  <!-- Escape is handled here rather than by the dialog, so that a dialog
       opened over the library — the import's question, a confirmation — is
       the only one Escape closes. -->
  <Dialog
    ref="dialog"
    :visible="visible"
    :header="into ? 'Choose a Character Card' : 'Character Cards'"
    modal
    :closable="true"
    :close-on-escape="false"
    :draggable="false"
    :dismissable-mask="true"
    class="w-[min(72rem,95vw)] h-[min(48rem,90vh)]"
    :pt="{ content: { class: 'flex-1 min-h-0 !p-0 overflow-hidden flex flex-col' } }"
    data-card-library-dialog
    @update:visible="!$event && close()"
  >
    <CardLibrary
      class="flex-1"
      :actions-for="actionsFor"
      :places-of="placesOf"
      :busy="busy"
      @open-project="openProject"
    />
  </Dialog>

  <CardImportDialog v-model:visible="asking" :found="found" @confirm="write" />
  <CardChatDialog
    :visible="chatting"
    :card="chatCard"
    :last-user-name="lastUserName"
    @update:visible="!$event && skipChat()"
    @confirm="startChat"
  />
</template>

<script setup>
import { ref, watch } from 'vue'
import Dialog from 'primevue/dialog'
import { useToast } from 'primevue/usetoast'
import CardLibrary from './CardLibrary.vue'
import CardImportDialog from '../tree/CardImportDialog.vue'
import CardChatDialog from '../tree/CardChatDialog.vue'
import { useCardImport, NotACardError } from '@/composables/useCardImport'
import { useCardChat } from '@/composables/useCardChat'
import { useCardLibraryPanel } from '@/composables/useCardLibraryPanel.js'
import { useChatRequest } from '@/composables/useChatRequest.js'
import { useProjects } from '@/composables/useProjects'
import { useTopmostEscape } from '@/composables/useTopmostEscape.js'
import { useCardLibraryStore } from '@/stores/cardLibraryStore.js'

/**
 * The card library, over the writer rather than beside it: it is app-wide,
 * so it does not belong in a panel scoped to one project. Opened from the
 * rail to browse, or from a folder's Import › Character card… to pick a card
 * for that folder.
 *
 * What is done with a card is decided here, for its detail's button and its
 * menu alike:
 *
 * - **New project**, named for the card, with the card in it, and straight
 *   on to the questions a chat on it asks: the usual reason to open the
 *   library is to start playing a card.
 * - **Open** a project the card is in. Once a project has been made for it,
 *   opening that one leads.
 * - **Add to** the project open, as importing the card's file there does.
 * - **Import**, when picking for a folder, into that folder.
 *
 * Each is written as importing a file is, onto the project's shelf for
 * characters. The import's one question, whether to take the card's system
 * prompt, is asked only of a card that has one; the rest the writer has just
 * seen. The card remembers the projects it went into.
 *
 * @typedef {Object} Props
 * @property {string} [storyId] - The project open, which a card can be added to
 */
const props = defineProps({
  storyId: { type: String, default: '' },
})

/**
 * Something to do with a card, as a menu item.
 * @typedef {{id: string, label: string, icon: string, command: () => void}} CardAction
 */

const toast = useToast()
const library = useCardLibraryStore()
const projects = useProjects()
const chatRequest = useChatRequest()
const { visible, into, close } = useCardLibraryPanel()

/** @type {import('vue').Ref<{ mask?: HTMLElement }|null>} */
const dialog = ref(null)

useTopmostEscape(visible, () => dialog.value?.mask, close)

// The projects' names, for saying which a card is in.
watch(visible, open => open && projects.init(), { immediate: true })

/**
 * The projects a card is in that are still here, the latest first, each once.
 *
 * @param {import('@/types/models.js').LibraryCard} card
 * @returns {Array<import('@/types/models.js').CardUse & {name: string}>}
 */
const placesOf = card => {
  const here = new Set(projects.projects.value.map(story => story.id))
  /** @type {Map<string, import('@/types/models.js').CardUse>} */
  const latest = new Map()
  for (const use of card.projects || []) {
    if (!here.has(use.storyId)) continue
    const had = latest.get(use.storyId)
    latest.set(use.storyId, { ...use, made: Boolean(use.made || had?.made) })
  }
  return [...latest.values()]
    .sort((a, b) => b.at - a.at)
    .map(use => ({ ...use, name: projects.nameOf(use.storyId) }))
}

/**
 * What can be done with a card, the one it is usually opened for first.
 *
 * @param {import('@/types/models.js').LibraryCard} card
 * @returns {CardAction[]}
 */
const actionsFor = card => {
  if (into.value) {
    if (!props.storyId) return []
    return [{ id: 'import', label: 'Import', icon: 'pi pi-download', command: () => add(card.id) }]
  }
  const places = placesOf(card).filter(place => place.storyId !== props.storyId)
  const own = places.find(place => place.made)
  /** @param {{storyId: string, name: string}} place @returns {CardAction} */
  const opening = place => ({
    id: `open:${place.storyId}`,
    label: `Open ${place.name}`,
    icon: 'pi pi-folder-open',
    command: () => openProject(place.storyId),
  })
  const inOpen = (card.projects || []).some(use => use.storyId === props.storyId)
  return [
    ...(own ? [opening(own)] : []),
    { id: 'new', label: 'New project', icon: 'pi pi-plus', command: () => newProject(card.id) },
    ...(props.storyId && !inOpen
      ? [
          {
            id: 'add',
            label: `Add to ${projects.nameOf(props.storyId)}`,
            icon: 'pi pi-file-import',
            command: () => add(card.id),
          },
        ]
      : []),
    ...places.filter(place => place !== own).map(opening),
  ]
}

const busy = ref(false)
const asking = ref(false)
/** @type {import('vue').Ref<import('@/composables/useCardImport.js').Found|null>} */
const found = ref(null)

/**
 * The card being written, and where: into the project open (or the folder
 * picked for), or into a project made for it.
 * @type {{id: string, target: 'open'|'new'}|null}
 */
let pending = null

/**
 * Read a card out of the library to write it, asking first when there is
 * something to ask.
 *
 * @param {string} id
 * @param {'open'|'new'} target
 */
const begin = async (id, target) => {
  if (busy.value) return
  busy.value = true
  try {
    found.value = await useCardImport(props.storyId).fromLibrary(id)
    pending = { id, target }
    if (found.value.systemPrompt) asking.value = true
    else await write({ useSystemPrompt: false })
  } catch (error) {
    fail(error)
  } finally {
    busy.value = false
  }
}

/** @param {string} id */
const add = id => props.storyId && begin(id, 'open')

/** @param {string} id */
const newProject = id => begin(id, 'new')

/**
 * Write the card where it was asked for, with the import's answers.
 *
 * @param {{useSystemPrompt: boolean}} answers
 */
const write = async answers => {
  asking.value = false
  const card = found.value
  const job = pending
  found.value = null
  pending = null
  if (!card || !job) return

  try {
    if (job.target === 'new') return await writeNew(job.id, card, answers)
    if (!props.storyId) return
    const written = await useCardImport(props.storyId).write(card, {
      parentId: into.value || undefined,
      ...answers,
    })
    library.markUsed(job.id, { storyId: props.storyId, folderId: written.folderId })
    toast.add({
      severity: 'success',
      detail: `Imported ${written.title} (${written.documents} documents).`,
      life: 4000,
    })
    close()
  } catch (error) {
    fail(error)
  }
}

// The chat a new project starts with: its card, and the project it is in.
const chatting = ref(false)
/** @type {import('vue').Ref<import('@/cards/chat.js').CardChat|null>} */
const chatCard = ref(null)
const lastUserName = ref('')
let chatStoryId = ''

/**
 * A project made for a card, named for it, with the card in it; then the
 * questions a chat on it asks, and the project opened on that chat.
 *
 * @param {string} id
 * @param {import('@/composables/useCardImport.js').Found} card
 * @param {{useSystemPrompt: boolean}} answers
 */
const writeNew = async (id, card, answers) => {
  const title = library.getCard(id)?.title || card.title
  const story = await projects.create(title, { open: false })
  const written = await useCardImport(story.id).write(card, answers)
  library.markUsed(id, { storyId: story.id, folderId: written.folderId, made: true })
  close()

  const chats = useCardChat(story.id)
  chatStoryId = story.id
  chatCard.value = await chats.read(written.folderId)
  if (!chatCard.value) return projects.open(story.id)
  lastUserName.value = chats.lastUserName()
  chatting.value = true
}

/**
 * @param {{userName: string, greeting: number}} answers
 */
const startChat = async ({ userName, greeting }) => {
  const card = chatCard.value
  const storyId = chatStoryId
  chatting.value = false
  chatCard.value = null
  if (!card || !storyId) return
  try {
    const chat = await useCardChat(storyId).start(card, { userName, greeting })
    chatRequest.show(storyId, chat.id)
  } catch (error) {
    toast.add({
      severity: 'error',
      detail: `Could not start the chat: ${error.message}`,
      life: 6000,
    })
  }
  projects.open(storyId)
}

/** The chat's questions put away unanswered: the project opens with the card in it. */
const skipChat = () => {
  if (!chatting.value) return
  chatting.value = false
  chatCard.value = null
  if (chatStoryId) projects.open(chatStoryId)
}

/** @param {string} storyId */
const openProject = storyId => {
  close()
  if (storyId !== props.storyId) projects.open(storyId)
}

/** @param {any} error */
const fail = error =>
  toast.add({
    severity: error instanceof NotACardError ? 'warn' : 'error',
    detail: `Nothing imported: ${error.message}`,
    life: 6000,
  })
</script>
