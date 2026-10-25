# Changelog

<!--
One section per release, headed with its tag and written when it is
published, not with each change. The release workflow puts the section
for its tag at the top of the release's notes.
-->

## v0.1.0-dev.22

Extensions stay as you switch them.

- An extension you switch on or off in Settings › Extensions stays that
  way. inksprite had been deciding again each time it opened, so Roleplay
  could come back on, or go off, by itself.

## v0.1.0-dev.21

Formatting from the bar under a selection, documents that hold others,
math in the chat, a grammar checker that leaves fiction alone, and syncs
with Google Docs that no longer stop.

- Some documents hold others, as a folder does. A book you import is the
  epub, holding its parts and chapters; a character card that came in a
  picture is the picture, holding its parts; a Scrivener text holds the
  texts under it in the binder; and Convert to Markdown puts its copy
  under the file it came from. Click the arrow beside one to see what it
  holds, and the document itself to open it. Hiding or deleting it hides
  or deletes what it holds too. What you imported or converted before
  keeps its shape. In the desktop app, one is a folder of its name on
  disk, with the document inside. A device on an earlier release syncs a
  project with one in it once it's updated.
- Select some words, and the bar under them formats them too: Link, Bold,
  Italic, a menu of the rest with Clear formatting, and the paragraph's
  style, from normal text and headings to a code block, a quote or a
  list. On a phone, the same buttons are in the bar at the bottom of the
  screen. The quote and list keys now take a quote or a list off again.
- Math in the chat is typeset: TeX between `$…$` in a sentence, or
  `$$…$$` on lines of its own, in your messages and the model's. Copying
  a formula copies its TeX.
- The spelling and grammar checker leaves fiction alone. It no longer
  flags what novels do on purpose: dialect such as "nothin’" and "an’",
  speech that runs on over paragraphs, "had had", "OK", "uh" and "um",
  three full stops, inch marks, and two spaces after a full stop. Its
  suggestions of style and wording are gone, and so are the grammar
  rules that were mostly wrong over published fiction, so "he go", and
  "to" for "too", aren't caught any more.
- A sync with a Google Doc no longer stops for what a Doc can't take
  yet, such as a footnote added or removed, a list inside a list, or an
  edit beside a paragraph the Doc suggests. That stays here, the rest
  syncs, and the next sync tries it again. Sync to a new Google Doc makes
  the Doc with what it can take. A Doc's suggestion you change here in a
  way the Doc can't follow, such as parting its paragraph in two, is
  rejected in the Doc, and your words go to it as a suggestion of yours.
- A sync that puts a table in a Doc no longer turns the paragraphs after
  it into a quote.
- The name others see starts as your account's name, so your friend
  code shows at once in Settings › System › Sync, and Share… never asks
  for a name. Type another there if you'd rather your friends saw
  something else.
- The buttons that give one panel the other's room are named for the
  panel they spread out: Expand editor, at the right end of the tabs, and
  Expand chat, at the left of the chat's header.
- A document the model makes under a code file's name, such as `odds.csv`
  or `roll.py`, is kept exactly as written, and the plain text editor
  colours a document with such a name as its language.
- In the desktop app, a synced file opens the second time too, rather
  than showing nothing once it had been downloaded.
- Importing a character card from a picture no longer says it made one
  document more than it did.

## v0.1.0-dev.20

Sync between your devices and with friends, a trash, document versions,
suggested edits, explore, and backups as zip files.

- Sync keeps your projects, your setup and your card library on every
  device you sign in on, through our server at sync.inksprite.io. It's
  in private preview, and an account needs an invitation. Everything is
  encrypted on your device before it's sent, so the server can't read
  it. Settings › System › Sync makes the account, with a passphrase and
  a recovery code, and lists the devices signed in. Edits made on two
  devices come together; where both changed the same words, the device
  that synced last wins, and the other's words are kept as a version. An
  imported file comes down the first time it's opened. A project can be
  kept on one device only. The About page says what the server sees.
- A project can be shared with friends who have accounts too. Type the
  name others see in Settings › System › Sync, and your friend code
  shows there. Share…, on the project's menu, takes a friend's code and
  lists who has the project. Everyone can write in it; only its owner
  shares or deletes it, and the others leave it. Each person's chats in
  it stay their own, and comments show who wrote them.
- When another device, or someone you share a project with, has synced
  from a newer version of inksprite, a dialog says some changes can't
  sync until you update, with Update once it's ready.
- Deleting no longer asks. Documents, folders, chats and projects go to
  the trash, kept for 30 days and restored from Projects › Trash, and
  Command-Z (Control-Z on Windows and Linux) in the outline takes a
  delete back. The model can delete a document too, to the trash.
- A text document keeps versions of itself: after a pause in typing, and
  before anything else changes it, such as the model, a sync or a
  character card imported again. Versions…, on its menu or its tab,
  compares one with the text and restores it.
- A chat that asks before changing documents suggests its edits in the
  text. Each change is accepted or rejected on its own, in the Comments
  tab or from the bar over it in the text, and Command-Z in the Comments
  tab takes that back.
