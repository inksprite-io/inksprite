# Editor tabs

The editor holds several documents at once, with a tab strip to move between
them. Scoped against the code as of the rail and sidebar rework (`ffd58ec8`)
and built in the seven commits listed under "What was built"; the decisions
below are as made, with the two places the build departed from the scope
noted where they happened.

## What tabs are

A tab is a text document open in the editor panel. One tab is active and is
what the editor shows; the others are open but not showing. Folders cannot be
tabs — they have no content. A project has its own set of tabs, the way it has
its own layout, and reopens with them.

## Where the code was

- **One document open, app-wide.** `useEditor` is a singleton holding one
  `EditorState`; `open` closes whatever was open. `Editor.vue` is keyed by
  document id, so a mount is an open and an unmount is a close, with a flush
  on the way out.
- **The URL is the document.** `/write/:documentId` names what the editor
  shows. `WriterView` derives `currentDocumentId` from it and records it as
  the story's `lastDocumentId`. A folder in the URL — the project root — is
  redirected to the last opened document, or the first text document.
- **Opening is a route push**, from the tree, from the empty-project prompt,
  and from the project list (the root, then the redirect).
- **Writes are routed by who holds the document.** `useDocuments.setContent`,
  `appendContent` and `currentContent` ask `editor.holds(id)`: held, the
  change is a transaction; otherwise it goes to the store. The AI's tools,
  edit revert and reapply all come through here. `flush()` is called before
  the model is shown the project and before a backup.
- **Deleting the open document** removes it from the store; the editor
  unmounts and flushes. A flush for a document no longer in the store throws
  inside `updateDocument`. Latent today; tabs must not inherit it.

## Decisions

### One editor state per open document, kept while the tab is open

Two ways to do it:

