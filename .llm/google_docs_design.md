# Google Docs

Bringing a writer's Google Docs into a project as markdown, and the pictures
in them, which is the first thing to need pictures in a document at all.

The writer opens a folder's menu, chooses "From Google Drive…", picks three
Docs in Google's own picker, and gets three text documents in that folder,
their headings and lists intact. Anything else picked, a PDF or a photo,
arrives as it would have if it had been downloaded and imported.

Two parts. The first stands on its own, with a Doc's images left out. The
second puts images into documents, and then the import keeps them.

`files_design.md` stands for files as documents, the `files` table and the
importer; `markdown_library_design.md` for the file format and the library on
disk. This adds a way in to the first and a node to the second.

---

# 1. Import from Drive

## Decision: Google's picker and `drive.file`, nothing broader

Drive's permissions come in two weights that matter here. `drive.file` lets
an app open the files the writer picks for it, and nothing else; Google calls
it non-sensitive, and it needs only basic app verification. `drive.readonly`
and `drive` reach everything in the writer's Drive; Google calls them
restricted, and an app that asks for them goes through restricted-scope
verification.

`drive.file` with Google's picker is the combination Google recommends, and
it is all this needs. Picking a file in the picker is what grants the app
that file.

**No folders.** Under `drive.file`, picking a folder grants the folder and
not what is in it; listing it returns nothing the app was not already given.
Importing a Drive folder whole would take `drive.readonly`, and the review
that comes with it. The picker lets the writer browse into folders and pick
many files at once, and that is the import: files, several at a time, into
the folder whose menu it was opened from.

## Decision: no backend, and the token only in memory

Both halves run in the page, as OpenRouter's sign-in does.

- **Sign-in**: Google Identity Services' token client,
  `google.accounts.oauth2.initTokenClient({ client_id, scope, callback })`,
  then `requestAccessToken()`. It opens a Google popup and hands back an
  access token good for about an hour. There is no client secret and no
  refresh token.
- **The picker**: `https://apis.google.com/js/api.js`, then
  `gapi.load('picker')`. A `PickerBuilder` with `setOAuthToken(token)`,
  `setDeveloperKey(apiKey)`, `setAppId(projectNumber)`, and
  `Feature.MULTISELECT_ENABLED`, over a `DocsView` that shows folders to
  browse but does not let one be picked. `setAppId` is what ties a pick to
  the app's access.
- **The token** is held in memory for the session. It is never written to
  IndexedDB and never rides in a backup. An import after it expires asks
  again; when the grant still stands, Google does not show the consent
  screen a second time.

## Decision: nothing of Google's loads until the writer asks

A browser blocks a popup that does not open from a user gesture, and an
`await` between the click and `requestAccessToken()`, such as loading
Google's scripts on a first use, can outlast the gesture. Loading the scripts
ahead of time would get round that, but it would mean every writer's browser
fetches Google's code whether or not they ever import from Drive.

So "From Google Drive…" opens a small dialog of the app's own. Opening it
starts loading the two scripts; its button, "Choose from Google Drive", is
enabled once they are in, and its click is a gesture of its own, which calls
`requestAccessToken()` with nothing in between. The picker that follows is
an overlay in the page, not a popup, and needs no gesture. A writer who never
opens the dialog never loads anything from Google.

## What each picked file becomes

| In Drive | Fetched with | Arrives as |
|---|---|---|
| Google Doc | `files/{id}/export?mimeType=text/markdown` | A text document |
| Google Sheet | `export?mimeType=text/csv` (the first sheet only) | A file document with its text |
| Google Slides | `export?mimeType=application/pdf` | A PDF, its text extracted |
| Google Drawing | `export?mimeType=image/png` | An image |
| Other Google types (Forms, Sites, shortcuts, …) | — | Skipped, and named |
| Anything else: PDF, image, `.md`, `.docx`, … | `files/{id}?alt=media` | Whatever importing it from disk makes of it today |

