/**
 * Type definitions for InkSprite data models
 * These JSDoc typedefs are used across all store files for type checking
 */

/**
 * @typedef {Object} StoryOptions
 * @property {string} [profileId] - Profile new chats in this project are stamped from.
 *   A default, not a mode: nothing reads it once a chat exists.
 *   A default, not a mode: nothing reads it after a chat has been created, and every
 *   chat can change what it was given. Absent falls back to `promptId`; see
 *   `ai/profiles/index.js`.
 * @property {string} [promptId] - Built-in prompt new chats in this project are seeded
 *   with, written once by the template the project was created from. What `profileId`
 *   was before there were profiles, and still read when it is absent.
 * @property {string} [systemPromptWrite] - Legacy. Override for write mode system prompt
 * @property {string} [userPromptWrite] - Legacy. Override for write mode user prompt
 * @property {string} [systemPromptChat] - Legacy. Override for chat mode system prompt
 * @property {string} [systemPromptSummarize] - Legacy. Override for summarize mode system prompt
 * @property {string} [userPromptSummarize] - Legacy. Override for summarize mode user prompt
 */

/**
 * @typedef {Object} StoryLayout
 * @property {boolean} sidebar - Whether the left sidebar is showing
 * @property {boolean} editor - Whether the editor is showing
 * @property {boolean} chat - Whether the chat is showing. Never false while `editor` is.
 * @property {'outline'|'chats'|'narration'|'jobs'|'projects'} sidebarTab - Which list the sidebar is on
 */

/**
 * @typedef {Object} Story
 * @property {string} id - Unique story identifier (story_xxx)
 * @property {string} [title] - Legacy. The project's name lives on its root document;
 *   kept so stored rows written before that still parse.
 * @property {string} overview - Legacy synopsis. Migrated to the root document's `summary` at schema v7 and no longer read; the column stays as the way back.
 * @property {number} wordCount - Total word count across all scenes
 * @property {string|null} lastDocumentId - The document the writer is in: the editor's
 *   active tab, so a project reopens where they left off
 * @property {string[]} [openDocumentIds] - The documents open in the editor, in tab
 *   order. Absent means one tab, the last document; see
 *   `utils/tabs.js`.
 * @property {string|null} [previewDocumentId] - The open document that is only being
 *   looked at, whose tab the next one opened from the outline takes. Absent or
 *   null means every tab is kept.
 * @property {StoryLayout} [layout] - How the writer left the panels. Absent means the
 *   default arrangement; see `components/writer/layout/layout.js`.
 * @property {StoryNarration} [narration] - The project's voices and pronunciation
 *   hints, for reading it aloud. Absent means one default voice and no hints; see
 *   `tts/voices.js`.
 * @property {StoryOptions} [options] - Story-specific options and overrides
 * @property {number} version - Version number for conflict resolution
 * @property {number} created - Creation timestamp
 * @property {number} updated - Last update timestamp
 */

/**
 * A voice a project is read in: a name for the writer, and what the speech
 * server is asked for.
 *
 * @typedef {Object} TtsVoice
 * @property {string} id - voice_xxx, or `narrator` for the default
 * @property {string} name - What the writer calls it: Narrator, Riley
 * @property {string} voice - What the server is asked for, as written. A Kokoro mix
 *   like `af_heart+af_nicole(2)`, or a plain name.
 * @property {number} [speed] - How fast it reads; 1 when absent
 * @property {string} [color] - A hex colour its lines are known by, in the
 *   narration's list and behind the text in the editor. Absent means none.
 */

/**
 * One block given to one voice: a paragraph, or a stretch of speech in one,
 * or what stands around it. Remembered by the block's text and where it was,
 * so it can be found again after the document changes.
 *
 * @typedef {Object} SpeakerAssignment
 * @property {string} text - The block as spoken, one space between words
 * @property {number} index - Where it was among the blocks when assigned
 * @property {string} voiceId
 */

/**
 * How a project is read aloud. All of it optional: a project that has never
 * been read has none of this and reads in the default voice.
 *
 * @typedef {Object} StoryNarration
 * @property {TtsVoice[]} [voices] - Absent or empty means the one default voice
 * @property {string} [defaultVoiceId] - The voice for blocks given no speaker. Absent,
 *   or naming a voice since removed, means the first.
 * @property {string} [narratorId] - Legacy. What `defaultVoiceId` was called for its
 *   first few days; read when that is absent, never written.
 * @property {string} [hints] - Pronunciation hints, `word:say` one to a line. See
 *   `tts/hints.js`.
 */

