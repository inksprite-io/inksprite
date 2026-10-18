/**
 * @module components
 * @description Vue components for the inksprite application UI.
 *
 * ## Component Structure
 *
 * ### Layout Components
 * - **common/** - Shared UI components used across the application
 *   - Navigation, headers, footers
 *   - Modals and dialogs
 *   - Form elements and inputs
 *
 * ### Feature Components
 * - **writer/** - The whole application, once past the OAuth callback
 *   - `layout/` - The writer's frame. A 48px rail (`AppNavbar`) picks what the
 *     sidebar shows (outline, chats, narration, comments), toggles the three panels that
 *     `DesktopView` lays side by side (`LeftSidebar`, `EditorPanel`,
 *     `ChatPanel`), and opens the settings. Which are showing is the story's
 *     `layout`, with the rules in `layout.js`: the editor and the chat are never
 *     both hidden, and hiding one moves the sidebar off its list. With no
 *     project open, `NoProjectView` invites the writer to start one. Phones
 *     get `MobileTopBar` and `MobileView` instead, one view at a time. The
 *     sidebar's lists head themselves with `PanelHeader`, the height of the
 *     editor's tab strip and the chat's header, and the small icon buttons in
 *     all of them are `HeaderButton`.
 *   - `projects/` - `ProjectMenu`, the menu at the start of the outline's
 *     header, for switching projects (in a submenu, which scrolls), starting
 *     or importing one, and the open one's settings, export and delete; and
 *     the new-project dialog
 *   - `editor/` - The editor over a structured document, the field over a
 *     plain one, the strip of tabs above them, and the empty editor for a
 *     project with no documents or no tabs. A comment is begun on a selection
 *     by `CommentButton` or Mod-Shift-M; on a phone it is written and shown
 *     in `CommentBar`, at the bottom, while the caret is in its passage
 *   - `comments/` - `CommentsPanel`, the project's comments in the sidebar,
 *     each a `CommentThread`, and on the desktop where a comment is written
 *     (`CommentDraft`) and answered: picking one opens its document, where
 *     `Editor` scrolls to it and marks it; Resolve takes it off
 *   - `tree/` - The document tree and its nodes. Its header's Import and New
 *     document act on the project's top, as the root's menu does
 *   - `chats/` - A chat, its list, and its settings
 *   - `narration/` - The document in the editor read aloud: `NarrationPanel`
 *     in the sidebar, with the document's blocks (`NarrationScript`: who
 *     speaks each, whether it has been read, a selection to read on its own),
 *     what the project is read through (`NarrationModel`: a connection that
 *     speaks, and its model), its voices and their colours, its pronunciation
 *     hints, its filters for what is not read, and the player. While it shows, `Editor`
 *     colours each speaker's lines and greys what the filters leave out.
 *     `ReadAloudButton` reads something in one voice then and there; a chat
 *     turn has one in its header, and the chat's settings choose the voice.
 *   - `settings/` - App-wide settings: `Settings` is a section list beside a
 *     pane, shown in `SettingsDialog` on the desktop and as a tab on phones.
 *     `LibraryMoveToast` shuts the page while the desktop app's projects move
 *     into their folder or back, and says how far they are.
 *   - `cards/` - The card library, app-wide like the settings:
 *     `CardLibraryDialog` over the writer, opened from the rail or from a
 *     folder's Import › Character card…, holding `CardLibrary`, a grid of
 *     `CardTile`s with a search and the library's tags, and `CardDetail`, one
 *     card in full. Putting a card into the project is the dialog's.
 *
 * ### Icon Components
 * - **icons/** - SVG icon components
 *   - Consistent icon system
 *   - Optimized for performance
 *
 * ## Component Patterns
 *
 * All components follow Vue 3 Composition API patterns:
 * - Use `<script setup>` syntax
 * - Props are defined with TypeScript-like JSDoc annotations
 * - Events are emitted with explicit types
 * - Provide/inject for cross-component communication
 *
 * @example
 * // Using a component
 * <template>
 *   <StoryEditor
 *     :story="currentStory"
 *     @save="handleSave"
 *     @generate="handleGenerate"
 *   />
 * </template>
 *
 * <script setup>
 * import StoryEditor from '@/components/writer/StoryEditor.vue'
 * import { useStories } from '@/composables'
 *
 * const { currentStory } = useStories()
 *
 * function handleSave(content) {
 *   // Save logic
 * }
 *
 * function handleGenerate(params) {
 *   // AI generation logic
 * }
 * </script>
 *
 * ## Styling
 *
 * Components use a combination of:
 * - Tailwind CSS utility classes
 * - PrimeVue component library
 * - Scoped styles when needed
 *
 * ## Best Practices
 *
 * 1. Keep components focused and single-purpose
 * 2. Use props for data input, events for output
 * 3. Leverage composables for shared logic
 * 4. Document props and events with JSDoc
 * 5. Test components in isolation
 */

// Component exports would go here if we exported them programmatically
// Currently components are imported directly via their file paths
