# Document Tree — Step 1: Data Model

> `content` is no longer TipTap HTML. `markdown_library_design.md` supersedes
> what this document says about content; the tree, ids, roots, and ordering
> rules here still stand.

Replace `parts` + `scenes` with a single `documents` table forming an n-level
tree, **underneath the existing UI**. No component changes. The outline, editor,
reader, and AI tools keep working exactly as they do now.

This is the foundation for the VSCode-style shell (explorer / tabs / chat) and
for the context workspace. Those are steps 2–4 and are out of scope here.

## Why this can land first

No `.vue` file imports `partsStore` or `scenesStore`. Thirteen files reference
them, all under `stores/`, `composables/`, `ai/`, `utils/`. Everything in
`components/` goes through `useStoryContent`. So the storage layer can be
swapped while the UI stays untouched and shippable.

## Schema

```js
db.version(3).stores({
  documents: 'id, storyId, parentId',
})
```

`parts` and `scenes` are **not** dropped. Dexie carries v1 tables forward when
they aren't redeclared; leaving them in place is the rollback path and costs
nothing (`aiParameterPresets` already sets this precedent).

`order` is not indexed — it never was used for queries; sorting happens in
memory in both current stores.

## Document shape

```js
/**
 * @typedef {Object} Document
 * @property {string} id - doc_xxx, or a legacy part_xxx / scene_xxx / drafts_storyId
 * @property {string} storyId - Owning story
 * @property {string} parentId - Parent document id, or storyId when at the root
 * @property {number} order - Display order among siblings
 * @property {'folder'|'text'} type - Folders hold children; text holds content
 * @property {string} title
 * @property {string} content - Tiptap HTML; always '' for folders
 * @property {string} summary
 * @property {number} wordCount - 0 for folders
 * @property {number} version
 * @property {boolean} deleted
 * @property {number|null} deletedAt
 * @property {number} created
 * @property {number} updated
 */
```

A folder is a Part: title + summary, no content. A text document is a Scene.
The union is uniform, so the tree never branches on type except for word count
and rendering.

## Decision: keep existing IDs

A migrated part keeps `part_xxx`. A migrated scene keeps `scene_xxx`. Drafts
keeps `drafts_${storyId}`. Only newly created documents get `doc_xxx`.

This is the decision that makes the migration safe. Every stored reference
survives untouched:

- `sceneBeats.sceneId`
- persisted app state (current scene)
- chat context and `apiTrajectory` tool results naming scene ids
- routes

Minting new ids would mean rewriting references across five tables and any
persisted UI state, with no way to verify completeness. The id prefix stops
carrying meaning, which is already true today (`drafts_` vs `part_`).

## Decision: root parentId is the storyId

Not `null`. Two reasons:

1. **IndexedDB does not index null.** A `parentId: null` row is invisible to
   `where('parentId')`, silently. Any future query by parent would skip exactly
   the root documents.
2. `where('parentId').equals(x)` then works uniformly for roots and nested
   documents, and one `childrenByParent` index serves both. "The story is the
   root folder" is also the model the tree UI will present.

Consequence: `parentId` is always a non-empty string, never nullable.

## Migration

Extracted as a **pure function** so it can be tested with plain arrays. There is
no `fake-indexeddb` in devDependencies and this avoids adding one.

```js
// src/stores/migrations/documents.js
/**
 * @param {Part[]} parts
 * @param {Scene[]} scenes
 * @returns {{documents: Document[], skipped: Array<{id: string, reason: string}>}}
 */
export function partsAndScenesToDocuments(parts, scenes)
```

Mapping:

| Source | `parentId` | `type` | Notes |
|---|---|---|---|
| Part | `part.storyId` | `folder` | `content: ''`, `wordCount: 0` |
| Scene | `scene.partId` | `text` | `storyId` resolved via its part |

Scenes carry no `storyId` — only `partId` — so the migration resolves it by
lookup. Edge cases:

