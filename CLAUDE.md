# CLAUDE.md

## Project Overview

inksprite is a writing application with AI integration. It runs entirely in the browser: no backend, data in IndexedDB, AI requests straight from the client to the provider.

Features:
- **Editor**: Distraction-free editor (ProseMirror) with markdown support, and find and replace on Command-F
- **Projects**: A project is a tree of documents. Folders hold children; text documents hold content; file documents are imported files (PDFs, images, anything) whose extracted text is their content and whose bytes live in the `files` table. A folder can be ordered, in which case its children sort by position and can be dragged into place; otherwise they sort by title. A new project starts empty; the writer lays it out. (The storage still calls a project a story: the `stories` table, `storyId`, and the `Story` typedef.)
- **AI Integration**: OpenRouter (with OAuth), llama.cpp, and any OpenAI-compatible endpoint. Profiles pair a provider and model with generation settings.
- **Chat**: Brainstorm with the AI, which reads, searches, creates, and writes the project's documents through tools, and searches the web and reads pages through a service the writer connects under Settings › Connections (Exa or Kagi, and Brave in the desktop app; opted into per profile or per chat). Conversations can be compacted into a summary of themselves. Command-F finds in the whole chat, though only the turns near the screen are in the page.
- **Profiles**: A chat runs under a profile: its system prompt, which tools it is offered, and the author's note it starts with. The built-ins are Default (the project and its tools), Roleplay and Roleplay (NSFW) (a scene, no tools; the NSFW one carries the opt-ins the writer lists in its author's note, and takes Roleplay's place while Settings › Enable NSFW chat profiles is on: chats on Roleplay, card chats among them, run on it then, and chats on it run as Roleplay while the switch is off), and Blank (no system prompt, no tools, no project). The RPG tools (dice, oracle, tables, tarot, names, and the interpret skill) are offered in chats that have them on; the Adventure prompt they were tuned under lives in `app/harness/prompts/` for the harness.
- **Backup**: Whole-database export and restore, with forward migrations for old backups.

Design docs for in-progress work live in `.llm/`, which is kept on dev but left out of the published repository. `document_tree_design.md` is the current data model; `markdown_library_design.md` is where content, the editor, and storage are going; `desktop_design.md` is the desktop app, an Electron shell over the web build first and the library on disk after; `files_design.md` is how imported files reach the tree, the viewer, and the model. `google_docs_design.md` is importing Google Docs from Drive as markdown, and images in documents. `skills_design.md` is skills and tools: who may call them, the `/` menu, SKILL.md files in an app-wide library, and tools from MCP servers. `project_context_design.md` is what a chat's model has of the project on every turn: the writer's pins in the project block, document calls kept in the conversation, and `list_documents`. `source_code_design.md` is a codebase in a project: a repository imported from GitHub or a folder as read-only file documents, a CodeMirror viewer, and reading and searching by line. `web_search_design.md` is every tool call staying in the conversation, then the model searching the web and reading pages through a service the writer connects: Exa, Kagi, or Brave on desktop. `comments_design.md` is the writer's comments on passages: a mark in the editor, CriticMarkup with an id in the file, and the tools the model resolves them with.

## Development Commands

These commands are run from the `app/` directory.

- **Install dependencies**: `npm install`
- **Run development server**: `npm run dev`
- **Build for production**: `npm run build`
- **Preview production build**: `npm run preview`
- **Lint code**: `npm run lint`
- **Fix lint issues**: `npm run lint:fix`
- **Format code**: `npm run format`
- **Check formatting**: `npm run format:check`
- **Generate docs**: `npm run docs`
- **Type check**: `npm run typecheck`
- **CI**: `npm run ci`
- **Fix CI issues**: `npm run ci:fix`

## Test Server

There is a test server container running with `docker compose` that is hot updated by Vite. After a change to the app's dependencies, or a merge that touches `package.json`, `package-lock.json`, `vite.config.js` or `index.html`, the user rebuilds it with `./rebuild-test-server.sh` from the repository root, on their Mac. Never `npm install` inside the container: those files are mounted one at a time and go stale when git replaces them.

