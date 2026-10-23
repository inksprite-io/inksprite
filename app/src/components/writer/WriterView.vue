<template>
  <div class="h-full flex bg-surface-50 dark:bg-surface-950">
    <!-- Mobile Layout (small screens) -->
    <div v-if="isMobile" class="flex flex-col h-full w-full">
      <MobileTopBar
        v-if="!focused"
        :active-mobile-tab="mobileTab"
        :has-story="Boolean(currentStoryId)"
        @update:active-mobile-tab="activeMobileTab = $event"
      />
      <div class="flex-1 overflow-hidden">
        <!-- The tree, the editor and the chats all load by story id, and a
             cold load has to find the URL's project and load it first.
             Nothing of theirs renders until it has. -->
        <!-- Keyed on the project: every view in it binds to one project's
             tree, tabs and chats when it mounts. -->
        <MobileView
          v-if="currentStoryId"
          :key="`mobile-view:${currentStoryId}`"
          :active-mobile-tab="mobileTab"
          :story-id="currentStoryId"
          :document-id="currentDocumentId"
          :chat-id="selectedChatId"
          @update:active-mobile-tab="activeMobileTab = $event"
          @update:chat-id="selectChat"
        />
        <template v-else-if="noProject">
          <Settings v-if="mobileTab === 'settings'" />
          <NoProjectView v-else />
        </template>
      </div>
    </div>

    <!-- Desktop Layout (medium+ screens) -->
    <div v-else class="flex flex-row h-full w-full">
      <!-- Navbar -->
      <div v-if="!focused" class="flex shrink-0">
        <AppNavbar
          :layout="layout"
          :has-story="Boolean(currentStoryId)"
          @select-tab="selectTab"
          @open-settings="openSettings()"
        />
      </div>

      <div class="flex-1 overflow-hidden">
        <DesktopView
          v-if="currentStoryId"
          :layout="layout"
          :story-id="currentStoryId"
          :document-id="currentDocumentId"
          :chat-id="selectedChatId"
          @update:chat-id="selectChat"
          @select-chat="openChat"
          @open-document="openDocument"
          @toggle="togglePanel"
        />
        <NoProjectView v-else-if="noProject" />
      </div>

      <SettingsDialog v-model:visible="settingsVisible" />
    </div>

    <!-- App-wide, over whichever layout is showing; a card picked in it goes
         into the project open. -->
    <CardLibraryDialog :story-id="currentStoryId" />

    <!-- A text document's versions, from the outline or its tab. -->
    <VersionsDialog v-if="currentStoryId" :key="currentStoryId" :story-id="currentStoryId" />

    <!-- A picture in a document at its own size, from the editor or a chat. -->
    <PictureViewer />

    <Welcome
      :visible="appState.showWelcomeDialog.value"
      @update:visible="appState.setShowWelcomeDialog($event)"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, watchEffect, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useApplicationState } from '@/composables/useApplicationState'
import { useDocuments } from '@/composables/useDocuments'
import { useScreenSize } from '@/composables/useScreenSize'
import { useStoriesStore } from '@/stores/storiesStore'
import { useProjectViewsStore } from '@/stores/projectViewsStore.js'
import { pushProjectToRoute, replaceProjectInRoute, storyIdFromRoute } from '@/utils/routeHelpers'
import { useAIProvidersStore } from '@/stores/aiProvidersStore'
import { useToast } from 'primevue/usetoast'
import { useAIConfig } from '@/composables/useAIConfig'
import { sessionStorage } from '@/utils/sessionStorage'
import { useProjects } from '@/composables/useProjects'
import { saveNow } from '@/composables/useSaveBeforeClosing.js'
import {
  askForProject,
  bringWindowForward,
  letGoOfProject,
  onProjectAsked,
  projectsElsewhere,
  takeProject,
} from '@/platform/windows.js'

