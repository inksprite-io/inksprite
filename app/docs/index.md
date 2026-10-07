# inksprite API Documentation

## Overview

inksprite is a co-writing tool for creating fiction with AI assistance. This documentation covers the frontend application's architecture, state management, services, and utilities.

## Module Documentation

### 📦 [Stores](./stores.md)

State management layer using Pinia stores. Handles all data persistence with IndexedDB including stories, their document trees, and chats.

### 🎨 [Composables](./composables.md)

Vue 3 composables for reusable application logic:

- AI: a chat turn, the AI preset, the chat profiles a chat runs under, summaries
- Cards: a character card looked at and then written, and a chat started on one
- Data: a story's document tree, chat sessions, whole-database backup, project export and import
- Narration: a project read aloud, its voices, and a document's speakers; a chat message read then and there
- UI: the editor, toasts, screen size

### 🛠️ [Utils](./utils.md)

Utility functions and helpers:

- Markdown rendering
- Word counting and text formatting
- Backup file building and validation
- LocalStorage and sessionStorage wrappers
- Folding a chat's messages into turns

### ✍️ [Editor](./editor.md)

The document model:

- The closed schema a document can hold, and the extensions the editor runs on
- Markdown as the file format: `parseMarkdown` and `serializeMarkdown`
- GFM tables: made by typing a header row, edited from the keyboard and a menu

### 🔊 [TTS](./tts.md)

A document read aloud by a speech server, in the project's voices:

- Blocks to be spoken, a paragraph each, and who speaks each, as an overlay that survives edits
- Each block signed by what is said and in whose voice, so audio is kept a piece at a time
- Pronunciation hints, voice colours, the speech client, and WAV clips joined into one track

### 🤖 [AI](./ai.md)

Everything a request is made of, and the skills it can be handed to:

- The messages a turn sends, the request a provider sees, and the settings it is sampled with
- The chat profiles a chat runs under, and the skills a turn hands work to, each a SKILL.md
- The tools the model can reach, the registry it finds them in, and the commands the writer types

### 🃏 [Cards](./cards.md)

Character cards and lorebooks, read into the project as documents:

- The card hidden in a PNG's text chunks, and the JSON a card or a book arrives as
- V1, V2, V3 and SillyTavern's own World Info export flattened to one shape
- That shape written into the tree: a folder of documents, with the card kept whole in a hidden sidecar

### 📎 [Files](./files.md)

Files that are not prose — PDFs, images, anything — brought into the project as documents:

- A PDF's text read out page by page with pdf.js, on demand, so a paper is a document the model can read, search and pin
- A file looked at before it is written: its media type, its size, and what text is in it
- The document written into the tree, with its bytes kept in a table of their own

### 💻 [Source](./source.md)

A codebase in a project, to write about rather than edit:

- A repository from a folder in either build, or from GitHub in the desktop app, read as one archive
- What comes in: never version control, packages or secrets; not by default build output, lock files or minified code; and the codebase's own `.gitignore` files
- Each file a read-only document titled by its filename, its text the file, refreshed in place by path so a chat that read one hears it changed
- Shown with CodeMirror, and read and searched by the model by line

### ☁️ [Drive](./drive.md)

Files picked in the writer's Google Drive, brought into a folder of the project:

- Google's sign-in with its picker and `drive.file`, so only what the writer picks is reachable: a popup in a browser, the system browser in the desktop app, and nothing of Google's loaded in the page
- A Doc exported as markdown, a Sheet as CSV, Slides as a PDF, a Drawing as a PNG, and anything else downloaded as it is, then imported as from disk
- A Doc's pictures taken out before the importer sees it, and counted
- Offered only when the build names a Google client for where it runs

### 🔌 [MCP](./mcp.md)

Tools from MCP servers the writer connects, offered to the model in their chats:

- The connection, from the page: the SDK loaded on first use, one connection per server, and plainly said why one failed
- Which chats use which server, opted into per profile or per chat, and which calls wait for the writer to allow them
- Signing in to a server that wants it, with OAuth and PKCE in a tab of its own, kept in the browser and out of backups
- What a server's tools are called to the model, and servers from a pasted `mcpServers` block

### 🖥️ [Platform](./platform.md)

What differs between the app in a browser and the app in its desktop window (Tauri, in `src-tauri/`):

- Requests to servers: the page's own in a browser, made from the native side in the desktop app, where no server refuses them for their origin

### 🧩 [Components](./components.md)

Vue components for the application UI:

