# Changelog

<!--
One section per release, headed with its tag and written when it is
published, not with each change. The release workflow puts the section
for its tag at the top of the release's notes.
-->

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