Requests go to `https://www.googleapis.com/drive/v3/` with the token as a
bearer header and `supportsAllDrives=true`, so a file on a shared drive
works too.

Each fetched file becomes a `File` and goes through the importer as it is. A
Doc becomes `<name>.md` typed `text/markdown`, which `useCardImport.inspect`
reads as markdown; the title strips the `.md` again, so a Doc named
`Ch. 3` keeps its name whole. The files are handed to
`useBulkImport.importMany` with no folders of their own, so the folder that
was chosen gets them, and the toast is `describeImport`'s, as for a batch
from disk, with a line for the images left out (below).

Drive caps an export at 10 MB. A Doc over it, like a file the app was not
given, is skipped with its reason and named at the end; the rest of the
batch goes on.

## A Doc's images

Google's markdown writes an image reference-style: `![][image1]` or
`![alt text][image2]` where the picture was, and at the end of the document
a definition for each, `[image1]: <data:image/png;base64,…>`, holding the
whole picture.

Measured through today's `settleMarkdown` (image parsing is off): an image
with no alt text leaves a stray `!` behind, and one with alt text becomes a
*link* whose target is the entire data URI. The base64 ends up in the
document either way, and a Doc with a few screenshots would put megabytes of
it in front of the model. So the import handles images before the markdown
reaches the importer.

**Part 1 strips them.** A pure function over the exported markdown,
`takeImages(markdown) → { markdown, images: [{ ref, alt, mime, bytes }] }`,
removes each use and each definition and returns what it took. In part 1 the
import counts them and the toast says how many were left out. In part 2 the
same function feeds the images into the project instead of discarding them.

**Tables** come out of Google as GFM tables. The editor's parser has tables
off, so their rows stay as text lines: readable, nothing lost, not a grid.

## Setup outside the code

A writer only ever imports their own files, with their own Google sign-in,
and the files go straight from Google to their browser. The Cloud project is
still needed: it is inksprite's registration with Google, not a server, and
nothing runs in it or passes through it.

- **Sign-in** only issues tokens to a registered OAuth client. The client
  names the sites allowed to ask (the authorized origins), so another site
  cannot ask in inksprite's name, and the consent screen's "inksprite wants
  to see the files you choose" takes its name from the project.
- **`drive.file` access is granted to an app.** The picker's app ID is the
  project number; a picked file is opened to that app, and only to it.
- **The API calls count against the project's quota.** The Drive and Picker
  APIs are free, and the quotas are far above what importing needs.

The project's owner sees request counts and error rates in the Cloud console,
not whose files or what is in them.

The project, owned by inksprite's own Google account:

- **APIs**: Google Drive API and Google Picker API, enabled.
- **Consent screen**: app name, support email and developer contact, scope
  `drive.file` only. Published to production rather than left in testing,
  which is limited to 100 listed test users. With only a non-sensitive
  scope there is no scope review.
- **Brand verification**, for the name to show at all. A published app's
  name and logo appear on the consent screen only once Google has verified
  the brand, which takes a domain verified in Search Console by an account
  that is an owner of the Cloud project, a public home page on that domain,
  and a privacy policy on the same domain, linked from the consent screen.
  The support email is shown too, when a writer clicks the app's name.
- **One brand per project.** A Cloud project has a single consent screen,
  so whatever else the project signs people in to shows the same name.
- **OAuth client**, type "Web application", with every origin the app runs
  on as an authorized JavaScript origin: the local dev servers, port by
  port, and the production domain. No redirect URI; the token popup does not
  use one.
- **API key**, restricted to the Picker API and to the same origins. It is
  public, so in a project with billing on, an unrestricted key could be
  spent on anything the project has enabled.
- **App ID**: the project number.

The three values come from the build's environment: `VITE_GOOGLE_CLIENT_ID`,
`VITE_GOOGLE_API_KEY`, `VITE_GOOGLE_APP_ID`. They are public by nature, since
they ship in the bundle; the origin restrictions are what protect them. The
app reads no `import.meta.env` today, so this adds the first, with an
`.env.example` beside it. **When they are not set, the menu item is not
there.** A fork or a self-hosted copy works without a Google project, and one
that wants Drive registers its own.

