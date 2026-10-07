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
 *     sidebar shows (outline, chats, narration, projects), toggles the three panels that
 *     `DesktopView` lays side by side (`LeftSidebar`, `EditorPanel`,
 *     `ChatPanel`), and opens the settings. Which are showing is the story's
 *     `layout`, with the rules in `layout.js`: the editor and the chat are never
 *     both hidden, and hiding one moves the sidebar off its list. With no
 *     project open, `NoProjectView` shows the list and an invitation. Phones
 *     get `MobileTopBar` and `MobileView` instead, one view at a time.
 *   - `projects/` - The project list, its cards, and the new-project dialog
 *   - `editor/` - The editor over a structured document, the field over a
 *     plain one, the strip of tabs above them, and the empty editor for a
 *     project with no documents or no tabs
 *   - `tree/` - The document tree and its nodes
 *   - `chats/` - A chat, its list, and its settings
 *   - `narration/` - The document in the editor read aloud: `NarrationPanel`
 *     in the sidebar, with the document's blocks (`NarrationScript`: who
 *     speaks each, whether it has been read, a selection to read on its own),
 *     the project's voices and their colours, its pronunciation hints, and
 *     the player. While it shows, `Editor` colours each speaker's lines.
 *     `ReadAloudButton` reads something in one voice then and there; a chat
 *     turn has one in its header, and the chat's settings choose the voice.
 *   - `settings/` - App-wide settings: `Settings` is a section list beside a
 *     pane, shown in `SettingsDialog` on the desktop and as a tab on phones.
 *     `NarrationSection` is where the speech server is set.
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