/**
 * @typedef {Object} Part
 * @property {string} id - Unique part identifier (part_xxx or drafts_storyId)
 * @property {string} storyId - Parent story ID
 * @property {number} order - Display order (drafts always Number.MAX_SAFE_INTEGER)
 * @property {string} title - Part title (e.g., "Act 1", "Drafts")
 * @property {string} summary - Part summary/description
 * @property {number} version - Version number for conflict resolution
 * @property {number} created - Creation timestamp
 * @property {number} updated - Last update timestamp
 */

/**
 * @typedef {Object} Scene
 * @property {string} id - Unique scene identifier (scene_xxx)
 * @property {string} partId - Parent part ID
 * @property {number} order - Display order within part
 * @property {string} title - Scene title
 * @property {string} content - Scene content (HTML from Tiptap editor)
 * @property {string} summary - Scene summary
 * @property {number} wordCount - Word count for this scene
 * @property {number} version - Version number for conflict resolution
 * @property {number} created - Creation timestamp
 * @property {number} updated - Last update timestamp
 */

/**
 * A node in a story's document tree. Replaces Part and Scene: a folder is what
 * a Part was, a text document is what a Scene was. Both keep their original
 * ids, so anything already pointing at a `part_xxx` or `scene_xxx` still
 * resolves.
 *
 * @typedef {Object} Document
 * @property {string} id - doc_xxx, or a migrated part_xxx / scene_xxx / drafts_storyId
 * @property {string} storyId - Owning story
 * @property {string} parentId - Parent document id, or the storyId when at the root
 * @property {number} order - Display order among siblings
 * @property {'folder'|'text'|'file'} type - Folders hold children, text holds
 *   content, and a file is something imported — a PDF, an image — whose bytes
 *   are kept beside it (see `stores/filesStore.js`) and whose `content` is the
 *   text that could be read out of it.
 * @property {string} [mime] - Files only: the media type, `application/pdf`,
 *   `image/png`. What decides how it is shown and whether a model can be
 *   handed it.
 * @property {number} [size] - Files only: the file's size in bytes
 * @property {number} [pages] - Files only, and only for a format that has
 *   pages: how many
 * @property {boolean} [ordered] - Folders only. Ordered folders sort by `order` and
 *   accept drag-to-position. Unordered folders sort by title. Absent counts as
 *   unordered.
 * @property {string} [kind] - What this document is, when it came from somewhere
 *   with a shape of its own: `card` on the folder an imported character card
 *   became, the field's name on each of its documents, `lore` on a book. Read by
 *   the importer and the exporter and nothing else — the titles belong to the
 *   writer, so a renamed document is still found by this. Absent on an ordinary
 *   document, which is most of them.
 * @property {boolean} [hidden] - Kept from the model. A hidden document is left out
 *   of the project the AI is shown and out of reach of its tools, and so is
 *   everything under a hidden folder. Absent counts as shown.
 * @property {string} title - Document title
 * @property {string} [convertedFrom] - For a Markdown copy a conversion wrote, the
 *   document it was converted from; a later conversion of that one replaces it
 * @property {boolean} [plain] - Edited as plain text and stored as typed, never
 *   settled to what the editor can show. For prompts and the like. Absent counts
 *   as a structured document.
 * @property {string} content - Markdown; always empty for folders. For a file,
 *   the text extracted from it at import, a PDF's page by page under `[p.N]`
 *   markers — what the model reads and searches, and what a scan has none of.
 *   Stored as typed, like a plain document.
 * @property {SpeakerAssignment[]} [speakers] - Who speaks which block when the
 *   document is read aloud. An overlay on the blocks, found again by their text
 *   when the document changes; see `tts/script.js`. Absent means the default voice
 *   reads all of it.
 * @property {string} summary - Document summary
 * @property {number} wordCount - Word count; always 0 for folders
 * @property {number} version - Version number for conflict resolution
 * @property {number} created - Creation timestamp
 * @property {number} updated - Last update timestamp
 */