- A linked Google Doc's suggested edits come in as suggestions, and
  accepting or rejecting one here does the same in the Doc. Typing
  inside one changes it in the Doc too. The model's suggestions go to the
  Doc as suggested edits in your name, with its notes as replies; one
  that changes formatting or adds or removes a paragraph stays here. An
  edit beside one of the Doc's suggestions no longer stops a sync. A sync
  with a Doc no longer asks which words to keep: where both changed the
  same words, the document's words stand and the Doc's are kept as a
  version.
- Sync with a Google Doc takes comments both ways. A comment you or the
  model make here shows in the Google Doc on the same words, and one
  made in the Doc comes here under the name of who made it. Replies,
  edits to your own comments, and resolving or reopening a comment go
  across on the next sync, whichever side they were made on. A comment
  deleted in the Doc is resolved here, and one longer than Google Docs
  allows stays here.
- A document that isn't linked to a Google Doc can go into a new one:
  right-click it and choose Sync to a new Google Doc. The Doc goes in an
  inksprite-sync folder in your Drive, in a folder for the project and
  one for each folder the document is in, and when you rename or move
  the document, its folders or the project, the next sync does the same
  in Drive. From then on it syncs like a Doc you imported.
- `/explore`, Explore… on a folder's or the project's menu, and the
  model itself can write a line on what each document, folder and long
  section is about, which the model sees beside each when it lists them.
  A large one asks first, unless Ask before exploring large folders is
  off in Settings › System › Chats.
- `/aside` asks the model something outside the conversation, such as
  where the story could go next. It answers, and then forgets the
  question and its answer: the chat goes on as if neither was said.
- The model saves a page or a document it finds to the project, asking
  first until you choose Always allow. In the desktop app it also reads
  PDFs and Word files on the web, and saves one as the file itself.
- Each AI provider has Requests at once, how many it's asked together:
  one for a server on your computer or network, as many as llama.cpp has
  slots, and no limit for the rest. What you're waiting on goes before a
  job's.
- In the desktop app, File › New Window opens another window, each with
  a project of its own and named for it.
- Shift-Command-F (Shift-Control-F on Windows and Linux) searches the
  whole project, in the sidebar, by document. A match opens its document
  at it, and a PDF at its page.
- A link to a document still goes to it after the document is renamed or
  moved.
- In the outline, Command-Z undoes and Shift-Command-Z redoes, a click
  on the selected document's title renames it, and a drag shows where it
  will go.
- Backups, selections and project exports are zip files, so a large one
  can be made and read back: past about 512 MB, they failed. Backups
  from before still import, but an earlier release can't open the new
  zips. Settings files and chats are still JSON.
- inksprite says less. There's no message where you can see what
  happened, and no question before undoing a new document, switching
  Roleplay off or adding projects from a backup. An error says what
  didn't happen, and why.
- `/roll max(2d20)+1` keeps the higher of two d20s, for advantage, and
  `min(2d20)+1` the lower.
- The spelling checker leaves swearing, hedging, the Oxford comma and
  shortened words alone.
- List items are spaced tightly with Compact text off too.
- A file opened while its import is still saving it opens once it's
  saved.
- Deleting the paragraph after a page break no longer leaves a stray
  full stop in a paragraph of its own in the Doc when it syncs.
- This release moves your data to a new version of its database. Once a
  browser or the desktop app has opened it, an earlier release can't
  open that data, so there's no going back to one.

## v0.1.0-dev.19

Pictures in documents, comment threads, Sync with Google Docs, and
inksprite installed from the browser.

- Documents can have pictures. Paste one, drop it on the page, or
  right-click and choose Insert › Picture…. Click a picture to give it
  alt text, which is all the model knows of it; double-click it to see
  it over the whole window, and right-click it to save it. A picture
  belongs to its document and isn't in the outline: copied into another
  document, it's that one's own. A picture from a web address isn't
  loaded, so the site can't see you open the document. Word files and
  Google Docs keep their pictures when they're imported. In the desktop
  app they're in a hidden `.images` folder beside the document's file.
- Export, on a document in the outline, saves a document with pictures
  as a zip of the Markdown file and an `images` folder. It was called
  Download before.
- A comment is a thread now. Comments are read, answered and resolved
  in the Comments tab, which opens beside the text when you comment;
  each reply is under the name of who wrote it, You or Assistant, and
  anything you said can be edited. The model replies to comments, says
  what it did, and leaves comments of its own, as notes on a chapter or
  on a gap it couldn't fill. Comments can overlap. A resolved comment
  is kept: the clock in the Comments tab shows the resolved ones, and
  Reopen puts one back on its passage. A comment whose passage was
  deleted stays in the tab, struck through, until it's resolved.
