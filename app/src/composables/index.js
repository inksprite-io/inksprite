/**
 * @module composables
 * @description Vue 3 composables providing reusable logic for the inksprite application.
 *
 * ## Composables Overview
 *
 * ### AI
 * - **useAIChat** - A chat turn: context, request, tool calls, and streaming into a message
 * - **useAIConfig** - AI configuration (provider + model)
 * - **useAISummarize** - Summarize a document
 * - **useProfiles** - The chat profiles: how a chat is run, built-in and saved
 * - **useSkills** - The writer's own skills: the library, and when it has been read
 * - **useLoadedSkills** - The skills a chat has loaded, read off its messages, and dropping one
 * - **useMcpServers** - The writer's MCP servers: adding one after a look at what it offers, listing it again, its profiles and the tools always allowed
 * - **useToolApprovals** - The calls of a server's tools waiting on the writer to allow them
 * - **usePrompts** - Legacy. The prompt library the profiles replaced; read by cleanup alone
 *
 * ### Data
 * - **useProjects** - Every project, and creating, importing, opening and deleting them
 * - **useDocuments** - A story's document tree, shaped for the tree UI, and the editor's tabs
 * - **useChats** - Chat session management
 * - **useChatSettings** - One chat's settings and profile, started or not
 * - **useBackup** - Whole-database export and restore, and single chats and projects as files
 * - **useNarration** - A project read aloud: its voices and hints, a document's speakers, and the readings
 * - **useComments** - The writer's comments in a project, by document, kept up as they are typed; going to one, and resolving it
 * - **useSpeech** - Something read aloud then and there, a line at a time: a chat message. One thing at a time, app-wide
 *
 * ### UI
 * - **useEditor** - The open documents: an editor state each, and their projection into the store
 * - **useToast** - Toast notification system
 * - **useScreenSize** - Breakpoint-aware screen size
 * - **useKeyboardCover** - How much of an element the on-screen keyboard covers
 * - **useMessageField** - The chat's message field, fitted to its draft
 * - **useCommandMenu** - The menu of commands a slash at the start of a line opens in the message field
 * - **useJumpToBottom** - When to offer the way back to the end of a long chat: far from it, and heading for it
 * - **useNearTurns** - Which of a chat's turns are in the page: those near the screen, the newest two, and any with an editor open; plus the state a turn keeps while it is away
 * - **useSettingsPanel** - Opening the settings, on a section, from anywhere in the writer
 * - **useTopmostEscape** - Escape closes the dialog on top, and only that one
 * - **useCopyPath** - Copy a document's path, the address the tools take, to the clipboard
 * - **usePlainText** - Turn a document plain or back, with an undo when that rewrote its text
 * - **useLongPress** - A finger held still on something, for what a right-click opens elsewhere
 * - **useTreeDrop** - A document dragged onto a folder's row goes into the folder, and a shut
 *   one held over opens
 * - **useFindKey** - Command-F (Control-F off a Mac) opens the find of the panel the writer is in
 * - **useChatFind** - Finding in a chat, most of which is not in the page: counted in the messages, gone to and highlighted in the page
 * - **useUpdates** - In the desktop app, an update downloaded as soon as there is one, and a toast to restart into it
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
export { useBackup } from './useBackup.js'
export { useProfiles } from './useProfiles.js'
export { useSkills } from './useSkills.js'
export { useLoadedSkills } from './useLoadedSkills.js'
export { useMcpServers } from './useMcpServers.js'
export { useToolApprovals } from './useToolApprovals.js'
export { usePrompts } from './usePrompts.js'
export { useChats } from './useChats.js'
export { useChatSettings } from './useChatSettings.js'
export { useDocuments } from './useDocuments.js'
export { useNarration } from './useNarration.js'
export { useComments } from './useComments.js'
export { useSpeech } from './useSpeech.js'
export { useEditor } from './useEditor.js'
export { useToast } from './useToast.js'
export { useScreenSize } from './useScreenSize.js'
export { useKeyboardCover } from './useKeyboardCover.js'
export { useSettingsPanel } from './useSettingsPanel.js'
export { useTopmostEscape } from './useTopmostEscape.js'
export { useCopyPath } from './useCopyPath.js'
export { usePlainText } from './usePlainText.js'