/**
 * The bytes behind a file document, in a table of their own so that loading
 * a project's tree does not load its papers. Keyed by the document's id, and
 * purged with it. See `stores/filesStore.js`.
 *
 * @typedef {Object} StoredFile
 * @property {string} id - The file document's id
 * @property {string} storyId - Its story
 * @property {Blob} blob - The file, carrying its media type
 */

/**
 * @typedef {Object} Chat
 * @property {string} id - Unique chat identifier (chat_xxx)
 * @property {string} storyId - Parent story ID
 * @property {string} title - Chat title
 * @property {boolean} titleSet - Whether title has been set (auto or manual)
 * @property {number|null} lastMessageAt - Timestamp of last message
 * @property {string} [description] - Chat description/purpose
 * @property {number} [messageCount] - Number of messages in chat
 * @property {string|null} [profileId] - Chat profile this chat runs on, built-in or the writer's own. Absent, or naming one since deleted, means the profile its project starts chats on.
 * @property {string|null} [promptId] - Legacy. The library prompt this chat ran on before prompts became profiles; kept as the record of what it was pointed at. See `stores/migrations/profiles.js`.
 * @property {string[]} [disabledTools] - Names of tools withheld from this chat. Absent means every registered tool is offered.
 * @property {string[]} [disabledToolGroups] - Group ids withheld from this chat, which also withholds tools added to those groups later.
 * @property {string[]} [mcpServers] - The MCP servers whose tools this chat is offered, by id, once the writer has chosen here. Absent means the servers that list the chat's profile. A server's tools are opted into rather than withheld, so a server connected later reaches no chat that did not ask for it. See mcp/servers.js.
 * @property {boolean} [projectContextEnabled] - Whether the project block rides at the tail of this conversation. Absent means it does, which is what every chat written before the switch had.
 * @property {string|null} [voiceId] - The voice this chat's messages are read aloud in, one of the project's. Absent, or naming a voice since removed, means the project's default.
 * @property {string} [rules] - The chat's author's note: standing instructions the writer keeps as they go, sent in their latest message after the project block and ahead of what they said. Starts as the profile's, combined with a card's post-history instructions for a chat on a card. Absent means none.
 * @property {string[]} [pinnedIds] - Documents whose text rides in the project block from the first turn, without the model having read them. A folder pins what is under it. Absent means none.
 * @property {string[]} [shownIds] - Documents this chat sees although a folder above them is hidden in it: a character's own folder, under the folder all the characters are in. Absent means none.
 * @property {string[]} [hiddenIds] - Documents kept from this chat's model, and everything under them unless something nearer is pinned or shown. The document's own `hidden` keeps it from every chat. See `utils/visibility.js`. Absent means none.
 * @property {string|null} [userVoiceId] - The voice this chat's own messages are read aloud in, one of the project's. Absent means the same voice everything else is read in.
 * @property {number} version - Version number for conflict resolution
 * @property {number} created - Creation timestamp
 * @property {number} updated - Last update timestamp
 */

/**
 * Tool call from the model (OpenAI format)
 * @typedef {Object} ToolCall
 * @property {string} id - Unique call ID
 * @property {'function'} type - Call type (always 'function')
 * @property {Object} function - Function call details
 * @property {string} function.name - Function name
 * @property {string} function.arguments - JSON string of arguments
 */

/**
 * Reasoning detail entry from OpenRouter extended thinking
 * @typedef {Object} ReasoningDetail
 * @property {string} type - Type of reasoning (e.g., 'reasoning.text')
 * @property {string} [text] - Reasoning text content
 * @property {string} [signature] - Cryptographic signature for continuation
 * @property {string} [format] - Format identifier (e.g., 'anthropic-claude-v1')
 * @property {number} index - Index in the reasoning chain
 */

