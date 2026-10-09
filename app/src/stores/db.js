import Dexie from 'dexie'
import { partsAndScenesToDocuments } from './migrations/documents.js'
import { documentsToProjectTree } from './migrations/projectTree.js'
import { loreToDocuments } from './migrations/lore.js'
import { lastSceneToLastDocument } from './migrations/lastDocument.js'
import { overviewToRootSummary } from './migrations/overview.js'
import { commandArgsToInput } from './migrations/commandInput.js'
import { commandsIntoTheirVoice } from './migrations/commandVoice.js'
import { markCharacters } from './migrations/characterSigil.js'
import { foldTurns } from './migrations/turnSegments.js'
import { foldRuns } from './migrations/turnRuns.js'
import { documentsToMarkdown } from './migrations/markdown.js'
import { promptsToProfiles, chatsToProfiles, storiesToProfiles } from './migrations/profiles.js'
import { summariesIntoPlace } from './migrations/summariesInPlace.js'
import { FLAGGED_TABLES, deletedIds } from './migrations/purgeDeleted.js'
import { rolesToSkills } from './migrations/profileSkills.js'
import { rolesToWorkflows } from './migrations/jobWorkflows.js'
import { withoutModelKeeps } from './migrations/modelKeeps.js'
import { allowedProvidersToPresets } from './migrations/allowedProviders.js'

/**
 * @typedef {import('../types/models.js').Story} Story
 * @typedef {import('../types/models.js').Part} Part
 * @typedef {import('../types/models.js').Scene} Scene
 * @typedef {import('../types/models.js').Document} Document
 * @typedef {import('../types/models.js').Chat} Chat
 * @typedef {import('../types/models.js').Message} Message
 * @typedef {import('../types/models.js').Lorebook} Lorebook
 * @typedef {import('../types/models.js').LoreEntry} LoreEntry
 * @typedef {import('../types/models.js').AIProvider} AIProvider
 * @typedef {import('../types/models.js').AIPreset} AIPreset
 */

// Create database instance
/** @type {any} */
const db = new Dexie('inksprite')

// Define schema - only indexed fields need to be declared
// Note: Boolean fields like 'deleted' are not indexed due to IndexedDB limitations
db.version(1).stores({
  // Stories table
  stories: 'id, updated',

  // Parts table - indexed by story for efficient loading
  parts: 'id, storyId, order',

  // Scenes table - indexed by part for efficient loading
  scenes: 'id, partId, order',

  // Chats table - indexed by story
  chats: 'id, storyId',

  // Messages table - indexed by chat and creation time
  messages: 'id, chatId, created',

  // Lorebooks table - one per story
  lorebooks: 'id, storyId',

  // Lore entries table - indexed by lorebook and category
  // Note: activationKeys is NOT indexed (it's an array)
  loreEntries: 'id, lorebookId, category',

  // Scene beats table. The feature was never implemented — nothing ever wrote
  // a row — and the store is gone. Left declared because Dexie errors on an
  // existing table that a later version stops declaring.
  sceneBeats: 'id, storyId',

  // AI Configuration tables
  // AI Providers - endpoints and credentials
  aiProviders: 'id, name, type',

  // AI Parameter Presets - no longer used; kept so Dexie doesn't error on
  // existing installs that already have this table in IndexedDB.
  aiParameterPresets: 'id, name',

  // AI Profiles - complete configurations for chat/write
  aiProfiles: 'id, name, type',
})

// Saved system prompts, shared across every story. Dexie carries the version 1
// tables forward, so only the new one is declared here.
db.version(2).stores({
  aiPrompts: 'id, name',
})

// Parts and scenes fold into one document tree. The old tables are left
// declared and populated: Dexie carries version 1 tables forward when they
// aren't redeclared, and keeping the rows is what makes this reversible.
db.version(3)
  .stores({
    // Documents table - a story's whole tree, indexed by story and by parent
    documents: 'id, storyId, parentId',
  })
  .upgrade(async tx => {
    const [parts, scenes] = await Promise.all([
      tx.table('parts').toArray(),
      tx.table('scenes').toArray(),
    ])

    const { documents, skipped } = partsAndScenesToDocuments(parts, scenes)
    if (skipped.length > 0) {
      console.warn(`Skipped ${skipped.length} rows migrating to documents:`, skipped)
    }
    if (documents.length > 0) {
      await tx.table('documents').bulkPut(documents)
    }
    console.log(`Migrated ${parts.length} parts and ${scenes.length} scenes to documents`)
  })