import Welcome from '@/components/common/Welcome.vue'
import AppNavbar from './layout/AppNavbar.vue'
import MobileTopBar from './layout/MobileTopBar.vue'
import MobileView from './layout/MobileView.vue'
import DesktopView from './layout/DesktopView.vue'
import NoProjectView from './layout/NoProjectView.vue'
import Settings from './settings/Settings.vue'
import SettingsDialog from './settings/SettingsDialog.vue'
import CardLibraryDialog from './cards/CardLibraryDialog.vue'
import VersionsDialog from './editor/VersionsDialog.vue'
import PictureViewer from './editor/PictureViewer.vue'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'
import { useSidebarTab } from '@/composables/useSidebarTab.js'
import { useEditorRequest } from '@/composables/useEditorRequest.js'
import { useChatRequest } from '@/composables/useChatRequest.js'
import { useFocusMode, useFocusModeKeys } from '@/composables/useFocusMode.js'
import { requestSearchField, useProjectSearchKey } from '@/composables/useProjectSearch.js'
import {
  NO_PROJECT_LAYOUT,
  PANELS,
  SIDEBAR_TABS,
  normalizeLayout,
  selectSidebarTab,
  keptWithoutAI,
  togglePanel as toggled,
  withoutAI,
} from './layout/layout.js'

const route = useRoute()
const router = useRouter()
const { isMobile } = useScreenSize()
const storiesStore = useStoriesStore()
const projectViewsStore = useProjectViewsStore()
const appState = useApplicationState()
const projects = useProjects()

/** The project the URL names. */
const routeStoryId = computed(() => storyIdFromRoute(route.params.storyId))

/**
 * The project open. Set once the URL's project is known to exist and its tree
 * is loaded, so nothing below renders against a project that is not there.
 */
const currentStoryId = ref('')

/**
 * True once the URL has been followed and found no project to open: there are
 * none, or in the desktop app every one is open in another window. Until then
 * the frame shows nothing, rather than the empty state for a moment before
 * the project arrives.
 */
const noProject = ref(false)

/**
 * The document the writer is in: the project's last document, while that is
 * a text document still in the tree. The story remembers it, not the URL.
 */
const currentDocumentId = computed(() =>
  currentStoryId.value ? useDocuments(currentStoryId.value).activeDocumentId.value : ''
)

// Focus mode is the document alone, so there is nothing to be in it with no
// project open. See useFocusMode.
useFocusModeKeys()
// Mod-Shift-F searches the project open, from anywhere in it.
useProjectSearchKey(() => currentStoryId.value)
const focusMode = useFocusMode()
const focused = computed(() => focusMode.focused.value && Boolean(currentStoryId.value))

const activeMobileTab = ref('write')

/** The phone's views that are the AI's, which go when it is switched off. */
const AI_MOBILE_TABS = ['chat', 'narration']

/**
 * The phone shows one thing at a time, and with no project open only the
 * settings and the writing view, which says so, are things. With the AI
 * switched off its views are not things either, and in focus mode only the
 * writing view is.
 */
const mobileTab = computed(() => {
  const tab = activeMobileTab.value
  if (focused.value) return 'write'
  if (!appState.aiEnabled.value && AI_MOBILE_TABS.includes(tab)) return 'write'
  return currentStoryId.value || tab === 'settings' ? tab : 'write'
})

/** The project's layout as it keeps it, which the AI switched off leaves alone. */
const storedLayout = computed(() =>
  normalizeLayout(projectViewsStore.getView(currentStoryId.value)?.layout)
)

/**
 * Which panels are showing. Read off the project's view, so each project
 * reopens the way it was left; see layout.js for the rules.
 */
const layout = computed(() => {
  if (!currentStoryId.value) return NO_PROJECT_LAYOUT
  return appState.aiEnabled.value ? storedLayout.value : withoutAI(storedLayout.value)
})

/**
 * Keep a change to the layout in the project's view. With the AI switched
 * off, the chat and the editor are kept as they were rather than as they
 * show, so switching it back on brings the chat back.
 * @param {import('@/types/models.js').StoryLayout} next
 */
const setLayout = next => {
  if (!currentStoryId.value) return
  const kept = appState.aiEnabled.value ? next : keptWithoutAI(next, storedLayout.value)
  projectViewsStore.updateView(currentStoryId.value, { layout: kept })
}

/** @param {import('./layout/layout.js').Panel} panel */
const togglePanel = panel => setLayout(toggled(layout.value, panel))

/**
 * Show a panel that is hidden, because the writer just picked something that
 * belongs in it. Nothing else about the layout moves.
 * @param {import('./layout/layout.js').Panel} panel
 */