/**
 * API message format. One entry per actual model invocation or tool result
 * within an assistant turn. Assistant entries carry only the text streamed
 * during that iteration (delta, not cumulative).
 *
 * @typedef {Object} ApiMessage
 * @property {'assistant'|'tool'} role - Message role
 * @property {string|null} content - Message content (delta for that iteration)
 * @property {ToolCall[]} [tool_calls] - Tool calls (for assistant messages requesting tools)
 * @property {string} [tool_call_id] - Tool call ID this is responding to (for tool result messages)
 * @property {ReasoningDetail[]} [reasoning_details] - Reasoning blocks (intra-turn continuation only; stripped on replay)
 * @property {string} [_document] - The document a read put in front of the model. Ours, not the API's, like `_path` and `_hash`: stripped before the message is sent. See ai/context/reads.js.
 * @property {string} [_path] - The path the document was read at
 * @property {string} [_hash] - A hash of the text the read saw, for telling whether the document has changed since
 * @property {string} [_reasoning] - What the model thought during this iteration. Ours, not the API's: the service renames it to whatever the backend calls the field, or drops it. Intra-turn only, so it is never stored on a trajectory.
 * @property {Consultation} [_consultation] - On a skill's result: what the skill did on its way to the answer, for the turn to show. Ours, not the API's: stripped before the message is sent, like `_document`.
 * @property {true} [_dropped] - On a `use_skill` result: the writer dropped what it loaded, so it is not carried past a summary. Sent back where it is until then. See ai/skills/loads.js.
 */

/**
 * What a skill did on its way to its answer, kept beside the answer for the
 * writer to read.
 *
 * @typedef {Object} Consultation
 * @property {string} [thinking] - What it thought, when the model thinks
 * @property {ConsultedCall[]} calls - The tools it called, in order
 * @property {boolean} [reply] - It wrote the turn's reply, which is the
 *   message's content. Its thinking is then the message's too, after the
 *   turn's own, so it is not kept here as well.
 *
 * @typedef {Object} ConsultedCall
 * @property {string} name - The tool
 * @property {string} arguments - What it was asked, as the model wrote it
 * @property {string} result - What it answered, cut short when long
 * @property {Consultation} [consultation] - When the tool was itself a skill: what that one did
 */

/**
 * Token usage for one assistant turn, which may span several requests when
 * tools are called.
 *
 * @typedef {Object} TurnUsage
 * @property {number} promptTokens - Context size of the turn's final request
 * @property {number} completionTokens - Generated tokens, summed over requests
 * @property {number} requests - Model invocations in the turn
 */

/**
 * A tool the writer ran themselves, from the chat, with no inference involved.
 *
 * `input` and `param` are kept as typed rather than as parsed, because
 * rerunning has to ask the same question, and because they are what the writer
 * is given back when they edit one. `label` and `result` are what the model is
 * shown; `detail` is the working — the likelihood a question was asked at, the
 * dice behind a total — and stays in front of the writer, who chose it.
 *
 * @typedef {Object} ChatCommand
 * @property {string} name - The command that was run
 * @property {string} input - Everything the writer typed after the name, verbatim
 * @property {string} [param] - What was in the parentheses, for the commands that take something there
 * @property {true} [character] - Set when this is somebody speaking rather than something answering. See ai/commands.js.
 * @property {true} [prompt] - Set when this is a saved prompt: a skill's instructions, filled in with what the writer typed, as their words. Read off the record, like `character`, so it still reads as one after its skill has gone. See `savedPrompt` in ai/commands.js.
 * @property {true} [load] - With `prompt`: the skill is one the model could load too, so this loaded it for the rest of the chat — carried past a summary, listed as loaded, droppable. See ai/skills/loads.js.
 * @property {true} [dropped] - A load the writer dropped: read where it is, and not carried past a summary. See ai/skills/loads.js.
 * @property {string} [label] - The question, as the model reads it, when there was one. A direction the writer simply gave asked nothing.
 * @property {string} [detail] - The working, for the writer only, when it is something that happened rather than something derivable. What to show is `commandDetail` — the oracle's odds are read back off `param`.
 * @property {string} result - What came back, empty while a consulting command is still asking
 * @property {boolean} [pending] - Set while a command that costs a model call is running
 * @property {string} [reasoning] - What it thought on the way to the answer, for the reader. Streamed in as it arrives.
 * @property {number} [thought] - How long it thought, in milliseconds, measured to the first word of the answer
 * @property {string} [error] - Why there is no result, when there is none
 * @property {number} [keep] - Compaction only: how many turns the summary was put above when it was asked for, which it read all the same. The summary's place in the chat is what says what it stands for; this is how to ask it again over the same conversation, and how far to move it when the writer changes the count. See ai/compaction.js.
 */