// Every story gains a root node and a default folder structure. Acts move
// under `manuscript`, which is where `ordered` can finally live — the story
// record is not a folder, so a top-level sequence had nowhere to declare
// itself. No schema change; the documents table is redeclared unchanged.
db.version(4)
  .stores({
    documents: 'id, storyId, parentId',
  })
  .upgrade(async tx => {
    const [documents, stories] = await Promise.all([
      tx.table('documents').toArray(),
      tx.table('stories').toArray(),
    ])

    const { documents: restructuredDocs, restructured } = documentsToProjectTree(documents, stories)
    if (restructuredDocs.length > 0) {
      await tx.table('documents').bulkPut(restructuredDocs)
    }
    console.log(`Built a project tree for ${restructured.length} stories`)
  })

// Lore entries become documents under `notes`. `lorebooks` and `loreEntries`
// are left declared and populated, like `parts` and `scenes` before them: the
// rows are the way back, and nothing writes them once the tree owns lore.
db.version(5)
  .stores({
    documents: 'id, storyId, parentId',
  })
  .upgrade(async tx => {
    const [lorebooks, loreEntries, documents] = await Promise.all([
      tx.table('lorebooks').toArray(),
      tx.table('loreEntries').toArray(),
      tx.table('documents').toArray(),
    ])

    const { documents: loreDocs, skipped } = loreToDocuments(lorebooks, loreEntries, documents)
    if (skipped.length > 0) {
      console.warn(`Skipped ${skipped.length} lore entries migrating to documents:`, skipped)
    }
    if (loreDocs.length > 0) {
      await tx.table('documents').bulkPut(loreDocs)
    }
    console.log(`Migrated ${loreEntries.length} lore entries to ${loreDocs.length} documents`)
  })

// `Story.lastSceneId` becomes `lastDocumentId`. No schema change — the field
// is not indexed — but the rows carry a name for a type the app no longer has.
db.version(6)
  .stores({
    stories: 'id, updated',
  })
  .upgrade(async tx => {
    const stories = await tx.table('stories').toArray()
    const { stories: renamedStories, renamed } = lastSceneToLastDocument(stories)
    if (renamed > 0) {
      await tx.table('stories').bulkPut(renamedStories)
    }
    console.log(`Renamed lastSceneId on ${renamed} stories`)
  })

// `Story.overview` becomes the root document's summary, so the project tree
// carries the synopsis the same way it carries every other summary. The story
// row keeps its `overview` field: nothing reads it now, but it is the way back.
db.version(7).upgrade(async tx => {
  const [stories, documents] = await Promise.all([
    tx.table('stories').toArray(),
    tx.table('documents').toArray(),
  ])

  const { documents: roots, moved } = overviewToRootSummary(stories, documents)
  if (moved > 0) {
    await tx.table('documents').bulkPut(roots)
  }
  console.log(`Moved ${moved} story overviews onto their root documents`)
})

// Slash commands are typed as a line now rather than as quoted words, so a
// stored command holds the sentence it was given instead of the tokens it
// arrived as. Nothing else about the record changes: the same question, asked
// the same way, still reruns.
db.version(8).upgrade(async tx => {
  const messages = await tx.table('messages').toArray()
  const { messages: rewritten, converted } = commandArgsToInput(messages)
  if (converted > 0) {
    await tx.table('messages').bulkPut(rewritten)
  }
  console.log(`Rewrote ${converted} stored slash commands`)
})

// A command's message holds its answer rather than the tagged block the model
// reads, and the ones that consulted a model hold it in the assistant's voice.
// The tag goes on at the wire now, which is what lets an interpretation stream
// into the message the way every other assistant turn does.
db.version(9).upgrade(async tx => {
  const messages = await tx.table('messages').toArray()
  const { messages: rewritten, moved } = commandsIntoTheirVoice(messages)
  if (moved > 0) {
    await tx.table('messages').bulkPut(rewritten)
  }
  console.log(`Moved ${moved} commands into their own voice`)
})