- **Reload on switch.** Keep the singleton. Tabs are a list of ids; switching
  is close (flush) then open (parse the store's markdown). Small. Loses undo
  history, selection and scroll position on every hop.
- **A state per tab.** `useEditor` becomes a registry keyed by document id.
  Switching is showing another state. Undo, selection and scroll survive.
  A write from the AI to a tab that is not showing lands as a transaction
  in that tab's state, so switching back shows it with undo intact.

The second. Hopping between documents while writing is the whole point of
tabs, and losing undo on each hop would read as broken. The design rule
stands — *there is never a moment when two things are authoritative for one
document* — it just holds per document rather than for the one document.

One `EditorView` still. `Editor.vue` stays keyed by the active document and
mounts a view over the state the registry already holds; unmounting detaches
the view and remembers the scroll position, and no longer closes anything.
Closing is what closing a tab does.

### The tab set lives on the story

`Story.openDocumentIds: string[]`, in strip order. `lastDocumentId` keeps its
meaning and becomes the active tab. A story without the field opens with one
tab, its last document — no migration, and old backups restore as they are.
Same pattern and same cost as `layout` and `lastDocumentId`: a story row write
on open, close and switch.

Session storage would be cheaper but would forget the tabs between visits,
which is not how the rest of the project's state behaves.

### The URL is the project

`/project/:storyId`. The active document is `lastDocumentId` on the story,
which is where it is already recorded; with the tab set beside it there, a
URL naming the document as well would be a second source for one fact — the
same argument the route helpers make against a story segment, pointing the
other way.

What the document URL bought is not worth keeping: nothing in the app makes a
deep link to a document, the data is local to one browser so a link cannot
reach anyone else, and the story's last document already restores the view
on reload. What the project URL buys is a shorter cold load — the story id is
in the path, so the document-to-story lookup, the folder redirect and the
stale-document case go — and an open that is one write to the story rather
than a route push the writer view then decodes. Tab switches stay out of the
browser's history; back and forward walk projects.

No legacy `/write/:documentId`. A route that names nothing — an old URL, a
deleted project — goes to `/`, which opens the most recent project or the
no-project state, as it does now.

### Closing

A close button on each tab, and middle-click. Right-clicking a tab opens a
menu of what the panel offers for it, which is copying the document's path:
the address the tools take, the same one the outline's menu copies.

Closing the active tab activates its neighbour — the one to the right, else
the left. Closing the last tab leaves the set empty and the editor panel
showing a "nothing open, pick a document from the outline" state, distinct
from the "nothing to write in yet" one a project with no documents gets.

No keyboard shortcut in the first cut. Ctrl+W, Ctrl+Tab and Ctrl+PageUp are
the browser's, and the alternatives are not obvious enough to be worth
guessing at.

### Single click opens a tab that stays

No preview tabs (the italic, replace-on-next-click kind). Clicking a document
already open activates it. Preview tabs can come later without changing the
model; they are a flag on one tab.

### Documents that change under a tab

- A rename shows at once: the strip reads titles from the store.
- A deletion — from the tree, or an AI's created document being reverted —
  drops the tab and discards its state *without flushing*, which also fixes
  the throw above. A folder's deletion drops every tab under it. Discarding
  the active tab activates a neighbour as a close does.

### Phones

Same tab set, same rules; the strip renders above the editor on the write
view. Cheap to include since the model is shared, and skipping it would make
a phone open documents into the desktop's tab set without showing them.

## What was built

In the order landed. Step 0 stood on its own and went first: it simplified
the writer view and left the tabs change smaller.

0. **The route** — `5c19a4a5`. `/project/:storyId` replaced
   `/write/:documentId`; `/` kept its job, and anything unmatched redirects
   to it. `WriterView` takes the story from the route, sends an unknown one
   to `/`, and reads the active document off the story. `useDocuments` gained
   `open` and `activeDocumentId`; the tree and the empty-project prompt open
   through them, and the project list pushes the project. The folder
   redirect, the document-to-story lookup and `storyIdForDocument` went.

1. **The registry** — `35163828`. `useEditor` keyed by document id:
   `open(id, markdown)` resumes a held state or creates one; `close(id)`
   flushes and drops; `discard(id)` drops without flushing; `holds`,
   `openIds`, `stateOf`, `attach(id, view)`, `dispatch(id, tr)`,
   `replaceContent(id, …)`, `appendContent(id, …)`, `markdown(id)`,
   `focus(id)`, and later `rememberScroll(id, top)` and `scrollTop(id)`.
   `flush(id?)` flushes one or every dirty state, and writes nothing for a
   document the store no longer has — the throw above. Dirty flags and
   projection timers per id. `Editor.vue` still closed on unmount at this
   point, so nothing changed for the writer.

2. **The tab model** — `c212a78d`. Pure functions over `{ open, active }`:
   `tabsOf` and `tabsPatch` to and from the story fields, `openTab`,
   `closeTab`, `dropTabs`, `normalizeTabs`. `Story.openDocumentIds` on the
   typedef. *Departure:* it lives in `utils/tabs.js`, not under
   `components/`, because a composable reads it.

3. **Wiring** — `c50589e6`. `useDocuments` owns the tabs: `tabs` reads them
   off the story checked against the tree, `open` and `closeTab` write them,
   and `remove` drops the tabs of what it deletes and discards their states.
   *Departure:* no watch on the store — every deletion in the app goes
   through `remove`, so it does that there. `EditorPanel` reads the tabs
   itself and shows the front one or `EmptyEditor` (the empty-project prompt,
   which now also covers a project closed down to no tabs). The phone's
   write view uses the same panel.

4. **The strip** — `a09fa690`. `components/writer/editor/EditorTabs.vue`,
   presentational: items and the active id in, `activate` and `close` out.
   Close button, middle click, the front tab scrolled into view.

5. **Editor.vue** — `e8edd521`. Resumes rather than opens on mount, and on
   unmount writes out, detaches and remembers the scroll instead of closing.
   `useDocuments.releaseTabs` lets go of a project's states when it is left,
   keeping the tabs on the story.

6. **Docs** — this file, and the module descriptions.

## Not in this cut

- Dragging tabs into a new order.
- Preview tabs.
- Keyboard shortcuts for switching and closing.
- A mark on a tab the AI has changed since it was last looked at.
- Pinned tabs, and tabs surviving a project switch.
- More than one editor pane.
