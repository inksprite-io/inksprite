/**
 * @module stores/migrations/modelKeeps
 * @description The model's keeps come off a chat's pins.
 *
 * The model could keep a document with `read_document(keep)`: a pin on the
 * chat, like the writer's, recorded as the model's own in `keptIds`. Only the
 * writer pins now, and what the model reads stays in the conversation instead
 * (.llm/project_context_design.md). A keep left on the pins would become a pin
 * of the writer's that the writer never chose, so it comes off, and `keptIds`
 * goes. The model reads the document again when it wants it.
 *
 * Pure, like the migrations before it, so the Dexie upgrade hook and backup
 * restore share one transform.
 */

/**
 * Take every chat's keeps off its pins, and drop the record of them.
 *
 * Idempotent: a chat with no `keptIds` is left as it is, so a retried upgrade
 * or a backup taken after this one restores unchanged.
 *
 * @param {any[]} chats - `chats` rows
 * @returns {{chats: any[], moved: number}}
 */
export function withoutModelKeeps(chats) {
  let moved = 0

  const out = (chats || []).map(chat => {
    if (!chat || !('keptIds' in chat)) return chat

    moved++
    const { keptIds, pinnedIds, ...rest } = chat
    const kept = new Set(keptIds || [])
    const pins = (pinnedIds || []).filter(id => !kept.has(id))
    return pins.length > 0 ? { ...rest, pinnedIds: pins } : rest
  })

  return { chats: out, moved }
}