// A character is written `@emily` now rather than as a name no command
// answered to, so a stored record says which it is instead of leaving it to be
// worked out — which was only ever right until the command list changed.
db.version(10).upgrade(async tx => {
  const messages = await tx.table('messages').toArray()
  const { messages: marked, marked: count } = markCharacters(messages)
  if (count > 0) {
    await tx.table('messages').bulkPut(marked)
  }
  console.log(`Marked ${count} commands as the people they are`)
})

// A turn is one message holding what it was made of, rather than one message
// per piece. Both ends were already putting the pieces back together — the UI
// grouped them, the builder joined them — so the split bought nothing and cost
// an ordering that only a timestamp held together.
db.version(11).upgrade(async tx => {
  const messages = await tx.table('messages').toArray()
  const { messages: folded, folded: count } = foldTurns(messages)
  if (count > 0) {
    const kept = new Set(folded.map(message => message.id))
    const gone = messages.filter(message => !kept.has(message.id)).map(message => message.id)
    await tx.table('messages').bulkPut(folded)
    if (gone.length > 0) await tx.table('messages').bulkDelete(gone)
  }
  console.log(`Folded ${count} turns into one message each`)
})

// The writer's turn is kept one message as it goes now — more written under a
// turn pushed in without a reply joins it, and two of theirs left touching by
// a deletion fold back together — so a run of them that was stored before
// that is folded the same way. A summary standing over any of them keeps
// standing for the same messages.
db.version(12).upgrade(async tx => {
  const messages = await tx.table('messages').toArray()
  const { messages: folded, folded: count } = foldRuns(messages)
  if (count > 0) {
    const kept = new Set(folded.map(message => message.id))
    const gone = messages.filter(message => !kept.has(message.id)).map(message => message.id)
    await tx.table('messages').bulkPut(folded)
    if (gone.length > 0) await tx.table('messages').bulkDelete(gone)
  }
  console.log(`Folded ${count} runs of the writer's messages into one each`)
})

// Documents hold markdown now: what the model reads and writes, what the
// editor serializes to, what a file on disk will be. The Tiptap HTML they held
// is read through the editor's own schema and written out again, so what
// survives is what the editor could show. Content is the only field that
// changes; there is no way back but a backup taken before this ran.
db.version(13).upgrade(async tx => {
  const documents = await tx.table('documents').toArray()
  const { documents: converted, converted: count } = documentsToMarkdown(documents)
  if (count > 0) {
    await tx.table('documents').bulkPut(converted)
  }
  console.log(`Converted ${count} documents to markdown`)
})

// The prompt library becomes chat profiles. A prompt was text a chat could be
// pointed at, with everything else about how the chat ran kept on the chat; a
// profile is all of it in one place. Saved prompts keep their ids so the chats
// that named them can carry the id straight across, and the `aiPrompts` table
// stays where it is as the record of what was there before.
db.version(14)
  .stores({
    chatProfiles: 'id, name',
  })
  .upgrade(async tx => {
    const prompts = await tx.table('aiPrompts').toArray()
    const { profiles } = promptsToProfiles(prompts)
    if (profiles.length > 0) await tx.table('chatProfiles').bulkPut(profiles)

    const { chats, converted } = chatsToProfiles(await tx.table('chats').toArray())
    if (converted > 0) await tx.table('chats').bulkPut(chats)

    const { stories, converted: projects } = storiesToProfiles(await tx.table('stories').toArray())
    if (projects > 0) await tx.table('stories').bulkPut(stories)

    console.log(
      `Made ${profiles.length} chat profiles from saved prompts; ` +
        `moved ${converted} chats and ${projects} projects onto profiles`
    )
  })

// A file's bytes, beside the document that describes it. Its own table so
// that opening a project — which reads every document row in it to draw the
// tree — does not read every paper in it too. The row is written straight to
// Dexie rather than through syncStore, whose deep clone through JSON would
// turn a Blob into `{}`; see stores/filesStore.js. No rows change shape here,
// so there is nothing to upgrade.
db.version(16).stores({
  files: 'id, storyId',
})