/**
 * What the Director did before the assistant wrote, when the turn consulted it
 * rather than leaving the call to the model.
 *
 * The reasoning is kept for the reader, not for the model: the Game Master is
 * handed `direction` and nothing else, because the whole point of a Director is
 * that its working stays out of the narration. Here it is the only way to see
 * why a direction came out the way it did.
 *
 * @typedef {Object} DirectorNote
 * @property {boolean} [pending] - Set while the call is in flight, cleared by the answer
 * @property {string} [reasoning] - What the Director thought on its way to the direction
 * @property {string} [direction] - What it told the Game Master
 * @property {string} [error] - Why there is no direction, when there is none
 */

/**
 * One of a message's answers.
 *
 * A message asked again keeps what it said, and can be turned back to it.
 * Each answer is what one generation wrote to the message — its words, its
 * thinking, when it was written, and its record of what it did — and nothing
 * about where the message sits in its chat, which is the same for all of
 * them. The message's own fields are always the answer it is showing; see
 * `selectAlternate` in stores/messagesStore.js.
 *
 * @typedef {Object} MessageAlternate
 * @property {string} content
 * @property {string|null} [reasoningContent]
 * @property {number|null} [streamingStartTime]
 * @property {number|null} [streamingFinishTime]
 * @property {number|null} [thinkingFinishTime]
 * @property {number|null} [thinkingTime]
 * @property {boolean} [edited]
 * @property {number|null} [editedAt]
 * @property {MessageMetadata|null} [metadata]
 */

/**
 * One thing a turn was made of.
 *
 * A submission is not always one thing: the writer rolls an oracle, says what
 * their character does, and tells the Director the scene has gone on long
 * enough. That is one turn — one speaker, taken in pieces — and the pieces are
 * these. See ai/commands.js.
 *
 * @typedef {{type: 'text', content: string}|{type: 'command', command: ChatCommand}} MessageSegment
 */

/**
 * A change a turn's tool made to a document, kept so the turn can be undone.
 *
 * The pair is the smallest cut the two versions allow (see utils/edits.js):
 * undoing it finds `new` and puts `old` back, which survives the writer's own
 * edits elsewhere and refuses when they have edited the passage itself. A
 * creation carries what it created; undoing it removes the document, if the
 * document still says that.
 *
 * @typedef {Object} DocumentEdit
 * @property {string} id - Names the change, so a decision made on it while the turn is still writing survives the turn's next write
 * @property {string} documentId
 * @property {string} path - Where the document was when it changed, for the writer
 * @property {string} tool - Which tool made the change
 * @property {string} old - The passage as it was; empty for an append or a creation
 * @property {string} new - The passage as the tool left it; the whole body for a creation
 * @property {'proposed'|'accepted'|'rejected'} [status] - Set when the chat asks the writer first: proposed until they decide. Absent means the change went straight in. While proposed, `old` and `new` are the tool's own arguments, since they are what applies it; accepted, they become the pair that was applied.
 * @property {string} [summary] - A proposed creation's summary, to give the document when it is created
 */

/**
 * Message metadata structure.
 * @typedef {Object} MessageMetadata
 * @property {ChatCommand} [command] - The tool this message is a record of, when the writer ran one themselves rather than typing a message
 * @property {DirectorNote} [director] - The Director's turn, when this chat runs it before the assistant
 * @property {TurnUsage} [usage] - Token usage reported by the provider, when it reports any
 * @property {string} [model] - Which model wrote this answer, as its provider names it. On the answer rather than the chat, because a chat changes presets as it goes and asking again on another one is half the reason to ask again. Absent on anything written before this was kept, and on a turn nobody generated.
 * @property {string} [provider] - Where that model ran, by the name the writer gave the provider — the same model behind two of them is not the same thing. For a chat brought in from SillyTavern, the API it says it used.
 * @property {DocumentEdit[]} [documentEdits] - What this assistant turn's tools changed in the project, in the order they changed it. Rewinding past the turn undoes them, newest first.
 * @property {ApiMessage[]} [apiTrajectory] - The model's full per-iteration trajectory for this assistant turn (assistant deltas + tool calls + tool results + trailing assistant text). The record of what the turn called: the tool call panel shows it, the context builder sends its document calls back on every later turn (when `documentCallsKept`), its skill loads always, and its dice and oracle calls for recent turns, all without their text. A past turn's words go back as its content. See ai/context/build.js.
 * @property {true} [documentCallsKept] - This turn's document calls go back with the conversation. Set on every turn written since they began to; a turn from before keeps going back as it did. See ai/context/reads.js.
 * @property {import('../ai/context/build.js').ChatMessage[]} [context] - The request that opened this turn, kept only while the Debug setting is on. Everything the turn went on to append is in apiTrajectory.
 */