## In the code

- `src/drive/`, a new module with its `index.js`: loading the two scripts,
  the token, the picker, fetching a picked file as a `File`, and
  `takeImages`.
- `useDriveImport(storyId)`: sign in, pick, fetch, `importMany`, the tally.
- The tree: "From Google Drive…" after "Import folder…" on a folder's menu
  (`DocumentNode.vue`), emitting `import-drive`. `DocumentTree` owns the
  dialog it opens, as it owns the file choosers.

## Testing

- `takeImages` and the Drive-type-to-request table are pure; they are tested
  on real exports saved as fixtures.
- The fetching is tested against a mocked `fetch`, and the picker and sign-in
  as mocked globals.
- A live check needs a Google account and the Cloud project, so it cannot run
  in the container unattended. The first one is a Doc with headings, lists, a
  table, footnotes and two images: record what Google's markdown looks like,
  and what `settleMarkdown` makes of it.

## Not in this part

- **Folders**, for the reason above.
- **Sync.** An import is a copy as it was. A later "Re-import from Drive"
  could keep the Drive id on the document; under `drive.file` an app keeps
  access to a file the writer picked for it, so fetching it again should not
  need another pick (to verify).
- **The desktop build.** The token popup and the web picker need an origin
  registered with Google, which a desktop webview does not have. Google has a
  desktop picker: an authorization URL with `trigger_onepick=true` and
  `prompt=consent` opens the picker in the default browser, which redirects
  back with `picked_file_ids` and an authorization code to exchange for a
  token. It takes a desktop OAuth client, and `drive.file` alone. That is its
  own code path, built with the desktop app.

---

# 2. Images in documents

## Why there are none today

On purpose. `editor/schema.js` takes ProseMirror's basic nodes "minus the
image", and `editor/markdown.js` turns markdown-it's image rule off and drops
the image from the parser's tokens and the serializer's nodes, "since the
schema has nowhere to put them". The schema is the file format, and there
was nowhere for the bytes to go. `files_design.md` part 1 made that place: an
image is a file document, its bytes in the `files` table, in every backup.

## Decision: an image is a file document, referenced by relative path

```markdown
![A map of the lower city](Images/Lower%20city)
```

The alt text is the writer's. The target is the path from the document's
own folder to the image's file document, titles joined by `/`, `..` for a
step up.

- **Titles, not filenames.** `titleOf` drops the extension; the outline
  copies `Papers/RAG survey` and the model reads and writes that. An image's
  path is the same address (`utils/documentPath.js`). The resolver also
  takes a trailing extension that matches the file's media type, so markdown
  written elsewhere, `Images/Lower city.png`, still finds `Lower city`.
- **Encoded.** A markdown destination cannot hold a raw space. markdown-it
  percent-encodes a destination on the way in (`<Images/my map>` settles to
  `Images/my%20map`), so what is stored is encoded and the resolver decodes
  it. A title with a `/` in it is written with the slash encoded, so it stays
  one step of the path.

Rejected:

- **Base64 in the content.** Every read of the document carries the picture
  as text; Google's export shows what that does.
- **An external URL.** Breaks offline and when the host goes. One the writer
  types or pastes is still shown; the app just never makes one.
- **A document id.** Survives renames, but it means nothing to the writer,
  the model, or anything outside the app.

**The cost** is that a path breaks when the image, or the document using it,
moves. Part 2c keeps them right; until then a broken one shows as missing,
and the writer fixes the path.

**Against the library on disk.** That design says nothing internal
references a path, and derives filenames from titles, with an order prefix
in an ordered folder. An image reference is a path written into content on
purpose, as any markdown link is. On disk, either the adapter translates
title paths to filenames on write and back on read, or the reference takes
the filename's form there. That is decided with step 3 of that design, not
here.

