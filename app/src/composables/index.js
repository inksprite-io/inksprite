/**
 * @module composables
 * @description Vue 3 composables providing reusable logic for the inksprite application.
 *
 * ## Composables Overview
 *
 * ### AI
 * - **useAIChat** - A chat turn: context, request, tool calls, and streaming into a message; one per chat, so a reply outlives the view showing it; `askInThread` asks its model something at the end of the conversation in place of a turn (a summary)
 * - **useChatActivity** - Which chats the model is working in, app-wide, and word when it stops
 * - **useChatTabs** - A project's chat tabs: open, showing, previews, the history closing goes back through, and unread chats
 * - **useChatPlaces** - Where the writer was in each chat they left, for its tab coming back
 * - **useAIConfig** - AI configuration (provider + model)
 * - **useConnections** - The AI connections the writer has: which are theirs, how each answered last, and adding, checking and removing one
 * - **useSignIn** - Connecting an account by signing in to a service that makes the app a key: OpenRouter and NanoGPT
 * - **useWebSearch** - Web search as the settings set it up: the service in use and whether a page is kept without asking, and each service's key
 * - **useModelLists** - The models each provider serves, app-wide: asked for on Connect or Refresh, never as an address is typed
 * - **useExplore** - Exploring a folder, a document or the project for the model, on the chat's model: asked first with its size, then the job
 * - **useProfiles** - The chat profiles: how a chat is run, built-in and saved
 * - **useSkills** - The writer's own skills: the library, a file kept as it is written (`createSkill`, `writeSkill`), and why one can't be used (`problemOf`)
 * - **useMcpServers** - The writer's MCP servers: adding one after a look at what it offers, listing it again, its profiles and the tools always allowed
 * - **useToolApprovals** - The calls of a server's tools waiting on the writer to allow them
 * - **usePrompts** - Legacy. The prompt library the profiles replaced; read by cleanup alone
 *
 * ### Data
 * - **useProjects** - Every project, and creating, importing, opening and deleting them
 * - **useDocuments** - A story's document tree, shaped for the tree UI, and the editor's tabs
 * - **useChats** - Chat session management
 * - **useChatSettings** - One chat's settings and profile, started or not
 * - **useChatPresets** - Giving every chat the model it runs on, so a pick on its profile, or a preset changed or deleted, never moves it
 * - **useToolChoices** - Giving every profile and chat, once, the web, Python and MCP servers as switches of its own, from the lists that said before
 * - **useBackup** - Whole-database export and restore, and single chats, projects and settings as files
 * - **useExport** - A project, a folder or a document handed out as it would be published, a zip of it where it is more than one file
 * - **usePrint** - A document printed, or saved as a PDF, in the editor's styles, on Command-P and Export as PDF…
 * - **useTrash** - The trash: what a project's holds of its documents and chats, and the projects in it, to restore or delete for good
 * - **useVersions** - A text document's versions, listed, compared with the text now, restored, named and kept; and the Versions dialog's state
 * - **useNarration** - A project read aloud: its voices and hints, a document's speakers, and the readings
 * - **useComments** - The writer's comments in a project, by document, kept up as they are typed; going to one, and resolving it
 * - **useSpeech** - Something read aloud then and there, a line at a time: a chat message. One thing at a time, app-wide
 * - **useSpeechServer** - What documents are read aloud through: a project's connection and model, as a request needs them, and the model's voices
 *
 * ### UI
 * - **useEditor** - The open documents: an editor state each, and their projection into the store
 * - **useToast** - Toast notification system
 * - **useScreenSize** - Breakpoint-aware screen size
 * - **useKeyboardCover** - How much of an element the on-screen keyboard covers
 * - **useMessageField** - The chat's message field, fitted to its draft
 * - **useLinkMenu** - The documents `[[` lists in the message field, folders among them, and `@`, which attaches the one picked
 * - **useCommandMenu** - The menu of commands a slash at the start of a line opens in the message field
 * - **useJumpToBottom** - When to offer the way back to the end of a long chat: far from it, and heading for it
 * - **useNearScreen** - Which rows of a long list are on the screen or close to it, so only those are drawn in full
 * - **useNearTurns** - Which of a chat's turns are in the page: those near the screen, the newest two, and any with an editor open; plus the state a turn keeps while it is away
 * - **useSettingsPanel** - Opening the settings, on a section and a part of it, from anywhere in the writer
 * - **useCardLibraryPanel** - Opening the card library, to browse or to pick a card for a folder, from anywhere in the writer
 * - **useSidebarTab** - Showing a sidebar list, such as the narration, from anywhere in the writer
 * - **useEditorRequest** - Showing the editor, having opened a tab in it, from anywhere in the writer
 * - **useChatRequest** - Showing a chat in the project it is in, once that project is open, from anywhere in the writer
 * - **useFocusMode** - Focus mode: the document alone, full screen, in and out on Option-Command-F
 * - **useTopmostEscape** - Escape closes the dialog on top, and only that one
 * - **useCopyLink** - Copy a link to a document, its path the address the tools take, to the clipboard
 * - **useReveal** - Show a document where it is on disk, in the desktop app's file manager
 * - **useDocumentLinks** - Links between a project's documents: one opens the document in a tab,
 *   and the link field makes one from a path or a name
 * - **usePictures** - What a picture's path in a document is (its own, a file document, or the
 *   web), and opening one
 * - **usePictureViewer** - The picture shown at its own size over the whole window, from anywhere
 * - **usePlainText** - Turn a document plain or back, with an undo when that rewrote its text
 * - **useLongPress** - A finger held still on something, for what a right-click opens elsewhere
 * - **useTreeDrop** - A document dragged onto a folder's row goes into the folder, and a shut
 *   one held over opens; the folder a drop would go into, shown whole
 * - **useTreeHistory** - Command-Z and Shift-Command-Z for what the writer does in the outline:
 *   making, renaming, moving and deleting documents
 * - **useFindKey** - Command-F (Control-F off a Mac) opens the find of the panel the writer is in
 * - **useLastOpened** - Keeps which project the writer was last in, which the app opens on
 * - **useProjectActions** - What can be done to a project, as menu items, the open one or another
 * - **useHoverSubmenus** - A TieredMenu's submenus opening on hover, once the pointer rests
 * - **useProjectSearch** - The search across a project: what is looked for, what it finds, going to a match, and Command-Shift-F
 * - **useChatFind** - Finding in a chat, most of which is not in the page: counted in the messages, gone to and highlighted in the page
 * - **useTheme** - The page in the writer's theme, following the system's while that is the one chosen (`useSystemSettings.js`)
 * - **useUpdates** - In the desktop app, an update downloaded as soon as there is one, and a toast to restart into it; in a browser, a toast to reload into a new build
 * - **useSaveBeforeClosing** - In the desktop app, edits saved before the window closes or the app quits
 * - **useSettingsFile** - In the desktop app, the settings file a script left in the data folder, imported as the app opens
 *
 * ## Patterns
 *
 * All composables follow Vue 3 Composition API patterns:
 * - Return reactive refs and computed properties
 * - Provide methods for data manipulation
 * - Handle side effects with watchers
 * - Clean up resources in onUnmounted
 *
 * @example
 * // A story's tree
 * import { useDocuments } from '@/composables/useDocuments'
 *
 * const documents = useDocuments(storyId)
 * await documents.init()
 *
 * const chapters = documents.childrenOf(`manuscript_${storyId}`)
 * documents.rename(chapters[0].id, 'The Long Road')
 * documents.setContent(chapters[0].id, '# The Long Road')
 */