The desktop app (`app/electron/`) runs on the user's Mac with `app/electron/start-on-mac.sh`, loading the page from the test server; see `app/electron/README.md`. npm never runs on the Mac: `npm ci` in `app/electron` happens in the container, and the script fetches the Mac's Electron itself.

## Guidelines

### Clean Code

- Write clean, idiomatic code
- After implementing a complex feature, review your work and refactor if necessary
- If a change doesn't fit well with the current architecture, refactor or redesign rather than adding technical debt
- Create a commit after each significant change
- This project uses JSDoc for type checking. Ensure that types are respected and documented correctly.
- Use `npm run ci` to run the linter, format checker, type checker, and tests.
- Use `npm run ci:fix`  to fix lint and format errors.

### Help text

Most controls need none. A note under a setting, or in a dialog, says only what the control can't say for itself: its scope ("Applies to every chat"), a format, or a warning ("Edits made since are lost"). Keep that to a line. Never restate the label, and never explain how the app works inside; a result the app reports afterwards (a toast, a status line) needs no note ahead of it. No Enabled/Disabled tooltips on switches. Commit 50a8bbfe, which cut the app's help text down this way, is the model.

### Third-party material

This repository is published. The rulebooks, books, papers, character cards and chats we test against are other people's work:

- Keep them in the gitignored folders: `app/harness/test-*/` (cards, chats, PDFs, epubs), `app/harness/research/`, and `local/` at the repository root.
- Never name them in anything committed: design notes, comments, tests, fixtures, harness findings, commit messages. Describe them by their role instead: "the largest rulebook", "a third-party card", "a novel".
- Never copy their text into a test or fixture, not even a heading or a line. Make up text of the same shape.

### Testing

The project uses **Vitest** for unit and integration testing, with **@vue/test-utils** for Vue component testing.

#### Test Commands

Run these commands from the `app/` directory:

- **Run all tests**: `npm test`
- **Run tests in watch mode**: `npm run test:watch`
- **Run tests with UI**: `npm run test:ui`
- **Generate coverage report**: `npm run test:coverage`

#### Test Structure

- Tests are located in the `app/test/` directory
- Test files follow the naming convention: `*.test.js`
- Tests are organized to mirror the source structure:
  - `test/stores/` - Pinia store tests
  - `test/components/` - Vue component tests
  - `test/utils/` - Utility function tests
  - `test/composables/` - Composable tests

#### Writing Tests

##### Store Testing
- Mock the database layer and external dependencies
- Test state management, actions, and getters
- Ensure proper initialization and error handling
- Example: `test/stores/storiesStore.test.js`

##### Component Testing
- Use `@vue/test-utils` for mounting components
- Mock router, stores, and external dependencies
- Test user interactions, props, and emitted events
- Test both rendering and behavior
- Example: `test/components/BookCard.test.js`

##### Utility Testing
- Test pure functions with various inputs
- Cover edge cases (null, undefined, empty values)
- Test with different data types and formats
- Example: `test/utils/wordCount.test.js`

#### Best Practices

1. **Isolation**: Each test should be independent and not rely on other tests
2. **Mocking**: Mock external dependencies (database, API calls, stores)
3. **Coverage**: Aim for high code coverage but prioritize meaningful tests
4. **Descriptive Names**: Use clear, descriptive test names that explain what is being tested
5. **Setup/Teardown**: Use `beforeEach` and `afterEach` for consistent test state
6. **Assertions**: Make specific assertions that test one thing at a time

### Documentation

Project documentation can be found in `app/docs/index.md`. High level documentation for a module can be found in the associated `index.js`, e.g. `app/src/stores/index.js`.

- Add JSDoc comments to all functions for type checking and documentation
- Update module documentation as needed
  - New modules should be created with an `index.md`, similar to `app/src/stores/index.js`
  - Update the `index.js` file for a given module when required
  - Update the project level `app/docs/index.md` if the structure of the project changes
- Regenerate the documentation using `npm run docs`