// A delete removes the row. Until now it only marked one, and a sweep at
// startup dropped rows marked longer than a month; whatever the trash held
// when this version arrived goes with it. A file's bytes go with its document.
db.version(17).upgrade(async tx => {
  let removed = 0
  for (const name of FLAGGED_TABLES) {
    const ids = deletedIds(await tx.table(name).toArray())
    if (ids.length === 0) continue
    if (name === 'documents') {
      const files = (await tx.table('files').bulkGet(ids)).filter(Boolean).map(row => row.id)
      if (files.length > 0) await tx.table('files').bulkDelete(files)
    }
    await tx.table(name).bulkDelete(ids)
    removed += ids.length
  }
  console.log(`Emptied the trash: ${removed} rows`)
})

// The long jobs a model does for a project — converting a book to Markdown,
// a chunk at a time — each a row holding its plan, every step's state and
// output, and where it got to, so a tab closed halfway resumes from the step
// after the last one that finished. Written straight to Dexie, like files.
db.version(18).stores({
  jobs: 'id, storyId, status',
})

// A profile's wording for its roles is its wording for its skills: the same
// prompts, keyed by what the writer types, and Compaction's under `compact`.
// "Role" meant which model a piece of work runs on then, since renamed workflows.
db.version(19).upgrade(async tx => {
  const { profiles, moved } = rolesToSkills(await tx.table('chatProfiles').toArray())
  if (moved > 0) await tx.table('chatProfiles').bulkPut(profiles)
  console.log(`Moved ${moved} profiles' role wording onto their skills`)
})

// The writer's own skills, app-wide like their profiles: each a SKILL.md and
// the files that came with it. No existing row changes.
db.version(20).stores({
  skills: 'id, name',
})

// What a job's model is picked from were called roles, and are workflows now;
// a job keeps the name under `workflow`.
db.version(21).upgrade(async tx => {
  const { jobs, moved } = rolesToWorkflows(await tx.table('jobs').toArray())
  if (moved > 0) await tx.table('jobs').bulkPut(jobs)
  console.log(`Moved ${moved} jobs' role onto their workflow`)
})

// The MCP servers the writer has connected, app-wide like their skills: where
// each answers, and what it offered when it was last listed.
db.version(22).stores({
  mcpServers: 'id, name',
})

// Only the writer pins: the model's keeps come off the pins they rode on, and
// what it reads stays in the conversation instead.
db.version(23).upgrade(async tx => {
  const { chats, moved } = withoutModelKeeps(await tx.table('chats').toArray())
  if (moved > 0) await tx.table('chats').bulkPut(chats)
  console.log(`Took the model's keeps off ${moved} chats' pins`)
})

// Which providers may serve is the preset's, beside the model it was chosen
// for: a connection's allowed list moves onto every preset that uses it.
db.version(24).upgrade(async tx => {
  const { providers, presets, moved } = allowedProvidersToPresets(
    await tx.table('aiProviders').toArray(),
    await tx.table('aiProfiles').toArray()
  )
  if (moved > 0) {
    await tx.table('aiProviders').bulkPut(providers)
    await tx.table('aiProfiles').bulkPut(presets)
  }
  console.log(`Moved ${moved} connections' allowed providers onto their presets`)
})

// The writer's wording of a built-in skill, for every chat, keyed by the
// skill's name. No existing row changes.
db.version(25).stores({
  skillWordings: 'name',
})

// A summary is stored where it is read: above the turns it kept, rather than at
// the end of the chat with a count of how far to hoist it. What the writer
// sees, what the model is sent, and what a fork or a rewind cuts by become one
// order, and every summary of a game compacted more than once is read.
db.version(15).upgrade(async tx => {
  const messages = await tx.table('messages').toArray()
  const { messages: placed, moved } = summariesIntoPlace(messages)
  if (moved > 0) {
    await tx.table('messages').bulkPut(placed)
  }
  console.log(`Moved ${moved} summaries to where they are read`)
})

export default db