/**
 * A tool call the model is still writing, as far as it has got.
 *
 * @typedef {Object} PendingToolCall
 * @property {string} id - The call's id, once the stream has said it
 * @property {string} name - Tool name
 * @property {string} arguments - The arguments JSON so far, likely cut off
 */

/**
 * @typedef {Object} Message
 * @property {string} id - Unique message identifier (message_xxx)
 * @property {string} chatId - Parent chat ID
 * @property {'user'|'assistant'} role - Message sender role
 * @property {string} content - What the model is sent. For a message with segments this is assembled from them and never written by hand; see `assembleTurn`.
 * @property {MessageSegment[]} [segments] - What the turn was made of, when it was made of more than prose. The writer's side only: a consultation is one speaker saying one thing and carries its record in `metadata.command` instead.
 * @property {string|null} [reasoningContent] - AI reasoning content (for assistant messages)
 * @property {number|null} [streamingStartTime] - Timestamp when streaming started
 * @property {number|null} [streamingFinishTime] - Timestamp when streaming finished
 * @property {number|null} [thinkingFinishTime] - Timestamp when thinking/reasoning finished
 * @property {number|null} [thinkingTime] - How long the turn spent thinking, in milliseconds, over every round it thought in. A turn that calls tools thinks again after each result, so this is the sum and not the time until thinking first stopped. Absent on turns from before it was kept, which read it as `thinkingFinishTime - streamingStartTime`.
 * @property {PendingToolCall[]} [pendingToolCalls] - The calls the model is writing or the app is running right now, for the chat to show. In-flight only: cleared as each round's results land and when the turn ends.
 * @property {MessageAlternate[]} [alternates] - Every answer the message has had, in the order they were asked for, the one it is showing among them. Only once it has been asked again; a message answered once has none.
 * @property {number} [alternate] - Which of them it is showing.
 * @property {boolean} [edited] - Whether the message has been edited
 * @property {number|null} [editedAt] - Timestamp when edited
 * @property {MessageMetadata|null} [metadata] - Additional message metadata
 * @property {number} version - Version number for conflict resolution
 * @property {number} created - Creation timestamp
 * @property {number} updated - Last update timestamp
 */

/**
 * @typedef {Object} Lorebook
 * @property {string} id - Unique lorebook identifier (lorebook_xxx)
 * @property {string} storyId - Parent story ID
 * @property {string[]} categories - List of categories in this lorebook
 * @property {number} version - Version number for conflict resolution
 * @property {number} created - Creation timestamp
 * @property {number} updated - Last update timestamp
 */

/**
 * @typedef {Object} ActivationKey
 * @property {string} key - Activation keyword
 * @property {boolean} caseSensitive - Whether the keyword is case sensitive
 * @property {'word'|'prefix'|'substring'} matchType - Match type
 */

/**
 * @typedef {Object} LoreEntry
 * @property {string} id - Unique entry identifier (lore_xxx)
 * @property {string} lorebookId - Parent lorebook ID
 * @property {string} name - Entry name/title
 * @property {string} category - Entry category (characters, locations, items, concepts etc.)
 * @property {string} description - Short description of the entry
 * @property {string} content - Full entry content/description
 * @property {ActivationKey[]} activationKeys - Keywords that trigger this entry
 * @property {boolean} enabled - Whether entry is active
 * @property {boolean} includeInPrompt - Whether to include in AI prompts
 * @property {number} version - Version number for conflict resolution
 * @property {number} created - Creation timestamp
 * @property {number} updated - Last update timestamp
 */

