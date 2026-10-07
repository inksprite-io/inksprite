# inksprite Frontend Documentation

inksprite is a co-writing tool for creating fiction with AI assistance.

## Architecture Overview

The application follows a frontend-only architecture with:

- **Vue 3** with Composition API
- **Pinia** for state management
- **IndexedDB** for local storage (via Dexie)
- **Direct AI API integration** (OpenRouter and OpenAI-compatible)

## Core Modules

### Stores (State Management)

- `storiesStore` - Story CRUD operations
- `partsStore` - Story parts/acts management
- `scenesStore` - Scenes/chapters management
- `chatsStore` - AI chat sessions
- `messagesStore` - Chat message history
- `lorebooksStore` - World-building data
- `syncStore` - Database synchronization

### Services

- `storage` - LocalStorage wrapper with quota management
- `ai/` - AI provider implementations (OpenRouter, Generic OpenAI)

### Composables

- `useStories` - Story management hooks
- `useEditor` - Tiptap editor singleton
- `useAIChat` - AI chat functionality
- `useTextGeneration` - AI text generation

## Development

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Type checking
npm run typecheck

# Generate documentation
npm run docs

# View documentation
npm run docs:serve
```

## API Documentation

This documentation is auto-generated from JSDoc comments in the source code.

For more details, see the generated documentation in `docs/api/`.
