# Changelog

<!--
One section per release, headed with its tag and written when it is
published, not with each change. The release workflow puts the section
for its tag at the top of the release's notes.
-->

## v0.1.0-dev.16

Projects always in a folder in the desktop app, and a Projects menu atop
the outline.

- The desktop app keeps every project in its folder, and the switch for
  it is gone. Projects the app kept inside itself move into the folder
  the first time it opens, with a toast that shows how far they've got.
  Show in Finder (Show in Explorer, Show folder) is always beside Export
  and Import in Settings › System.
- Closing the desktop app just after typing no longer loses the last
  few words. The window waits for them to be saved.
- Projects, a menu at the top left of the outline, has Switch project,
  New project and Import project, and the open project's settings,
  export and delete. The plus at the top of the outline now starts a
  document, and Import beside it brings files into the project.
- An image in a reply is shown as a link to it. A page the model read
  could otherwise have it show an image whose address carries your
  words away, without a click.
- The app runs only its own scripts, in the browser and in the desktop
  app.
- Some MCP servers couldn't be signed in to on app.inksprite.io. They
  can now.

## v0.1.0-dev.15

Settings files, and Export and Import in one place.

- A settings file carries your setup without your projects: AI
  connections, presets, chat profiles, MCP servers, skills, web search,
  and the choices made in Settings. Use one to set up another browser
  or the desktop app, or to share your setup.
- Export backup and Import backup in Settings › System are now Export
  and Import. Export asks what to save: Everything, as a backup did, or
  Settings, with a list to untick from. Keys stay out unless you
  include them. Import knows which kind of file it was given.
- Importing a settings file says what it adds and changes, and asks
  before going on. Nothing you have is removed, and a key the file
  left out keeps yours, unless the file moves that connection or
  server to another address.
- In the desktop app, a settings file copied to
  inksprite-settings.json in the app's data folder is imported as the
  app opens. Each time, only what the file changed since is imported,
  so a script can set up the app for a team while each person's own
  changes stay.
- The welcome has no AI tab once the AI is set up.
- Connecting an MCP server shows its name and how many tools it has,
  and opens to list them. Keep it takes Connect's place.

## v0.1.0-dev.14

Chat changes kept in the chat, roleplay settings of their own, links
between documents, Word imports, and a page for every feature.

- A change to a chat's settings stays in that chat, the system prompt
  and a skill's wording included. Save to profile, beside the
  profile's name, appears while the chat differs from its profile.
  Saving to a built-in profile makes a copy, such as "Default -
  Custom", and chats that would have started on the built-in start on
  the copy. New profile copies the chat's settings, and Reset to
  profile puts the chat back.
- Settings › System has a Chats group: the profile new chats start on,
  the profile character cards start on, and the NSFW switch.
- A roleplay chat's settings have a Roleplay section: the names
  {{user}} and {{char}} become, and a card's system prompt and
  post-history instructions. They're sent after the chat's own prompt
  and note, so a card no longer replaces the profile's rules of play,
  and no longer makes a profile named after itself.
- Documents can link to each other with ordinary Markdown links, as
  files in a folder do. A link opens its document in a tab, and the
  model links documents in what it writes.
- The model can rename and move documents and folders, into folders
  that already exist. Rewind puts them back. When it rewrites a whole
  document, the writer's comments on passages it kept stay on them.
  Rewind also removes a folder a turn made.
- A Word (.docx) file imports as a document you edit, from disk or
  from Google Drive. An imported web page opens as its article.
- The code viewer has Find.
- A command's turn keeps its Ask again, Edit and Delete buttons.
  Regenerating an earlier reply, or sending an earlier turn again,
  asks first when later turns would go.
- A backup carries the settings kept in the browser, such as the
  theme and the default preset, and restoring one names the keys it
  left out.
- Names with numbers sort by value: Chapter 2 before Chapter 10. A
  folder switched from hand-made order to names and back gets its
  order back.
- Inline code is on Command-E (Ctrl-E).
- Chat previews show plain words, and a chat whose first turn was a
  command is named after its answer.
- The skill form asks who can call a skill in one choice, and has one
  argument description.
- A Kokoro voice can still be a mix; other speech models offer a list
  of their own voices.
- In the desktop app, switching on Keep projects in a folder moves the
  projects with the app open, with a progress bar.
- Import messages, backup hints and delete confirmations are shorter
  and plainer. Refreshing a GitHub repository is offered only in the
  desktop app, where it works.
- The docs site has a research guide, a page on AI providers, and a
  page for each feature.

## v0.1.0-dev.13

Claude, OpenAI and local servers built in, narration through them, and
three guides.

- Anthropic, OpenAI, LM Studio, Ollama, llama.cpp, vLLM and KoboldCpp
  are built in beside OpenRouter, each local server at the address it
  listens on unless told otherwise, so connecting one is choosing it
  and a model. A hosted service needs only its key. Claude is spoken to
  through Anthropic's own API, its thinking shown and handed back on
  later rounds, and its prompts cached.
- The generation settings show only what the connection and model
  take, and only those are sent; a stored choice a model can't take is
  sent as the nearest it can. The reasoning effort menu gains Minimal,
  Extra high and Max for the models that have them. Max tokens and
  Tool rounds say Unlimited at 0.
- A server is asked for its models on Connect and Refresh, not as its
  address is typed. A chat on a service with no key says where to add
  it.
- Narration speaks through the AI connections: Kokoro is built in, and
  OpenRouter and OpenAI speak too. A project picks its connection and
  speech model at the top of the narration panel's Voices, and
  Settings › Narration is gone. In the desktop app, a project kept in
  a folder keeps its audio there.