## 2a. Showing them

- **Schema**: `image` from `prosemirror-schema-basic` (inline, `src`, `alt`,
  `title`, draggable), added to `NODE_NAMES`; the schema test pins it.
- **Markdown**: markdown-it's image rule on, the stock parser token and
  serializer entry back. The round-trip tests gain an image alone in a
  paragraph, one inside a sentence, one with a title, and one whose path has
  spaces.
- **A node view** in `Editor.vue` (`nodeViews: { image }`): resolve the path
  from the open document to a file document, read its bytes from `db.files`,
  show them on an object URL, and revoke the URL when the node goes. A path
  that resolves to nothing, or to something that is not an image, shows a
  "Missing image" placeholder with the path. An `http(s)` source is shown as
  it is. `FileView.vue` already turns a file document into an object URL;
  the two share that.
- An image fits the column's width, capped in height, and a click opens its
  file document in the viewer.

## 2b. Getting them in

- **Paste and drop** into the editor (`handlePaste`, `handleDrop`): each
  image is imported through the existing importer as a file document into
  `Images/` in the document's own folder, made on first use and found by
  title after that, as bulk import finds folders. An image node with the
  relative path goes where it was pasted or dropped.
- **Why `Images/` beside the document**: paths stay short (`Images/map`),
  and moving a whole folder keeps its documents' links, since every path in
  it is relative to inside it. One folder for the whole project gives
  `../../Images/map` from a nested document, and moving a document out of
  its folder breaks its links either way.
- **Pasted HTML** with `<img src="https://…">` keeps the external source.
  Fetching it to import is often blocked by CORS, and the writer can save and
  drop the picture if they want it kept.
- **The Drive import** writes what `takeImages` returned as file documents in
  `Images/` beside the imported Doc, named `<Doc title> 1`, `<Doc title> 2`
  (Google's `image1` means nothing and would collide between Docs), and
  rewrites each use to its path, alt text kept.
- **The model** can write `![alt](path)` to an image that exists; it is only
  markdown, and the document tools do not change. Letting it *see* the
  picture is `files_design.md` part 3, native attachments.

## 2c. Keeping references right

Optional, and it can come later.

- **An image moved or renamed** (or a folder above it): rewrite the
  references that resolved to it. Finding them parses each text document's
  images and resolves them, one pass over the project's documents; fine at
  the sizes projects have now.
- **A document moved** away from its images: its own relative paths change;
  rewrite them.
- **Deleting an image still in use** says so first ("used in 3 documents"),
  since deletes are permanent now.

## What else it touches

- **Read-aloud**: nothing. `spoken()` in `tts/script.js` already counts a
  non-text inline node as spaces, so offsets hold, and a paragraph that is
  only an image is empty and skipped.
- **The chat renderer** (`utils/markdown.js`) lets a relative URL through as
  "this app", so `![map](Images/map)` in a message would become an `<img>`
  pointing at a route of the app and show broken. A relative image there
  shows its alt text instead.
- **Word counts**: `![alt](path)` counts as words. Small; `wordCount` could
  skip image syntax.
- **Backup**: nothing. The bytes are already in it.

---

# Sequencing

| Step | Delivers | Needs |
|---|---|---|
| 1. Drive import | Docs as markdown, anything else as today's import, images left out and counted | The Cloud project |
| 2a. Images shown | A reference in a document renders | — |
| 2b. Images in | Paste and drop; the Drive import keeps a Doc's images | 1 (for the import), 2a |
| 2c. References kept | Moves, renames and deletes do not break images | 2a |

# Open questions

- `Images/` beside the document, or one folder for the project. The first is
  the recommendation.
- What a reference looks like on disk (with the library's step 3).
- "Re-import from Drive": whether to keep the Drive id on the document now,
  so it can come later without another pick.
- How faithful Google's markdown is on footnotes: the first live check
  answers it. Comments and suggested edits are not a concern for now.