- **Orphaned scene** (partId matches no part): skipped. `storyId` is
  underivable, and such rows are already invisible today because scenes load
  per-part.
- **Part with no storyId**: skipped, along with its scenes.
- **Soft-deleted rows**: migrated as-is, `deleted`/`deletedAt` preserved.
  `hardDeleteOldDeleted` has a 30-day retention window that must keep working.
- **`version`**: copied from source, not reset. `syncStore` increments on write.

The Dexie hook is a thin wrapper:

```js
db.version(3)
  .stores({ documents: 'id, storyId, parentId' })
  .upgrade(async tx => {
    const [parts, scenes] = await Promise.all([
      tx.table('parts').toArray(),
      tx.table('scenes').toArray(),
    ])
    const { documents, skipped } = partsAndScenesToDocuments(parts, scenes)
    if (skipped.length) console.warn('Skipped during migration:', skipped)
    await tx.table('documents').bulkPut(documents)
  })
```

`bulkPut` with source-derived ids makes a retry after partial failure safe.

## documentsStore

Mirrors the existing store idioms: `shallowRef` Maps plus `triggerRef`
(scenesStore's approach — it holds content and re-cloning is costly), soft
delete, `syncStore.trackChange('documents', id, doc)`.

State:

```js
documents        // ShallowRef<Map<string, Document>>
childrenByParent // ShallowRef<Map<string, Set<string>>>
loadedStories    // ShallowRef<Set<string>>
```

Actions:

```
getDocument(id)
getChildren(parentId)              // non-deleted, unsorted
getChildrenOrdered(parentId)       // sorted by order, stable tiebreak on id
createDocument({storyId, parentId, type, title, id?, order?})
updateDocument(id, updates)        // recomputes wordCount when content changes on a text doc
moveDocument(id, newParentId, order)
deleteDocument(id)                 // soft; does NOT cascade (matches today)
reorderChildren(parentId, ids)
loadStory(storyId)                 // one query, in-flight deduped
hardDeleteOldDeleted(retentionDays)
```

`loadStory` replaces the current 1 + N load (`loadPartsForStory` then
`loadScenesForPart` per part) with a single `where('storyId').equals(storyId)`.
A story is on the order of 100 documents.

Because roots use `parentId === storyId`, `childrenByParent` alone answers both
"parts of this story" and "scenes of this part". No separate by-story index.

## Adapter layer

`partsStore` and `scenesStore` keep their **exact current signatures** and
become projections over `documentsStore`. Nothing above them changes.

```js
toPart(doc)   // { id, storyId, order, title, summary, version, deleted, deletedAt, created, updated }
toScene(doc)  // { ...same, partId: doc.parentId, content, wordCount }
```

Projecting explicitly (rather than returning documents raw) keeps the `Part` and
`Scene` typedefs honest and keeps existing `toEqual` assertions passing.

| Adapter call | Delegates to |
|---|---|
| `getPart(id)` | `toPart(getDocument(id))` |
| `getPartsForStoryOrdered(sid)` | `getChildrenOrdered(sid)` filtered to `folder` |
| `getScenesForPartOrdered(pid)` | `getChildrenOrdered(pid)` filtered to `text` |
| `createPart(sid, title, {isDraft})` | `createDocument({parentId: sid, type: 'folder'})` |
| `createScene(pid, title)` | `createDocument({parentId: pid, type: 'text'})` |
| `updateScene(id, {partId})` | `updateDocument(id, {parentId})` |
| `loadPartsForStory(sid)` | `loadStory(sid)` |
| `loadScenesForPart(pid)` | **no-op**, resolved promise |
| `deleteScenesForPart(pid)` | delete text children |

The drafts part keeps its `drafts_${storyId}` id and `MAX_SAFE_INTEGER` order.
`isDraftsPart` continues to work by id. Step 3 turns it into an ordinary folder;
don't touch it here.

Both stores shrink from 677 lines combined to roughly 200. They are deleted
outright in step 4, when the tools and UI move to documents directly.

## Testing

**Acceptance criterion: the 16 existing test files that touch parts or scenes
pass unchanged.** That is the whole point of the adapter — if they need editing,
the projection is wrong.

New tests:

- `test/stores/migrations/documents.test.js` — pure transform. Part→folder,
  scene→text, storyId resolution, orphan skipping, deleted rows preserved,
  drafts ordering, idempotent re-run.
- `test/stores/documentsStore.test.js` — CRUD, ordering, move between parents,
  word count on text only, soft delete, `loadStory` dedup.

Known risk: `test/composables/useStoryContent.partOrder.test.js:79` assigns to
`composable.parts.value`, which is a `ComputedRef`. It works today against the
mock; check it still does.

## Rollback

- Branch `document-tree`, `main` untouched.
- `parts` and `scenes` tables remain populated and readable.
- Reverting the code reverts to reading them. Data written to `documents` after
  the migration would be lost on revert, so this wants a day of real use before
  step 2 builds on it.

**Open question: is there a working export?** Worth confirming (or adding)
before running an irreversible upgrade against real writing.

## Explicitly deferred

- Cascading delete of a folder's children (`useStoryContent` handles it today)
- Arbitrary nesting in the UI — the outline still renders exactly two levels
- Lore entries as documents
- Tool changes (`read_scene` / `read_lore` → `open_document`)
- Dropping the `parts` / `scenes` tables

---

# Step 2: Project Tree

Give each story a real root node with a default folder structure, then replace
the two-level outline with a recursive tree.

## Decisions

**`ordered` is a boolean on folders.** Ordered folders sort by `order`, allow
drag-to-position, and prefix children with `N: ` on display. Unordered folders
sort by title and only accept drops, not positions — dragging within an
alphabetical list means nothing.

`order` is maintained on every document regardless, appended at creation. A
folder switched from unordered to ordered gets its original sequence back
rather than something arbitrary.

**No computed titles.** The old outline rendered untitled parts as `Act ${order
+ 1}` and untitled scenes as "Chapter N" counted across the whole story. The
tree does not compute anything: a document displays its stored title, with the
index prefix added when its parent is ordered. A naming-format setting on
ordered folders (`Chapter %d`) can come later.

**The prefix is display-only.** `title` stores `First Chapter`; the tree shows
`1: First Chapter`; renaming edits `First Chapter`. Storing the prefix would
reintroduce documents that rename themselves when dragged.

**The root node's title comes from the story name at creation, and is then
independent.** No sync. Two fields holding the same string and pretending to
agree is worse than one going stale.

**New folders default to unordered**, not inherited from their parent.

## Shape

```
My Novel              root_<storyId>        unordered
  drafts              drafts_<storyId>      unordered
  manuscript          manuscript_<storyId>  ORDERED
    1: Act 1          part_xxx              ORDERED
      1: Chapter 1    scene_xxx
      2: Chapter 2    scene_xxx
    2: Act 2          part_xxx              ORDERED
  notes               notes_<storyId>       unordered
```

Root children render alphabetically, so drafts leads and manuscript sits in the
middle. New stories get the same structure minus drafts.

Fixed ids (`root_`, `manuscript_`, `notes_`, `drafts_`) rather than generated
ones: the adapters and the default-structure check both need to find these
folders without a search, and it keeps the migration idempotent.

## Migration (schema v4)

A pure transform again, shared with backup restore. Per story:

1. Create root, manuscript, and notes folders.
2. Move existing root-level folders (the acts) under manuscript, preserving order.
3. Move the drafts folder under root, retitle it `Drafts`, drop its
   `MAX_SAFE_INTEGER` ordering hack.
4. Mark manuscript and every act `ordered: true`.
5. Materialize titles for anything untitled, using the *old* display rule —
   `Act {order+1}` for acts, and "Chapter N" counted across the whole story for
   scenes, so nothing appears to renumber.

Materializing means a chapter shows as `1: Chapter 5` where the stored title is
`Chapter 5` and the prefix is its position within its act. Redundant until the
naming-format setting exists; silently renumbering someone's chapters is worse.

## Adapters during 2a

`partsStore` gains one level of indirection so the existing outline keeps
working while the data moves:

- `getPartsForStoryOrdered(storyId)` → folder children of `manuscript_<storyId>`,
  plus the drafts folder appended last
- `createPart` → parented to manuscript
- `isDraftsPart` unchanged; the id prefix still identifies it

These die in 2b along with the outline trio.

## Deferred

- Lore entries as documents under `notes` — moves in at step 4, when the lore
  tools are being rewritten anyway. Two irreversible migrations should not land
  with a UI rewrite.
- Naming format per ordered folder.
- Inheriting `ordered` from the parent on create.

# Step 3: Lore Becomes Documents

A lore entry is a document that lives in its own table with a worse editor. This
step folds lore into the tree and replaces the six lore tools with document
tools that work on the whole project.

Tabs move behind this. The tab strip should have exactly one kind of thing to
open; building it while lore is still a separate panel means building it twice.

## What lore actually is today

- `lorebooks` — one per story, holding a `categories` string list and nothing
  else of substance.
- `loreEntries` — name, category, description, content, and three flags.
- Content is plain text in a PrimeVue `Textarea`, not TipTap HTML.
- The AI layer already pulls rather than pushes: six tools plus a
  category-count index in the system message.

`activationKeys` and `includeInPrompt` are written by `useLorebooks` and read by
nothing outside it. They are dead state with a UI attached.

## Field mapping

| LoreEntry | Document |
| --- | --- |
| `id` (`lore_xxx`) | `id`, unchanged |
| `name` | `title` |
| `description` | `summary` |
| `content` (plain text) | `content` (HTML paragraphs) |
| `category` | parent folder |
| `lorebookId` | resolved to `storyId` through the lorebook |
| `enabled` | folder placement — see below |
| `activationKeys`, `includeInPrompt` | dropped |

Ids are kept, as in step 1. Trajectories replay tool results that name entries
by id; rewriting ids turns those into dangling references.

`description` → `summary` is the mapping that makes this feel right: documents
already carry a summary, and it is already what the tree shows under a node.

## Shape

```
root/
  manuscript/
  notes/
    Characters/
      Elara
    Setting/
      The Crystal Caves
```

Categories become folders, but only the ones actually in use. A lorebook
declares five categories by default and a story typically uses two; migrating
the declared list would hand every project three empty folders.

An entry with no category lands directly in `notes/`.

## Decision: `enabled` becomes placement

`enabled: false` currently hides an entry from every tool. A document tree has
no such flag, and adding one re-invents the thing this step deletes.

Disabled entries migrate into `notes/archive/`. Nothing is lost, the model is
not silently handed material the writer switched off, and "archive" is a folder
like any other — it can be renamed, emptied, or dragged apart.

The alternative is to migrate them inline and accept that disabling stops
meaning anything. That is a one-line change to the migration if the archive
folder reads as clutter.

## Migration (schema v5)

Same pattern as steps 1 and 2:

- `src/stores/migrations/lore.js` exports a pure
  `loreToDocuments(lorebooks, loreEntries, documents)` → `{documents, skipped}`.
- A Dexie v5 upgrade hook calls it.
- `UPGRADES[5]` in `backup.js` calls the same function, so a v4 backup restored
  into a v5 database is not silently missing its lore.
- `lorebooks` and `loreEntries` stay declared and populated. Reversibility is
  what made the parts/scenes migration safe to land.

Idempotent on the same rule as before: an entry whose id already exists in
`documents` is skipped, so a retried upgrade or a re-imported backup cannot
double-migrate.

Plain text becomes HTML by splitting on blank lines into `<p>`, turning single
newlines into `<br>`, and escaping entities with `he` — already a dependency.

## Tools: seven become five

`read_lore`, `list_lore`, `search_lore`, `create_lore_entry`,
`update_lore_entry`, `delete_lore_entry`, and `read_scene` collapse into:

- `open_document(name_or_id)` — replaces `read_lore` and `read_scene`
- `search_documents(query)` — replaces `search_lore`, and now reaches the
  manuscript too
- `create_document(parent, title, content)`
- `update_document(name_or_id, updates)`
- `delete_document(name_or_id)`

`list_lore` has no successor: the system message carries the tree, so listing
is what the model already has. The three mutators stop being lore-only — the
model could never create a chapter before, only a lore entry.

Registry group `lore` becomes `documents`.

## Context: one tree index instead of two indexes

`renderOutline` walks parts and scenes; `renderLoreIndex` counts categories.
Both become one `<project>` section rendered from `documentsStore`: the tree,
with summaries, and the current document marked.

This is what takes `partsStore` and `scenesStore` out of the AI layer entirely.
`renderCurrentScene` is the only other user and it needs `getDocument`.

## What gets deleted

- `stores/lorebooksStore.js` (244), `stores/loreEntriesStore.js` (249)
- `composables/useLorebooks.js` (340)
- `components/writer/lorebook/` — `Lorebook.vue` (333), `LoreEntry.vue` (185),
  `LoreEntryCard.vue` (223)
- `ai/tools/lorebook.js` (~230), most of `ai/tools/read.js`
- The lore tab in `RightSidebar.vue` and `MobileTopBar.vue`

Roughly 1,800 lines out, a few hundred back.

## Regression: lore search and filtering

`Lorebook.vue` has search, category filters, and sorting. The tree has none of
these. Mobile already has a tree tab beside its lore tab, so the tab itself is
not missed — the filtering is.

Accepted for now: `search_documents` covers the model's need, and tree search is
a feature the tree wants anyway, independent of lore.

## Staging

Migration and the removal of the old writers land together:

1. **3a** — migration and schema, document tools replacing lore tools, and the
   lorebook UI/stores/composable deleted. One commit, or a short series merged
   in one go.
2. **3b** — the tree index replaces the outline and lore indexes in `build.js`.

The tempting split — migrate first, delete the lorebook UI later — leaves two
live editors of the same content backed by different tables. An entry edited in
the lorebook panel would not move in the tree, and the reverse, with no sync
between them. The window would be short, but it is the running dev instance
that would be sitting in it.

Keeping the old *tables* is what buys rollback. Keeping the old *writers* buys
nothing and costs divergence.

## What "irreversible" means here

Nothing is deleted. `lorebooks` and `loreEntries` keep every row, as `parts` and
`scenes` still do — nothing has written or deleted those tables since step 1.

Two things do not come back on their own:

- **The schema version.** Dexie throws `VersionError` when the stored version
  exceeds the declared one, so reverting the code does not reopen the database.
  Recovery is a backup restore, or re-declaring v5. This is why `UPGRADES`
  exists.
- **Anything written after the migration.** The legacy rows are a snapshot taken
  at upgrade time, not a live mirror. Rolling back recovers the lorebook as it
  was the moment of the upgrade; lore written after that exists only as
  documents.

Export a backup before running the upgrade. That is the safety hatch, and this
is what it was built for.

## Testing

- `loreToDocuments` unit tests: category folders, uncategorized entries,
  disabled entries, idempotency, orphaned entries, plain-text conversion.
- Backup round-trip across v4 → v5.
- Tool tests for the five document tools.

## Rollback

Branch, as with the previous steps. `lorebooks` and `loreEntries` keep their
rows, so reverting the code recovers the old UI as of the upgrade — subject to
the Dexie `VersionError` caveat above.

## Deferred

- Tree search and filtering in the explorer UI.
- Per-document type or icon by folder (a "character sheet" template).
- Naming format per ordered folder; inheriting `ordered` on create.