/**
 * @typedef {Object} Change
 * @property {string} entityType - Database table name
 * @property {string} id - Entity ID
 * @property {'put'|'delete'} op - Write the row, or remove it
 * @property {any} data - Changed data; null for a removal
 * @property {number} timestamp - Change timestamp
 */

/**
 * @typedef {Object} StoreState
 * @property {Map<string, any>} items - Map of items by ID
 * @property {boolean} isInitialized - Whether store is initialized
 * @property {Promise|null} initializePromise - Initialization promise
 */

/**
 * @typedef {Object} AIProvider
 * @property {string} id - Unique provider identifier (provider_xxx)
 * @property {string} name - User-friendly name for the provider
 * @property {'openrouter'|'llamacpp'|'generic'} type - Provider type. See ai/providers.js.
 * @property {string} [endpoint] - API endpoint URL, for every type but OpenRouter
 * @property {string} [apiKey] - API key for authentication
 * @property {boolean} [rememberKey] - Whether to persist API key in IndexedDB (default true). If false, key is stored in sessionStorage only
 * @property {import('../ai/routing.js').OpenRouterRouting} [routing] - OpenRouter provider routing policy. Absent means the defaults: no data collection, zero-data-retention endpoints only.
 * @property {boolean} [isDefault] - Whether this is a default provider (cannot be deleted)
 * @property {number} version - Version number for conflict resolution
 * @property {number} created - Creation timestamp
 * @property {number} updated - Last update timestamp
 */

/**
 * @typedef {Object} AIPreset
 * @property {string} id - Unique profile identifier (profile_xxx)
 * @property {string} [type] - Profile type (legacy, retained for stored data compatibility)
 * @property {string} name - Profile name
 * @property {string} providerId - ID of the AI provider to use
 * @property {string} model - Model identifier
 * @property {boolean} [toolsEnabled] - Whether the model may call tools. Undefined is treated as enabled.
 * @property {import('../ai/defaults.js').AISettingsOverrides} [generationOverrides] - Sparse overrides on AI_DEFAULTS (sampler params, seed, max tokens, reasoning). Absent keys fall back to the defaults.
 * @property {boolean} isDefault - Whether this is a default profile
 * @property {number} version - Version number for conflict resolution
 * @property {number} created - Creation timestamp
 * @property {number} updated - Last update timestamp
 */

/**
 * A chat profile the writer saved: how a chat is run, in one place.
 *
 * The built-in profiles ship as source (`ai/profiles/index.js`); these are the
 * writer's own. `settings` is the same shape either way — see `ProfileSettings`
 * there — so nothing downstream has to know which kind it was handed.
 *
 * The prompt library's rows became these and kept their ids, which is why some
 * of them are `prompt_xxx` rather than `chatprofile_xxx`. See
 * `stores/migrations/profiles.js`.
 *
 * @typedef {Object} StoredChatProfile
 * @property {string} id - chatprofile_xxx, or a migrated prompt_xxx
 * @property {string} name
 * @property {import('../ai/profiles/index.js').ProfileSettings} settings
 * @property {number} version
 * @property {number} created
 * @property {number} updated
 */

/**
 * One of the writer's own skills, as the library keeps it: the SKILL.md itself,
 * and the other files that came with it. The text is the skill; see
 * `ai/skills/format.js`.
 *
 * @typedef {Object} StoredSkill
 * @property {string} id - skill_xxx
 * @property {string} name - The name the text gives it, kept beside the text so
 *   the library can be looked up and kept unique without reading every file
 * @property {string} text - The SKILL.md
 * @property {SkillFile[]} files - The rest of its folder that is text
 * @property {number} version
 * @property {number} created
 * @property {number} updated
 *
 * @typedef {Object} SkillFile
 * @property {string} path - Where it sits in the skill's folder, e.g. `references/voice.md`
 * @property {string} content
 */

