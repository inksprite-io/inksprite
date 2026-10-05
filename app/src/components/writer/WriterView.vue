<template>
  <div class="h-full flex bg-surface-50 dark:bg-surface-950">
    <!-- Mobile Layout (small screens) -->
    <div v-if="isMobile" class="flex flex-col h-full w-full">
      <MobileTopBar
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
          @update:active-mobile-tab="activeMobileTab = $event"
        />
        <template v-else-if="noProject">
          <Settings v-if="mobileTab === 'settings'" />
          <ProjectList v-else class="bg-surface-100 dark:bg-surface-800" />
        </template>
      </div>
    </div>

    <!-- Desktop Layout (medium+ screens) -->
    <div v-else class="flex flex-row h-full w-full">
      <!-- Navbar -->
      <div class="flex shrink-0">
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

    <Welcome
      :visible="appState.showWelcomeDialog.value"
      @update:visible="appState.setShowWelcomeDialog($event)"
    />
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useApplicationState } from '@/composables/useApplicationState'
import { useDocuments } from '@/composables/useDocuments'
import { useScreenSize } from '@/composables/useScreenSize'
import { useStoriesStore } from '@/stores/storiesStore'
import { replaceProjectInRoute, storyIdFromRoute } from '@/utils/routeHelpers'
import { useAIProvidersStore } from '@/stores/aiProvidersStore'
import { useToast } from 'primevue/usetoast'
import { useAIConfig } from '@/composables/useAIConfig'
import { sessionStorage } from '@/utils/sessionStorage'

import Welcome from '@/components/common/Welcome.vue'
import AppNavbar from './layout/AppNavbar.vue'
import MobileTopBar from './layout/MobileTopBar.vue'
import MobileView from './layout/MobileView.vue'
import DesktopView from './layout/DesktopView.vue'
import NoProjectView from './layout/NoProjectView.vue'
import ProjectList from './projects/ProjectList.vue'
import Settings from './settings/Settings.vue'
import SettingsDialog from './settings/SettingsDialog.vue'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'
import {
  NO_PROJECT_LAYOUT,
  PANELS,
  normalizeLayout,
  selectSidebarTab,
  togglePanel as toggled,
} from './layout/layout.js'

const route = useRoute()
const router = useRouter()
const { isMobile } = useScreenSize()
const storiesStore = useStoriesStore()
const appState = useApplicationState()

/** The project the URL names. */
const routeStoryId = computed(() => storyIdFromRoute(route.params.storyId))

/**
 * The project open. Set once the URL's project is known to exist and its tree
 * is loaded, so nothing below renders against a project that is not there.
 */
const currentStoryId = ref('')

/**
 * True once the URL has been followed and found no project to open: there are
 * none. Until then the frame shows nothing, rather than the empty state for a
 * moment before the project arrives.
 */
const noProject = ref(false)

/**
 * The document the writer is in: the project's last document, while that is
 * a text document still in the tree. The story remembers it, not the URL.
 */
const currentDocumentId = computed(() =>
  currentStoryId.value ? useDocuments(currentStoryId.value).activeDocumentId.value : ''
)

const activeMobileTab = ref('write')

/**
 * The phone shows one thing at a time, and with no project open only the
 * project list and the settings are things.
 */
const mobileTab = computed(() =>
  currentStoryId.value || activeMobileTab.value === 'settings' ? activeMobileTab.value : 'projects'
)

/**
 * Which panels are showing. Read off the story, so each project reopens the
 * way it was left; see layout.js for the rules.
 */
const layout = computed(() =>
  currentStoryId.value
    ? normalizeLayout(storiesStore.getStory(currentStoryId.value)?.layout)
    : NO_PROJECT_LAYOUT
)

/** @param {import('@/types/models.js').StoryLayout} next */
const setLayout = next => {
  if (currentStoryId.value) storiesStore.updateStory(currentStoryId.value, { layout: next })
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

/** @param {import('./layout/layout.js').SidebarTab} tab */
const selectTab = tab => setLayout(selectSidebarTab(layout.value, tab))

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
 * The chat the chat panel shows. Remembered for the session per story, so it
 * survives a reload and does not follow the writer to another project.
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
 * project instead.
 */
const openRouteProject = async () => {
  noProject.value = false
  const storyId = routeStoryId.value
  if (!storyId) return openMostRecentProject()

  await storiesStore.ensureInitialized()
  if (!storiesStore.getStory(storyId)) {
    currentStoryId.value = ''
    router.replace('/')
    return
  }

  const api = useDocuments(storyId)
  await api.init()
  currentStoryId.value = storyId

  // A project opened for the first time opens on its first document; one
  // with none shows the invitation. A project closed down to no tabs stays
  // that way: that was a choice.
  if (!api.tabs.value.active && !storiesStore.getStory(storyId)?.openDocumentIds) {
    const first = api.firstTextDocument()
    if (first) api.open(first.id)
  }
}

/**
 * Nothing in the URL names a project: the app was opened at its root, or the
 * project that was open is gone. Go to the project worked on most recently,
 * and with none, stay here with the project list.
 */
const openMostRecentProject = async () => {
  currentStoryId.value = ''
  await storiesStore.ensureInitialized()
  const story = storiesStore.getAllStoriesOrdered()[0]
  if (story) replaceProjectInRoute(router, story.id)
  else noProject.value = true
}

watch(routeStoryId, openRouteProject, { immediate: true })

// A chat belongs to a story, so the one showing cannot follow the writer to
// another project; the new project's own last chat comes back instead. The
// project left keeps its tabs but not their editor states.
watch(currentStoryId, (storyId, previous) => {
  if (previous) useDocuments(previous).releaseTabs()
  selectedChatId.value = storyId ? sessionStorage.get(chatStorageKey()) : null
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
      summary: 'Connected!',
      detail: 'Your OpenRouter account has been connected',
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
})
</script>