- Common shared components
- Home page and dashboard
- Writer interface and editor
- Icon system

### 🚦 [Router](./router.md)

Vue Router configuration:

- Application routes
- Navigation patterns

### 📝 [Types](./types.md)

Type definitions and JSDoc typedefs:

- Data model types
- Composable interfaces
- Service type definitions

## Quick Start

```javascript
// Import from module indexes for convenience
import { useStoriesStore, useDocumentsStore } from '@/stores'
import { useDocuments, useToast } from '@/composables'
import { renderMarkdown } from '@/utils'

// A story's tree, shaped for the UI
const documents = useDocuments(storyId)
await documents.init()
const chapters = documents.childrenOf(`manuscript_${storyId}`)
documents.setContent(chapters[0].id, '# Chapter One')

const toast = useToast()
```

## Architecture

```
Frontend (Vue 3 + Vite)
├── Components (Vue SFC)
│   ├── Common - Shared UI components
│   ├── Home - Dashboard and story list
│   └── Writer - Editor and writing tools
├── Stores (Pinia + IndexedDB)
│   ├── Stories, Documents
│   ├── Chats, Messages
│   └── AI presets, chat profiles
├── Composables (Composition API)
│   ├── AI: useAIChat, useAIConfig, useProfiles, useAISummarize
│   ├── Cards: useCardImport, useCardChat
│   ├── Import: useBulkImport, useRepositoryImport, useDriveImport
│   ├── Data: useDocuments, useChats, useBackup, useNarration, useSpeech
│   └── UI: useEditor, useToast
├── TTS (src/tts)
│   ├── script - Blocks to be spoken, and the speakers overlay
│   ├── reading - What each block is asked for, its signature, and what a run reads
│   ├── hints - Pronunciation hints
│   ├── voices - The project's voices, their colours, and the default
│   ├── highlight - Where each speaker's lines are, for the editor to colour
│   ├── client - The speech server, in the OpenAI shape
│   ├── wav - Clips joined into one track
│   └── player - Audio handed to the page to play
├── AI (src/ai)
│   ├── context - Builds the messages a request is made of
│   ├── wire - The request, as a provider should see it
│   ├── prompts - System prompts, as markdown
│   ├── profiles - How a chat is run: its prompt, tools, and its wording for each skill
│   ├── tools - What the model can do, and the registry it is found in
│   └── skills - The registry of skills, each a SKILL.md and its code, and the format they are read from
├── MCP (src/mcp)
│   ├── client - The connection to a server, from the page
│   ├── auth - Signing in to a server, the way the spec has it
│   ├── servers - The connected servers, which chats use them, which calls ask first
│   ├── names - What a server's tools are called to the model
│   └── config - Servers from a pasted mcpServers block
├── Platform (src/platform)
│   └── fetch - Requests to servers, from the page or from the desktop app's native side
├── Source (src/source)
│   ├── rules - What of a codebase comes in, and what is left out
│   ├── gather - Its files listed, sorted by the rules, read, and capped
│   ├── github - A repository downloaded as one archive
│   └── write - The repository written into the tree, and refreshed by path
├── Drive (src/drive)
│   ├── config - The build's Google client, and whether the import is offered
│   ├── signIn - Google's sign-in with its picker, in a popup or the system browser
│   ├── fetch - A picked file looked up and fetched as a File: exported or downloaded
│   ├── images - A Doc's pictures taken out of its markdown
│   └── errors - What stops an import, said for the writer
├── Cards (src/cards)
│   ├── png - The character card hidden in a PNG's text chunks
│   ├── card - A card or a lorebook as one shape, whatever version it arrived as
│   └── write - That shape, written into the project as documents
├── Utils (Pure Functions)
│   ├── Text: formatters, markdown, wordCount, storyParser
│   ├── Data: backup, routeHelpers
│   └── Storage: localStorage wrapper
├── Router (Vue Router)
│   └── Application routes
├── Types (JSDoc Typedefs)
│   └── Type definitions
└── Scripts (Node, run through vite-node)
    └── chat-harness - Runs a turn against a real endpoint, from the terminal
```

## Type Checking

The codebase uses JSDoc annotations for type safety without TypeScript:

```bash
npm run typecheck  # Check all JavaScript with JSDoc types
```

## Generating Documentation

```bash
npm run docs       # Generate all module docs
```

Individual modules can be regenerated:

```bash
npm run docs:stores
npm run docs:composables
npm run docs:utils
npm run docs:tts
npm run docs:components
npm run docs:router
npm run docs:types
```