- A Google Doc you import stays linked to its document, and Sync sends
  your edits to the Doc and brings in the ones made there. It's at the
  end of the editor's tabs and in the document's Google Doc submenu.
  Edits on both sides are merged, and where both changed the same words
  you choose which to keep. Tables go across too; some changes, such as
  a footnote added, can't yet, and Sync says so before it sends
  anything. A Doc imported before this release asks at its first sync
  which side to keep whole.
- Google Docs come in with more of what they hold: horizontal lines,
  pictures, footnotes, and smart chips as words (a person as their
  name, linked to their email address). A Doc with suggested edits
  still open comes in as it was before them, and the message names it.
- inksprite can be installed from Chrome or Edge, or added to the Home
  Screen on an iPhone, an iPad or Android, as an app of its own that
  opens without a connection. When there's a new version, it says so,
  and Reload starts it. On an iPhone or iPad, Safari doesn't clear the
  Home Screen app's data after a week, though it starts empty: bring
  your projects over with a backup.
- `/roll 2d6 How does the monster react?` rolls and has the model read
  the roll for the question. A roll shows a line for each kind of die
  above its total. Edit the turn to change a die, and the total is
  worked out again.
- Interpret and Write, the skills still being tuned, each have a switch
  under Experimental in Settings › Skills, and are off until it's on.
  Until then, `/interpret` and `/write` aren't in the list.
- The model's document search finds `k = 60` when asked for `k=60`,
  and when no document has every word asked for, it gets the ones that
  have all but one.
- A link copied into a document in another folder still goes to the
  same document.
- With the theme on System, inksprite follows the system's light and
  dark from the start, not only once Settings has been opened. The
  installed app's title bar takes the page's colour.
- Text that Markdown would read back as something else is kept as
  written: an `&amp;`, an address in angle brackets, a line starting
  with `1)` or `+`, and bold or italic that ends in a space.
- This release moves your data to a new version of its database. Once
  a browser or the desktop app has opened it, an earlier release can't
  open that data, so there's no going back to one.

## v0.1.0-dev.18

Spelling and grammar in the editor, focus mode, a switch for the AI, a
library of character cards, and Export as a tree.

- The editor checks spelling and grammar as you write, the same in
  every browser and the desktop app: misspellings are underlined in
  red, grammar in blue. Right-click a flagged word for its suggestions,
  or to add it to your dictionary or the project's. Nothing is
  corrected for you, and the names in the project's titles are known
  already. Settings › System › Spelling has the language (five kinds
  of English), grammar, and your dictionaries. Phones keep their
  keyboard's checker.
- The editor has a right-click menu of its own: Cut, Copy, Copy as
  Markdown, Paste, Paste without formatting, Paste from Markdown, the
  link and the comment, and Insert, with Table, Horizontal rule and
  Code block. In a table, rows and columns are added from its Table
  items; Tab and Enter only move between cells now.
- Focus mode shows the document alone, full screen where it can. Press
  Option-Command-F (Control-Alt-F on Windows and Linux), or the button
  at the end of the editor's tabs; the same key or Escape brings the
  rest back.
- The AI can be switched off, with Enable AI in Settings › System or
  from the welcome. The chat, narration and the AI's settings go, and
  come back as they were when it's switched on again.
- Character cards, the card library and the Roleplay profiles are now
  an extension, Roleplay, switched on in Settings › Extensions. It is
  on where they were already in use, and off in new installs. Switching
  it off hides them and deletes nothing.
- The card library keeps your character cards outside any project: a
  grid of portraits to search by name, creator or tag. Add cards as
  PNG or JSON, dropped on it, or from a link to a Chub page, a
  botbooru page (in the desktop app) or the card itself. A card can
  start a project of its own, opening on a chat with the character, or
  go into the open project; it lists the projects it went into, and
  downloads as the file it came in. Cards tagged nsfw or nsfl have
  their pictures blurred until you click the eye beside the search.
- Export is a tree of your projects, with their documents and chats,
  the character cards and the settings. Everything ticked is a whole
  backup, as before, and the settings alone a settings file. Anything
  else makes a file whose projects and cards Import adds beside yours,
  merging its settings. Import also takes a project's own export.
  Export and Import are under Settings › System › Data.
- An OpenRouter preset can ignore providers for its model, as well as
  name the ones allowed.
- inksprite is now free software under the GNU General Public License,
  version 3 or later, in place of the GNU Affero General Public
  License. Settings › About, the terms and the README say so.

## v0.1.0-dev.17

Scrivener projects, and a new example project in the docs.

- A Scrivener 3 project can be imported. Choose the `.scriv`, or a zip
  of it, under Projects › Import project, and it comes in as a new
  project with the binder as the outline, in the same order. Each text
  is a document, with its headings, lists, bold, italic and tables, and
  the PDFs and pictures in Research are files. A text's synopsis and
  notes come in as documents beside it. To bring one into the open
  project, choose it with Import › Files on a folder, or drop it there.
- Chat settings no longer have a Project context switch. A chat that
  can use the document tools tells the model about the project on every
  turn; one that can't sends only the documents you pinned.
- The docs' pictures show a new example project, a thief's story set in
  a walled city.

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