export { useAIConfig } from './useAIConfig.js'
export { useModelLists } from './useModelLists.js'
export { useBackup } from './useBackup.js'
export { useExport } from './useExport.js'
export { usePrint, usePrintKey, isPrintKey } from './usePrint.js'
export { useProfiles } from './useProfiles.js'
export { useSkills } from './useSkills.js'
export { useMcpServers } from './useMcpServers.js'
export { useToolApprovals } from './useToolApprovals.js'
export { usePrompts } from './usePrompts.js'
export { useChats } from './useChats.js'
export { useChatSettings } from './useChatSettings.js'
export { stampFor, stampChats, stampEveryChat, seedRecentModels } from './useChatPresets.js'
export { giveToolChoices, givenChoice } from './useToolChoices.js'
export { useDocuments } from './useDocuments.js'
export { useNarration } from './useNarration.js'
export { useComments } from './useComments.js'
export { useSpeech } from './useSpeech.js'
export { useSpeechServer } from './useSpeechServer.js'
export { useEditor } from './useEditor.js'
export { useToast } from './useToast.js'
export { useScreenSize } from './useScreenSize.js'
export { useKeyboardCover } from './useKeyboardCover.js'
export { useSettingsPanel } from './useSettingsPanel.js'
export { useCardLibraryPanel } from './useCardLibraryPanel.js'
export { useSidebarTab } from './useSidebarTab.js'
export { useEditorRequest } from './useEditorRequest.js'
export { useChatRequest } from './useChatRequest.js'
export { useFocusMode, useFocusModeKeys } from './useFocusMode.js'
export { useLastOpened } from './useLastOpened.js'
export { useProjectActions } from './useProjectActions.js'
export { useHoverSubmenus } from './useHoverSubmenus.js'
export { useProjectSearch, useProjectSearchKey } from './useProjectSearch.js'
export { useTopmostEscape } from './useTopmostEscape.js'
export { useCopyLink } from './useCopyLink.js'
export { useReveal } from './useReveal.js'
export { useDocumentLinks } from './useDocumentLinks.js'
export { usePictures } from './usePictures.js'
export { usePictureViewer } from './usePictureViewer.js'
export { usePlainText } from './usePlainText.js'
