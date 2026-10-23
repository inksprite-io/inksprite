# CLAUDE.md

## Project Overview

inksprite is a writing application with AI integration. It runs entirely in the browser: no backend, data in IndexedDB, AI requests straight from the client to the provider.

Features:
- **Editor**: Distraction-free editor (ProseMirror) with markdown support, find and replace on Command-F, a search across the project on Shift-Command-F (a list in the sidebar, by document, each match opening its document at it with the find on it; a PDF at its page), spelling and grammar checked by Harper in a worker (English; the project's names known; no autocorrect), pictures (pasted, dropped, inserted, or kept from an imported Doc or Word file; each its document's own, at `.images/<document id>/` beside it, with alt text, never fetched from the web), and focus mode on Option-Command-F: the document alone, full screen
- **Projects**: A project is a tree of documents. Folders hold children; text documents hold content; file documents are imported files (PDFs, images, anything) whose extracted text is their content and whose bytes live in the `files` table. A folder can be ordered, in which case its children sort by position and can be dragged into place; otherwise they sort by title. A new project starts empty; the writer lays it out. A Scrivener 3 project can be imported, as a new project or into a folder: the binder as the tree, each text as markdown. The desktop app opens more windows from File › New Window, a project in one at a time; its windows and a browser's tabs tell each other what they change (`platform/windows.js`), though two tabs on one project still write over each other. (The storage still calls a project a story: the `stories` table, `storyId`, and the `Story` typedef.)
- **AI Integration**: OpenRouter (with OAuth), llama.cpp, and any OpenAI-compatible endpoint. Profiles pair a provider and model with generation settings. Each connection takes so many requests at once (Requests at once; one for a server at home, or llama.cpp's slots, and no limit for a hosted service, which is asked less at once when it answers 429), and what the writer is waiting on goes before a job's. The AI can be switched off in Settings › System (and from the welcome): the chat, the narration, the AI's settings sections (Settings › AI among them) and its outline marks and menu items go, and what they hold is kept for when it is back on.
- **Chat**: Brainstorm with the AI, which reads, searches, creates, and writes the project's documents through tools, and searches the web and reads pages through a service the writer connects under Settings › Connections (Exa or Kagi, and Brave in the desktop app; opted into per profile or per chat). It keeps a page or a document it found (a PDF as the file itself where it can be fetched, which in a browser it mostly can't) in the project, asking first until the writer says Always allow. Conversations can be compacted into a summary of themselves. Command-F finds in the whole chat, though only the turns near the screen are in the page. A chat that asks before changing documents suggests its edits to a text document in the text, each change accepted or rejected on its own in the Comments tab (a plain document's, a new document and a delete are proposed in the chat). `explore_documents`, the writer's `/explore` and a folder's Explore… write a line on what each document, folder and long section is about, which the listings show the model; the chat asks before exploring a lot (Settings › System › Chats).
- **Profiles**: A chat runs under a profile: its system prompt, which tools it is offered, and the author's note it starts with. The built-ins are Default (the project and its tools), Roleplay and Roleplay (NSFW) (a scene, with the document tools and no others; the NSFW one carries the opt-ins the writer lists in its author's note, and takes Roleplay's place while Settings › Extensions › Roleplay › Enable NSFW chat profiles is on: chats on Roleplay, card chats among them, run on it then, and chats on it run as Roleplay while the switch is off), and Blank (no system prompt, no tools, no project). The RPG tools (dice, oracle, tables, tarot, names) are offered in chats that have them on; the Adventure prompt they were tuned under lives in `app/harness/prompts/` for the harness. Interpret and Write, the built-in skills still being tuned, each have a switch under Experimental in Settings › Skills (off by default, app-wide), and each is there only while switched on; then it is in the Experimental group, which every built-in profile starts with off, and the writer's command for it works in any chat.
- **Extensions**: Parts of the app not every writer wants, each switched on in Settings › Extensions (there while the AI is on). The one so far is **Roleplay**: character cards (Files… reads them as cards, Import › Character card…, Chat with…, Re-import card…), the card library, the Roleplay profiles in the pickers, and its own settings (Enable NSFW chat profiles, Profile for character cards, Delete card library). Off, all of that is hidden and nothing is deleted: card folders stay, chats on a Roleplay profile keep running on it, and the card library is kept. Decided once at upgrade: on where roleplay was in use (library cards, NSFW on, a card profile chosen, a chat on Roleplay or naming a character), off otherwise; new installs start off. The RPG tools are not part of it.
- **Card library**: The writer's character cards, kept as cards outside any project: a grid of portraits to search by name, creator or tag (typing a tag's start offers `tag:` filters; the sort chosen is kept), each card shown in full, a split button that starts a New project named for the card (its card on the shelf, then straight into the Chat with questions and the chat), opens the project made for it once there is one, or adds it to the open project; the card remembers the projects it went into and its detail lists them (a folder's Import › Character card… imports into that folder); a card's right-click menu and its detail also download it (its PNG, or its JSON) or delete it. Cards tagged nsfw or nsfl show blurred pictures until the eye beside the search turns blurring off (on by default, kept). Cards also come from a link (the link button, or a link dropped on the library): a botbooru or Chub page, Chub's creator/name, or the card's own address, fetched through platform/fetch (botbooru only works in the desktop app: no CORS). Its rail button sits under Chats while Roleplay is on.
- **Trash**: Deleted documents, folders, chats and projects go to the trash without asking, kept 30 days and restorable from Projects › Trash (the outline header's hamburger, while anything is in it) or the empty view; Command-Z in the outline takes a delete back. The model's `delete_document` deletes to it too.
- **Versions**: A text document keeps versions of itself, taken after a pause in typing and before a change from outside the editor (the model, a sync, a re-imported card), thinned with age; Versions… on its menu or its tab compares one with the text and restores it.
- **Sync**: The writer's projects, setup and card library on all their devices, through a server of ours at `sync.inksprite.io` that holds them encrypted (Settings › System › Sync). An account is made with an invitation's code, under a name of a–z, digits and hyphens, with a passphrase and a recovery code; a project can be kept on one device only, or shared from its menu with friends by their friend codes (Settings › System › Sync shows this account's, once it has a name others see): everyone can write in it, only its owner shares or deletes it, the others leave it, and each one's chats in it are their own.
- **Backup**: Export is a tree of boxes: the projects (each one's documents and chats), the character cards, and the settings. Everything ticked is a whole backup, restored in place of everything; settings alone are a settings file; anything else is a selection, whose projects and cards are added beside what is there and whose settings are merged. A backup, a selection or a project is a zip (`utils/backupArchive.js`): its rows as JSON, a table in one entry or several, and each file's bytes as an entry of its own, so none of it has to fit in one string (a browser's are about 512 MB at most); a settings file and a chat are still JSON, and the JSON backups from before still import. Old backups are moved forward by migrations.

Design docs for in-progress work live in `.llm/`, which is kept on dev but left out of the published repository. `document_tree_design.md` is the current data model; `markdown_library_design.md` is where content, the editor, and storage are going; `desktop_design.md` is the desktop app, an Electron shell over the web build first and the library on disk after, and its windows, each on a project of its own; `files_design.md` is how imported files reach the tree, the viewer, and the model. `google_docs_design.md` is importing Google Docs from Drive as markdown, and syncing a document with its Doc through the Docs API, comments both ways (the converter built both ways, and the import reads Docs through it and keeps each one's base; the three-way merge and Sync built and run against Google, tables included, and a document synced to a new Doc; comments both ways built and run against Google; a Doc's suggested edits in as suggestions, settled both ways, built and run against Google; the model's out as suggestions, built). `images_design.md` is pictures in documents: each one its document's own and out of the outline, at `.images/<document id>/` beside it, pasted, dropped, inserted, or kept from a Doc or Word file on import (steps 1 to 3 built; a Doc's pictures come in through the converter too). `skills_design.md` is skills and tools: who may call them, the `/` menu, SKILL.md files in an app-wide library, and tools from MCP servers. `project_context_design.md` is what a chat's model has of the project on every turn: the writer's pins in the project block, document calls kept in the conversation, and `list_documents`. `source_code_design.md` is a codebase in a project: a repository imported from GitHub or a folder as read-only file documents, a CodeMirror viewer, and reading and searching by line. `web_search_design.md` is every tool call staying in the conversation, then the model searching the web and reading pages through a service the writer connects: Exa, Kagi, or Brave on desktop. `comments_design.md` is comments on passages, the writer's and the model's: a mark in the editor and CriticMarkup holding an id in the file, the thread (posts by author, open or resolved) on the document's row, and the tools the model reads, makes, answers and resolves them with. `suggestions_design.md` is suggestions as comments that carry a change: the model's first, through its edit tools, accepted or rejected in the Comments tab, in the text as a comment's passage is and changing nothing until accepted (the layout, the model's edit tools, accepting and rejecting, and every other reader seeing the text as it stands built; a linked Doc's suggestions come in as suggestions and are settled both ways, and the model's go to the Doc as suggestions, those within paragraphs). `speech_providers_design.md` is narration speaking through the AI connections, OpenRouter and OpenAI as well as Kokoro, each connection saying whether it chats, speaks, or both. `document_links_design.md` is links between documents: written relative to the linking document as Markdown files link to files on disk, read forgivingly, opened in a tab from the editor and the chat, and rewritten when a rename or a move would break them. `settings_import_design.md` is settings files: the writer's setup without their projects, exported and imported by hand, or left in the desktop app's data folder by a script. `scrivener_import_design.md` is importing a Scrivener 3 project: the binder as the tree, its RTF as markdown, and what is left behind. `spelling_design.md` is a spelling and grammar checker of our own in the editor, on Harper: the same in every engine, no autocorrect, and the project's names in its dictionary. `card_library_design.md` is the card library: character cards kept app-wide as cards, browsed and searched there, and copied into a project's tree when wanted; editing, export and a roleplay surface come later. `extensions_design.md` is extensions: parts of the app switched on in Settings › Extensions, Roleplay first, and how it was decided for installs that already roleplayed. `ipad_design.md` is an iPad app from the App Store, weighed and not yet decided: a Capacitor shell over the same page, made for an iPad with a keyboard, what the store's review asks, and the Home Screen app tried first. `research_design.md` is research in a chat: how many requests a connection takes at once, the model keeping a page it found (a PDF as the file it is, on desktop), explore's finding aid of every document, folder and long section, made by a job, which a chat's model or the writer's `/explore` waits on and sees in the thread (built), and investigators that read only their question under a lead that plans with the writer and writes up a note (not started). `sync_design.md` is sync: the writer's projects, setup and card library on all their devices through a server of ours that holds them encrypted, the devices merging, an app that meets a newer one's records holding its pull until it is updated, and a project shared with friends by their friend codes, each one's chats their own (built; the server in `server/`, kept out of the published repository; hosted at `sync.inksprite.io` on Google Cloud for a handful of testers, who join by an invitation's link, `server/deploy/`). `trash_design.md` is the trash: documents, chats and projects deleted to it, kept 30 days and restorable, out of sight of everything else. `versions_design.md` is a text document's versions, taken after a pause and before changes from outside the editor, thinned with age, compared and restored.

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
- **Generate docs**: `npm run docs` (done when a snapshot is published, not with each change)
- **Type check**: `npm run typecheck`
- **CI**: `npm run ci`
- **Fix CI issues**: `npm run ci:fix`

## Test Server

There is a test server container running with `docker compose` that is hot updated by Vite. After a change to the app's dependencies, or a merge that touches `package.json`, `package-lock.json`, `vite.config.js` or `index.html`, the user rebuilds it with `./rebuild-test-server.sh` from the repository root, on their Mac. Never `npm install` inside the container: those files are mounted one at a time and go stale when git replaces them.

The desktop app (`app/electron/`) runs on the user's Mac with `app/electron/start-on-mac.sh`, loading the page from the test server; see `app/electron/README.md`. npm never runs on the Mac: `npm ci` in `app/electron` happens in the container, and the script fetches the Mac's Electron itself. After a merge to dev, `app/electron/build-for-mac.sh` builds the app for the Mac in the container, and `app/electron/install-on-mac.sh` on the Mac signs it and puts it in place of the installed app.

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

### Messages

Most actions need no message: the writer sees what happened. A toast is for a result they can't otherwise see (connecting to a provider, a copy to the clipboard), a loss ("This can't be undone."), or an error they have to act on, in plain sentences: what didn't happen, then why ("The provider couldn't be reached." and the reason). An action that can't apply does nothing. A conflict is settled without asking, as sync settles one: one side wins and the other is kept as a version. A confirm guards only what can't be taken back; what goes to the trash, or that Command-Z undoes, goes ahead. Developer strings (ids, "Failed to …") go to the console, never to the writer.

### Preview features

A large feature the user wants to use for a while before it is released is merged into dev as it is built, behind a preview, rather than kept on a branch:

- Add it to `PREVIEWS` in `app/src/config/preview.js` with the day it went in, and check `inPreview('<name>')` wherever it reaches the writer or the model: menu items, commands, tools, settings, skills.
- Never put what it stores behind it. Its fields and migrations ship in every build, and only add, so a backup or a library written with the feature opens in a build without it.
- `VITE_PREVIEW` in `app/.env.local` (names, or `all`) turns previews on for the test server and the Mac dev build. The test server reads it when the container is made, so a change needs `./rebuild-test-server.sh`. The site and the released desktop app are built without that file, the guides' capture clears it, and the tests never read it, so a test of a feature in preview turns it on with `vi.stubEnv`.
- Out of preview, remove its checks and its `PREVIEWS` line, and put it in the next CHANGELOG section.

### Sync format

A synced record carries its schema and its format (`app/src/cloud/format.js`), and an app that meets a newer one holds its pull until it is updated. Raise `FORMAT` when a synced row may come to hold what an older app would lose or rewrite as it saves: the editor learning a node, a mark or an attribute (`test/cloud/format.test.js` pins them to the number), new markup in a document's text, or a field coming to mean something else. A raise holds every device not yet updated, so avoid one where an older app can carry the change through unharmed, and more so once the app is stable.

### Dev features

What is only for developing inksprite, and never released, checks `hasDevFeatures()` (`app/src/config/dev.js`), which `VITE_DEV_FEATURES=true` in `app/.env.local` turns on, read as `VITE_PREVIEW` is. So far: choosing the sync server, which is otherwise `sync.inksprite.io`.

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
- Leave the generated module docs (`app/docs/*.md` other than `index.md`) alone: they are regenerated with `npm run docs` when a snapshot is published. The generator orders some modules differently from run to run, and branches that regenerated them as they went conflicted on merge.