const showPanel = panel => {
  if (!layout.value[panel]) setLayout({ ...layout.value, [panel]: true })
}

/**
 * Open a document in the editor, and the editor with it: picking a document
 * from the outline while the editor is hidden means wanting to see it. It
 * opens as a preview, which the next pick replaces until it is kept.
 * @param {string} documentId
 */
const openDocument = documentId => {
  useDocuments(currentStoryId.value).open(documentId, { preview: true })
  showPanel(PANELS.EDITOR)
}

/**
 * Pick a list on the rail. The search, picked to be shown, has the caret
 * put in its field.
 * @param {import('./layout/layout.js').SidebarTab} tab
 */
const selectTab = tab => {
  const next = selectSidebarTab(layout.value, tab)
  if (tab === SIDEBAR_TABS.SEARCH && next.sidebar) requestSearchField()
  setLayout(next)
}

// A list asked for from deeper in the writer is shown, never toggled away as
// a second click on the rail would: on a phone its tab, here the sidebar.
const sidebarTab = useSidebarTab()
watch(sidebarTab.requested, () => {
  const tab = sidebarTab.take()
  if (!tab) return
  if (isMobile.value) activeMobileTab.value = tab
  else setLayout({ ...layout.value, sidebar: true, sidebarTab: tab })
})

// The editor asked for from deeper in the writer, having had a tab opened in
// it: on a phone its tab, here its panel.
const editorRequest = useEditorRequest()
watch(editorRequest.requested, () => {
  if (!editorRequest.take()) return
  if (isMobile.value) activeMobileTab.value = 'write'
  else showPanel(PANELS.EDITOR)
})

// Shared with anything that opens the settings from inside the writer. On a
// phone the settings are a tab, so a request to see them goes there instead.
const { visible: settingsVisible, open: openSettings } = useSettingsPanel()
watch(settingsVisible, visible => {
  if (visible && isMobile.value) {
    activeMobileTab.value = 'settings'
    settingsVisible.value = false
  }
})

/**
 * The chat the chat panel shows, or the phone's chat tab. Remembered for the
 * session per story, so it survives a reload and does not follow the writer
 * to another project.
 */
const selectedChatId = ref(null)

const chatStorageKey = () => `ui.writer.${currentStoryId.value}.chat`

/** @param {string|null} chatId */
const selectChat = chatId => {
  selectedChatId.value = chatId
  if (chatId) sessionStorage.set(chatStorageKey(), chatId)
  else sessionStorage.remove(chatStorageKey())
}

/**
 * Picking a chat from the list means wanting to read it.
 * @param {string} chatId
 */
const openChat = chatId => {
  selectChat(chatId)
  showPanel(PANELS.CHAT)
}

// Needed to handle OAuth messages
const aiProvidersStore = useAIProvidersStore()
const aiConfig = useAIConfig()
const toast = useToast()

/**
 * Follow the URL to its project. A URL that names nothing — an old one, a
 * project since deleted — goes to the root, which opens the most recent
 * project instead. A project open in another window is shown there, and
 * this one goes back to its own, or with none to the most recent.
 */
const openRouteProject = async () => {
  noProject.value = false
  const storyId = routeStoryId.value
  if (!storyId) return openMostRecentProject()

  await storiesStore.ensureInitialized()
  await projects.refresh()
  if (!storiesStore.getStory(storyId)) {
    currentStoryId.value = ''
    router.replace('/')
    return
  }

  const { held, stale, first } = await takeProject(storyId, 'open')
  if (!held) {
    askForProject(storyId)
    if (currentStoryId.value) replaceProjectInRoute(router, currentStoryId.value)
    else router.replace('/')
    return
  }
  // The writer went on to another project while this one was being taken.
  if (routeStoryId.value !== storyId) {
    if (currentStoryId.value !== storyId) letGoOfProject(storyId, 'open')
    return
  }
  // Another window has had the project since this one last did, and what
  // this one kept of it is behind: the page reads it all again.
  if (stale) {
    await saveNow()
    window.location.reload()
    return
  }
  if (first) await storiesStore.readAfresh(storyId)

  const api = useDocuments(storyId)
  await api.init()
  currentStoryId.value = storyId

  // A project opened for the first time opens on its first document; one
  // with none shows the invitation. A project closed down to no tabs stays
  // that way: that was a choice.
  if (!api.tabs.value.active && !projectViewsStore.getView(storyId)?.openDocumentIds) {
    const first = api.firstTextDocument()
    if (first) api.open(first.id)
  }
}