- The narration panel has a player of its own and lists its segments
  in a Segments section, with Generate, Generate a sample and
  Regenerate all as buttons. Filters take regular expressions for what
  to leave unread, such as page numbers and reference marks.
  Pronunciation has a Preview, and the panel shows whole with no
  document open. A current Kokoro-FastAPI's voices are listed again.
- A turn's buttons are in a row under it, on the right, with a reply's
  other answers beside Regenerate. Sending the writer's turn again
  keeps the reply as another answer.
- A chat's system prompt and author's note open in a tab of the
  editor, from their fields in the chat's settings.
- Interpret and Write are in an Experimental group, off on every
  built-in profile and on existing chats and profiles; switched on,
  the model can call Write. Roleplay profiles start with the document
  tools on, so a card's lorebook is looked up rather than carried
  whole. Two dice rolls in one round both roll.
- The welcome is laid out as the settings are, with the AI settings
  and the Terms of Service, which are agreed to beside Start writing.
  About has the copyright, and the version on every build.
- The Jobs button shows only while there are jobs, and an empty
  folder no longer says "Empty".
- The docs site has guides to getting started, narration, and
  roleplay with a character card.

## v0.1.0-dev.12

Less text across the app, and the open chat marked in the chat list.

- The app says less. Notes that repeated their control, or explained how
  the app works inside, are gone. Welcome, the provider setup, the
  sign-in pages, confirmations and errors are shorter, and an error
  that a setting can fix names the place in Settings. Labels are in
  sentence case.
- A chat's settings have an Edit voices link, which opens the Narration
  list where the voices are made.
- The open chat is shaded in the chat list, as the open document is in
  the outline, and is easy to read in dark mode as well.
- An MCP server that can't be reached is said to maybe refuse web pages
  (CORS) only in the browser. The desktop app has no such limit.
- Pronunciation hints show two example lines in place of a note on the
  format.

## v0.1.0-dev.11

Projects kept in a folder in the desktop app, and a Connect button for
each connection.

- The desktop app can keep its projects in a folder: Settings › System
  › Data › Keep projects in a folder, off until switched on. On, the
  app opens again with each project a folder of markdown files in its
  data folder, the project's chats with it, and Show in Finder (Show in
  Explorer on Windows) beside the backup buttons opens it. A file
  changed while the app was closed is read when it opens again.
  Switched off, the projects are copied back into the app as they are
  then, and the folder's files stay where they are. Settings, profiles
  and connections stay in the app either way. It is new: export a
  backup before switching it on.
- Each copy of the app keeps its own place in each project: the open
  tabs, the document shown and the panel layout. A project's export no
  longer carries them.
- The provider dialog has a Connect button under the key, and Connect
  to OpenRouter is now Connect with OAuth. A web search service is
  checked with Connect, or Enter in its key; Kagi's key is tried with
  one search, and a key a service refuses is said to be refused.
  Narration's test button is Connect as well.

## v0.1.0-dev.10

Web search, comments on passages, and a card's macros filled in per chat.

- The model can search the web and read pages, through Exa or Kagi, or
  Brave in the desktop app, set up under Settings › Connections. A chat
  searches when its profile is listed there or its own switch is on, so
  a Roleplay or Blank chat never finds itself searching. A page the
  model read can be saved to the project whole. The service's key, like
  an MCP server's, is left out of a backup unless the writer includes
  it.
- Every call a turn made, to any tool, goes back with the conversation,
  with its result, until a summary stands in for it. Before, only
  document calls and skill loads did, and dice and oracle rolls for
  three turns. A call to a tool the chat no longer offers is answered
  rather than run.
- Comments on a passage: select text and press Comment, or
  Mod-Shift-M, and write under the line. A comment is kept in the
  markdown as CriticMarkup with an id, so it follows its passage through
  edits. The Comments tab lists the project's comments; the model finds
  them with list_comments and settles them with resolve_comment, and an
  edit that changes a commented passage's words resolves its comment.
  On a phone the comment opens in a bar at the bottom of the screen.
- A character card imports as documents that say {{char}} and {{user}}.
  A chat on a card asks the writer's name and reads the documents with
  both filled in, and what its model writes is written as it wrote it.
- Find and replace has Match case and Whole words, keeps capitals on
  replace, and says how many Replace all replaced. Quotes curl, and
  dashes and ellipses are made, as the writer types, except in code.
  Mod-/ lists the editor's keys. A text document can be downloaded as
  markdown or duplicated beside itself, and plain text is one switch,
  "Edit in plain text editor".
- In a browser, the welcome dialog says the work is kept in the browser
  and points to backups. Safari is told that it clears a site's data
  after a week away, and on an iPhone or iPad is offered the Home
  Screen. The page asks the browser to keep its data, and the desktop
  app grants it.
- A folder of code, imported or dropped, is offered as a repository
  instead, and documents can't be dragged into a repository.
- A failed reply says why, with a Retry. An unsent message, and a new
  chat's pins and settings, survive a reload. A chat is named with its
  first reply, a fork sorts to the top of the list, and a summary that
  fails or is stopped keeps what it had written.
- A document dropped on a folder's row goes into the folder. Folders
  sorted by name list their folders first. A project whose name is
  taken is numbered, from (2). Panel widths are kept from one session
  to the next.
- On a phone, the bar keeps Write, Outline and Chat, with the rest in a
  menu.
- The Director skill is set aside for now. A new install's preset is
  named Default. About shows the version a desktop build was made from.
- Controls are named for screen readers and reached by keyboard,
  labels are in sentence case, and notes that explained how the app
  works are gone.

## Earlier releases

Up to v0.1.0-dev.9, each release's changes are in the message of its
commit, in the [history](https://github.com/inksprite-io/inksprite/commits/main).
