<template>
  <!-- Focusable, so the focus stays here when what had it goes: a card's
       Accept, with the card. Mod-Z here takes back what was done. -->
  <div
    ref="root"
    class="w-full h-full flex flex-col outline-none"
    tabindex="-1"
    data-comments-panel
    @keydown="onKeydown"
  >
    <PanelHeader title="Comments">
      <HeaderButton
        icon="pi pi-history"
        :label="showResolved ? 'Hide resolved comments' : 'Show resolved comments'"
        :class="{ 'opacity-50': !showResolved }"
        data-action="show-resolved"
        @click="showResolved = !showResolved"
      />
    </PanelHeader>

    <ScrollPanel ref="scroller" class="flex-1 min-h-0 overflow-auto">
      <p
        v-if="shown.length === 0"
        class="p-4 text-sm text-surface-500 dark:text-surface-400"
        data-notice="no-comments"
      >
        {{
          groups.length === 0 ? 'No comments in this project.' : 'No open comments in this project.'
        }}
      </p>

      <div v-else class="flex flex-col gap-4 p-2 pb-16">
        <section
          v-for="group in shown"
          :key="group.documentId"
          class="flex flex-col gap-2"
          :data-comments-document="group.documentId"
        >
          <!-- The document, to open it where it was left. -->
          <button
            type="button"
            class="px-2 text-left text-xs font-semibold truncate hover:text-surface-900 dark:hover:text-surface-0 cursor-pointer"
            :class="
              group.documentId === documentId
                ? 'text-primary-600 dark:text-primary-400'
                : 'text-surface-600 dark:text-surface-300'
            "
            :data-open="group.documentId === documentId || undefined"
            :title="group.path"
            @click="$emit('open-document', group.documentId)"
          >
            {{ group.path }}
          </button>

          <!-- The document's comments, a new one being written among them in
               its place in the text. Picking a thread makes it the current
               comment, which goes to it in the text and opens the field to
               reply; the caret going into its passage does the same, and
               leaving it puts it down. One whose passage is gone has nowhere
               in the text to go. -->
          <template v-for="{ key, comment } in group.items" :key="key">
            <div
              v-if="!comment"
              class="p-3 bg-surface-0 dark:bg-surface-900 shadow-sm rounded-lg ring-2 ring-primary-400 dark:ring-primary-500"
              data-comment-entry="draft"
            >
              <CommentDraft
                :passage="draft.passage"
                @add="text => addDraft(group.documentId, text)"
                @cancel="cancelDraft(group.documentId)"
              />
            </div>
            <div
              v-else
              class="p-3 bg-surface-0 dark:bg-surface-900 shadow-sm rounded-lg hover:shadow-md transition-shadow duration-200"
              :class="{
                'ring-2 ring-primary-400 dark:ring-primary-500': isCurrent(
                  group.documentId,
                  comment.id
                ),
                'opacity-70': comment.state === 'resolved',
                'cursor-pointer': !isCurrent(group.documentId, comment.id),
              }"
              :data-comment-entry="comment.id"
              :data-state="comment.state"
            >
              <CommentThread
                :passage="comment.passage"
                :change="comment.change ?? null"
                :settled="comment.thread.suggestion?.settled ?? ''"
                :suggester="suggesterOf(comment.thread.suggestion)"
                :state="comment.state"
                :posts="comment.thread.posts"
                :people="people"
                :active="isCurrent(group.documentId, comment.id)"
                @activate="pick(group.documentId, comment)"
                @resolve="keep(() => comments.resolve(group.documentId, comment.id))"
                @reopen="keep(() => reopen(group.documentId, comment.id))"
                @accept="keep(() => comments.accept(group.documentId, comment.id))"
                @reject="keep(() => comments.reject(group.documentId, comment.id))"
                @reply="text => comments.reply(group.documentId, comment.id, text)"
                @edit="
                  (index, text) => comments.editPost(group.documentId, comment.id, index, text)
                "
                @delete="
                  index => keep(() => comments.deletePost(group.documentId, comment.id, index))
                "
                @close="comments.leave(group.documentId)"
              />
              <p
                v-if="unplaced.has(keyOf(group.documentId, comment.id))"
                class="mt-2 text-xs text-surface-500 dark:text-surface-400"
                data-notice="unplaced"
              >
                Its words are no longer in the text.
              </p>
            </div>
          </template>
        </section>
      </div>
    </ScrollPanel>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import ScrollPanel from 'primevue/scrollpanel'
import HeaderButton from '../layout/HeaderButton.vue'
import PanelHeader from '../layout/PanelHeader.vue'
import CommentDraft from './CommentDraft.vue'
import CommentThread from './CommentThread.vue'
import { useComments } from '@/composables/useComments.js'
import { usePeople } from '@/cloud/people.js'
import { suggesterOf } from '@/editor/comments.js'
import { useEditor } from '@/composables/useEditor.js'
import { isTextField } from '@/utils/focus.js'

/**
 * Every comment in the project, by document in the outline's order, each as
 * its thread (see `CommentThread`): the open ones, then those whose passages
 * were deleted, struck through, and when asked for, the resolved ones. A
 * suggestion is among them in the text's order, accepted or rejected from
 * its card, and listed with the resolved once it is.
 * Picking one makes it the current comment, as the caret going into its
 * passage does: it is gone to, ringed, and has the field to reply. A resolved
 * one can be opened again on its passage. On the desktop a new comment is
 * written here too, in its place among its document's comments, on the
 * passage the text keeps tinted for it. Mod-Z here takes back the last thing
 * done to a comment or a suggestion, and Shift-Mod-Z does it again.
 *
 * @typedef {Object} Props
 * @property {string} storyId
 * @property {string} [documentId] - The document open in the editor, whose name is marked
 */