/**
 * Nothing in the URL names a project: the app was opened at its root, or the
 * project that was open is gone. Go to the project the writer was last in on
 * this copy of the app, or with none opened here the one changed last, and
 * with no projects, stay here and say so. In the desktop app, projects open
 * in other windows are passed over: a new window with every project open
 * elsewhere is as empty as one with none.
 */
const openMostRecentProject = async () => {
  currentStoryId.value = ''
  await Promise.all([storiesStore.ensureInitialized(), projectViewsStore.ensureInitialized()])
  await projects.refresh()
  const away = await projectsElsewhere()
  const ids = storiesStore
    .getAllStoriesOrdered()
    .map(story => story.id)
    .filter(id => !away.has(id))
  const storyId = projectViewsStore.lastOpened(ids) ?? ids[0]
  if (storyId) replaceProjectInRoute(router, storyId)
  else noProject.value = true
}

watch(routeStoryId, openRouteProject, { immediate: true })

// A project that comes while none is open, synced from another device, is
// opened as one there at the start would have been.
watch(
  () => storiesStore.stories.size,
  count => {
    if (noProject.value && count > 0) openMostRecentProject()
  }
)

// The project open, gone to the trash or deleted, here or on another device,
// closes, and the most recent other one opens in its place.
watch(
  () => Boolean(currentStoryId.value) && !storiesStore.getStory(currentStoryId.value),
  gone => {
    if (gone) router.replace('/')
  }
)

/**
 * Let go of a project left, for another window to take, once what was done
 * in it is saved. One come back to meanwhile is kept.
 * @param {string} storyId
 */
const leave = async storyId => {
  try {
    await saveNow()
  } finally {
    if (currentStoryId.value !== storyId) letGoOfProject(storyId, 'open')
  }
}

// A chat belongs to a story, so the one showing cannot follow the writer to
// another project; the new project's own last chat comes back instead. The
// project left keeps its tabs but not their editor states, and is let go of.
watch(currentStoryId, (storyId, previous) => {
  if (previous) {
    useDocuments(previous).releaseTabs()
    leave(previous)
  }
  selectedChatId.value = storyId ? sessionStorage.get(chatStorageKey()) : null
})

// The window is titled with its project, so that the windows can be told
// apart: in the Window menu and the Dock, and as a browser's tabs.
watchEffect(() => {
  document.title = currentStoryId.value
    ? `${projects.nameOf(currentStoryId.value)} — inksprite`
    : 'inksprite'
})

// Another window asking to see the project this one has: this one comes
// forward on it.
const stopAnswering = onProjectAsked(storyId => {
  if (storyId !== currentStoryId.value) pushProjectToRoute(router, storyId)
  bringWindowForward()
})

// A chat asked for from elsewhere, in the project it is in, shown once that
// project is the one open: on a phone its tab, here the chat panel.
const chatRequest = useChatRequest()
watch([chatRequest.requested, currentStoryId], () => {
  const chatId = currentStoryId.value && chatRequest.take(currentStoryId.value)
  if (!chatId) return
  if (isMobile.value) {
    selectChat(chatId)
    activeMobileTab.value = 'chat'
  } else openChat(chatId)
})

/**
 * Handle OAuth success message from callback window
 */
async function handleOAuthMessage(event) {
  // Verify origin for security
  if (event.origin !== window.location.origin) {
    return
  }

  if (event.data.type === 'oauth-success' && event.data.provider === 'openrouter') {
    // Reload the provider from database to get the updated API key
    if (event.data.providerId) {
      await aiProvidersStore.reloadProvider(event.data.providerId)
    }

    console.log('OpenRouter OAuth connected successfully')

    toast.add({
      severity: 'success',
      detail: 'Connected to your OpenRouter account',
      life: 3000,
    })
  }
}

// Initialize on mount
onMounted(async () => {
  await aiConfig.init()
  window.addEventListener('message', handleOAuthMessage)
  await appState.checkAndShowWelcomeDialog()
})

onUnmounted(() => {
  window.removeEventListener('message', handleOAuthMessage)
  stopAnswering()
})
</script>