/**
 * An MCP server the writer has connected, app-wide like their skills.
 *
 * @typedef {Object} McpServer
 * @property {string} id - mcp_xxx
 * @property {string} name - What the writer calls it
 * @property {string} prefix - What its tools' names start with, made from the
 *   name when it was added and kept through renames. See mcp/names.js.
 * @property {string} [url] - Where it answers
 * @property {Record<string, string>} [headers] - Sent with every request: an
 *   API key, usually. Rides in backups, as a provider's key does.
 * @property {'oauth'} [auth] - How the writer signs in to it, when they do. The
 *   sign-in itself is kept in this browser and never here; see mcp/auth.js.
 * @property {string} [command] - For one that runs as a local program, which
 *   a page cannot start: kept so the writer can see it needs a bridge
 * @property {string[]} [args]
 * @property {McpTool[]} tools - Its tools as last listed
 * @property {McpPrompt[]} prompts - Its prompts as last listed
 * @property {string[]} profiles - The chat profiles whose chats use it, unless
 *   a chat chooses otherwise
 * @property {string[]} allowed - Its tools the writer always allows, by their
 *   own names, so a call to one runs without asking
 * @property {boolean} [allowAll] - The writer always allows every tool it has,
 *   the ones it adds later included, so none of its calls asks
 * @property {number} [listedAt] - When its tools were last listed
 * @property {string} [error] - Why it could not be listed, the last time it was tried
 * @property {number} created
 * @property {number} updated
 */

/**
 * A tool a server offers, as it described it.
 *
 * @typedef {Object} McpTool
 * @property {string} name - The server's name for it
 * @property {string} exposed - The name the model calls it by. See mcp/names.js.
 * @property {string} [title]
 * @property {string} [description]
 * @property {Object} inputSchema - JSON Schema for its arguments
 * @property {{readOnlyHint?: boolean, destructiveHint?: boolean, title?: string}} [annotations]
 */

/**
 * A prompt a server offers.
 *
 * @typedef {Object} McpPrompt
 * @property {string} name
 * @property {string} [title]
 * @property {string} [description]
 * @property {Array<{name: string, description?: string, required?: boolean}>} [arguments]
 */

/**
 * A named system prompt the user has saved. App-wide rather than per-story, so
 * the same prompt can be loaded into any chat.
 *
 * @typedef {Object} AIPrompt
 * @property {string} id - Unique prompt identifier (prompt_xxx)
 * @property {string} name - Display name, e.g. "Adventure" or "Editor"
 * @property {string} content - The prompt text
 * @property {number} version - Version number for conflict resolution
 * @property {number} created - Creation timestamp
 * @property {number} updated - Last update timestamp
 */

/**
 * One step of a long job.
 *
 * @typedef {Object} JobStep
 * @property {string} id - Names the step within its job; a conversion's chunk id
 * @property {string} label - What the panel shows: `Pages 12–19`
 * @property {'pending'|'running'|'done'|'failed'} status
 * @property {string} [output] - What the step produced, kept so the job resumes past it
 * @property {string} [error] - Why it failed, when it did
 * @property {number} [tokens] - What the step cost, when the provider said
 */

/**
 * A long job a model does for a project over many requests.
 *
 * @typedef {Object} Job
 * @property {string} id - job_xxx
 * @property {string} storyId
 * @property {string} kind - Which kind of job; `convert`
 * @property {string} workflow - The workflow whose model runs it; see application state `workflows`
 * @property {string} [documentId] - The document it works on, when it works on one
 * @property {string} title - What the panel calls it
 * @property {'queued'|'running'|'paused'|'done'|'failed'|'cancelled'} status
 * @property {JobStep[]} steps - In order; the runner takes the first not done
 * @property {any} [plan] - What the kind planned from: a conversion's chunks and the text they index
 * @property {string} [error] - Why the job failed, when it did
 * @property {number} [elapsed] - How long it has run, in ms, over every run up to the last stop;
 *   the run in hand adds its own time from `jobs/live.js`
 * @property {number} created
 * @property {number} updated
 */

/**
 * Which model a workflow runs on: long work with needs of its own — a
 * conversion, later a summary — that may want a stronger or a cheaper model
 * than a chat does.
 *
 * @typedef {Object} WorkflowSettings
 * @property {string|null} providerId - The provider the workflow runs on; null for the active preset's
 * @property {string|null} model - The model; null for the active preset's
 * @property {string|null} [reasoningEffort] - How hard the model thinks: `disabled`, `enabled`, `low`, `medium`, `high`;
 *   null for the app's default (`AI_DEFAULTS.reasoningEffort`)
 * @property {boolean} [onImport] - Convert only: convert every file with text as it is imported
 */

// Export empty object to make this a module
export {}