const props = defineProps({
  storyId: { type: String, required: true },
  documentId: { type: String, default: '' },
})

const emit = defineEmits(['open-document'])

const comments = useComments(props.storyId)
const people = usePeople(() => props.storyId)
const { groups, current } = comments
const editor = useEditor()

/** Whether the resolved comments are listed too. */
const showResolved = ref(false)

/**
 * An entry in a document's list: a comment, or with none, the new one being
 * written.
 *
 * @typedef {{key: string, comment: import('@/composables/useComments.js').ListedComment|null}} ListItem
 */

/**
 * The documents with something to list, and what, in order: the open
 * comments with a new one being written in its place among them, then the
 * stale, then the resolved when asked for.
 */
const shown = computed(() =>
  groups.value.flatMap(group => {
    const listed = [
      ...group.comments,
      ...group.stale,
      ...(showResolved.value ? group.resolved : []),
    ]
    /** @type {ListItem[]} */
    const items = listed.map(comment => ({ key: comment.id, comment }))
    if (draft.value?.documentId === group.documentId) {
      items.splice(group.draftAt ?? 0, 0, { key: 'draft', comment: null })
    }
    return items.length > 0 ? [{ ...group, items }] : []
  })
)

/** The new comment being written, if one is. */
const draft = comments.draft

/**
 * Make the new comment, and go back to the text, where the writer was.
 *
 * @param {string} documentId
 * @param {string} text
 */
const addDraft = (documentId, text) => {
  comments.addDraft(text)
  editor.focus(documentId)
}

/**
 * Drop the new comment, and go back to the text.
 *
 * @param {string} documentId
 */
const cancelDraft = documentId => {
  comments.cancelDraft()
  editor.focus(documentId)
}

/**
 * @param {string} documentId
 * @param {string} id
 */
const isCurrent = (documentId, id) =>
  current.value?.documentId === documentId && current.value.id === id

/** The resolved comments Reopen could not find a place for. */
const unplaced = ref(new Set())

/**
 * @param {string} documentId
 * @param {string} id
 */
const keyOf = (documentId, id) => `${documentId} ${id}`

/**
 * Pick a thread: it becomes the current comment, which opens the field to
 * reply under it, and is gone to if it is on the text. It is made current
 * before its document opens, so the editor showing it finds it waiting. A
 * thread already picked stays as it is.
 *
 * @param {string} documentId
 * @param {import('@/composables/useComments.js').ListedComment} comment
 */
const pick = (documentId, comment) => {
  if (isCurrent(documentId, comment.id)) return
  comments.goTo(documentId, comment.id)
  if (comment.state === 'open') emit('open-document', documentId)
}

/** @type {import('vue').Ref<{ $el: HTMLElement }|null>} */
const scroller = ref(null)

/**
 * The list's entry for a comment, or for the new one being written.
 *
 * @param {string} documentId
 * @param {string} id
 * @returns {HTMLElement|null}
 */
const entryOf = (documentId, id) =>
  scroller.value?.$el?.querySelector?.(
    `[data-comments-document="${documentId}"] [data-comment-entry="${id}"]`
  ) ?? null

// The current comment in sight in the list, wherever it was made current:
// the caret going into its passage, say.
watch(current, async now => {
  if (!now) return
  await nextTick()
  entryOf(now.documentId, now.id)?.scrollIntoView?.({ block: 'nearest' })
})

// A reply asked for from the text: the current comment's field takes the
// focus.
watch(comments.replyRequest, async () => {
  const now = current.value
  if (!now) return
  await nextTick()
  const entry = entryOf(now.documentId, now.id)
  entry?.scrollIntoView?.({ block: 'nearest' })
  const field = /** @type {HTMLElement|null|undefined} */ (
    entry?.querySelector('[data-reply-field]')
  )
  field?.focus()
})

// A new comment begun in the text, in the middle of the list, its field
// focused by itself: each one begun, and the one there as the list opens,
// which beginning one is how the list came to be shown.
watch(
  draft,
  async now => {
    if (!now) return
    await nextTick()
    entryOf(now.documentId, 'draft')?.scrollIntoView?.({ block: 'center' })
  },
  { immediate: true, flush: 'post' }
)

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)

/**
 * Do something that takes its button away with it, the focus held here
 * first: given to nothing, it would leave Mod-Z with nothing to take back.
 *
 * @param {() => void} act
 */
const keep = act => {
  root.value?.focus({ preventScroll: true })
  act()
}

/**
 * Mod-Z takes back the last thing done to a comment or a suggestion, and
 * Shift-Mod-Z or Mod-Y does it again, as they do in the text; in a field,
 * they are the field's.
 *
 * @param {KeyboardEvent} event
 */
const onKeydown = event => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) return
  if (isTextField(/** @type {Element|null} */ (event.target))) return
  const key = event.key.toLowerCase()
  if (key === 'z' && !event.shiftKey) comments.undo()
  else if ((key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey)) comments.redo()
  else return
  // The browser's own undo, or the desktop app's menu's, would reach into
  // the text behind the editor's back.
  event.preventDefault()
}

/**
 * Open a resolved comment again, or say its words are gone.
 *
 * @param {string} documentId
 * @param {string} id
 */
const reopen = (documentId, id) => {
  const key = keyOf(documentId, id)
  if (comments.reopen(documentId, id)) unplaced.value.delete(key)
  else unplaced.value = new Set([...unplaced.value, key])
}
</script>
