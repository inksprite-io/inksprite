<template>
  <div
    ref="host"
    class="relative flex flex-col gap-3 outline-none"
    tabindex="-1"
    data-comment-thread
    :data-state="state"
    @click="$emit('activate')"
  >
    <!-- The passage, edged as it is highlighted in the text, and what is done
         with the whole thread: resolved, or opened again. A suggestion's
         change instead, what it takes out struck through, and accepted or
         rejected; settled, how it was. -->
    <div class="flex items-start gap-2">
      <p
        class="flex-1 min-w-0 border-l-2 pl-2 text-xs text-surface-500 dark:text-surface-400 line-clamp-2 break-words"
        :class="
          state !== 'open'
            ? 'border-surface-300 dark:border-surface-600'
            : change
              ? 'border-green-500'
              : 'border-yellow-500'
        "
        data-comment-passage
      >
        <template v-if="change">
          <s v-if="change.out" data-change-out>{{ change.out }}</s>
          {{ change.out && change.in ? ' ' : '' }}
          <span
            v-if="change.in"
            class="text-green-700 dark:text-green-400"
            :class="{ 'line-through': state === 'stale' }"
            data-change-in
            >{{ change.in }}</span
          >
        </template>
        <s v-else-if="state === 'stale'">{{ passage }}</s>
        <template v-else>{{ passage }}</template>
      </p>
      <template v-if="change && state === 'open'">
        <Button
          v-tooltip.bottom="tip('Reject')"
          type="button"
          icon="pi pi-times"
          class="!-mt-1.5"
          severity="secondary"
          text
          rounded
          size="small"
          aria-label="Reject"
          data-action="reject-suggestion"
          @click.stop="$emit('reject')"
        />
        <Button
          v-tooltip.bottom="tip('Accept')"
          type="button"
          icon="pi pi-check"
          class="!-mt-1.5 !-mr-1.5"
          severity="success"
          text
          rounded
          size="small"
          aria-label="Accept"
          data-action="accept-suggestion"
          @click.stop="$emit('accept')"
        />
      </template>
      <span
        v-else-if="change && state === 'resolved'"
        class="flex-none text-xs text-surface-400 dark:text-surface-500"
        data-suggestion-settled
        >{{ settledAs }}</span
      >
      <Button
        v-else-if="state === 'resolved'"
        v-tooltip.bottom="tip('Reopen')"
        type="button"
        icon="pi pi-undo"
        class="!-mt-1.5 !-mr-1.5"
        severity="secondary"
        text
        rounded
        size="small"
        aria-label="Reopen"
        data-action="reopen-comment"
        @click.stop="$emit('reopen')"
      />
      <Button
        v-else
        v-tooltip.bottom="tip('Resolve')"
        type="button"
        icon="pi pi-check"
        class="!-mt-1.5 !-mr-1.5"
        severity="secondary"
        text
        rounded
        size="small"
        aria-label="Resolve"
        data-action="resolve-comment"
        @click.stop="$emit('resolve')"
      />
    </div>

    <!-- Who suggested it, when it came from a linked Google Doc. -->
    <p
      v-if="change && suggester"
      class="-mt-1.5 text-xs font-semibold text-surface-500 dark:text-surface-400"
      data-suggestion-author
    >
      {{ suggester }}
    </p>

    <!-- Who said what, each on a line of its own above it. A post's menu is
         on its dots, which show on hovering over it. -->
    <div
      v-if="posts.length > 0"
      class="keeps-scrollbar flex flex-col gap-3 overscroll-contain"
      :class="[popover ? 'max-h-60 overflow-y-auto' : '', textClass]"
      data-comment-said
    >
      <div v-for="(post, index) in posts" :key="index" class="group/post" data-comment-post>
        <!-- The name, and the post's dots at the end of its line, out of the
             way of what was said. -->
        <div class="flex h-5 items-center justify-between gap-2">
          <p
            class="text-xs font-semibold text-surface-500 dark:text-surface-400"
            data-comment-author
          >
            {{ authorOf(post, people) }}
          </p>
          <Button
            type="button"
            icon="pi pi-ellipsis-h"
            class="!w-6 !h-6 flex-none transition-opacity"
            :class="
              menuFor === index
                ? 'opacity-100'
                : active
                  ? 'opacity-0 group-hover/post:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-60'
                  : 'opacity-0 group-hover/post:opacity-100 focus-visible:opacity-100'
            "
            severity="secondary"
            text
            rounded
            size="small"
            aria-label="More"
            aria-haspopup="true"
            data-action="post-menu"
            @click.stop="openMenu($event, index)"
          />
        </div>
        <form
          v-if="editing === index"
          class="mt-1 flex flex-col"
          @submit.prevent="saveEdit(index)"
          @click.stop
        >
          <!-- Enter keeps the change, Shift-Enter starts a line, Escape
               leaves it as it was; the buttons under the field, so that it
               has the width. -->
          <Textarea
            ref="editField"
            v-model="editDraft"
            rows="1"
            auto-resize
            size="small"
            class="w-full max-h-40"
            :class="fieldClass"
            aria-label="Comment"
            data-edit-field
            @keydown.enter="onEnter($event, () => saveEdit(index))"
            @keydown.esc.stop.prevent="cancelEdit"
          />
          <div class="flex justify-end">
            <Button
              v-tooltip.bottom="tip('Cancel')"
              type="button"
              icon="pi pi-times"
              text
              rounded
              size="small"
              aria-label="Cancel"
              data-action="cancel-edit"
              @click="cancelEdit"
            />
            <Button
              v-tooltip.bottom="tip('Save')"
              type="submit"
              icon="pi pi-check"
              text
              rounded
              size="small"
              severity="success"
              aria-label="Save"
              :disabled="!editDraft.trim()"
              data-action="save-edit"
            />
          </div>
        </form>
        <p
          v-else
          class="whitespace-pre-line break-words text-surface-900 dark:text-surface-0"
          data-comment-body
        >
          {{ post.text }}
        </p>
      </div>
    </div>

    <!-- Picking the thread is answering it: Enter sends, Shift-Enter starts a
         line, Escape puts it away. Cancel and Send come under the field once
         there is something in it, so that the field keeps its width. -->
    <form
      v-if="active && state !== 'resolved' && editing === null"
      class="flex flex-col"
      @submit.prevent="sendReply"
      @click.stop
    >
      <Textarea
        ref="replyField"
        v-model="reply"
        rows="1"
        auto-resize
        size="small"
        class="w-full max-h-32"
        :class="fieldClass"
        placeholder="Reply"
        aria-label="Reply"
        data-reply-field
        @keydown.enter="onEnter($event, sendReply)"
        @keydown.esc.stop.prevent="$emit('close')"
      />
      <div v-if="reply.trim()" class="flex justify-end">
        <Button
          v-tooltip.bottom="tip('Cancel')"
          type="button"
          icon="pi pi-times"
          text
          rounded
          size="small"
          aria-label="Cancel"
          data-action="cancel-reply"
          @click="cancelReply"
        />
        <Button
          v-tooltip.bottom="tip('Send')"
          type="submit"
          icon="pi pi-send"
          text
          rounded
          size="small"
          aria-label="Send"
          data-action="send-reply"
        />
      </div>
    </form>

    <!-- A post's menu, under its dots. In the thread rather than over the
         page, so that under the line a pick in it leaves the focus where the
         thread can keep it; and outside the posts, which scroll under the
         line and would cut it off. A pick in it is not a pick of the thread. -->
    <div
      v-if="menuFor !== null"
      ref="menuElement"
      class="absolute z-20 min-w-32 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-900 py-1 shadow-md"
      :style="{ top: `${menuAt.top}px`, right: `${menuAt.right}px` }"
      role="menu"
      data-post-menu
      @click.stop
    >
      <button
        v-for="item in menuItems"
        :key="item.label"
        type="button"
        role="menuitem"
        class="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-surface-700 dark:text-surface-200 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-pointer"
        :data-action="item.action"
        @click="pickItem(item)"
      >
        <i :class="item.icon" class="text-xs text-surface-500 dark:text-surface-400" />
        {{ item.label }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import Button from 'primevue/button'
import Textarea from 'primevue/textarea'
import { submitOnEnter } from '@/utils/touch.js'
import { useScreenSize } from '@/composables/useScreenSize.js'
import { authorOf } from '@/editor/comments.js'
import { isMine } from '@/cloud/people.js'

/**
 * A comment and what has been said on it: the passage at the top with the
 * one thing done to the whole thread (Resolve, or Reopen once resolved),
 * then each post under the name of who wrote it, with Edit and Delete on its
 * dots. Picking the thread is what answers it: it is then `active`, and the
 * field to reply is under the last post. Shared by the comment under the
 * line, the phone's bar, and the Comments tab.
 *
 * A suggestion's thread has its change where the passage is, and Reject and
 * Accept where Resolve is; settled, it says how. It may have no posts: the
 * change says it.
 *
 * Deleting the first post is deleting the comment; deleting another is
 * deleting that reply. Only the writer's own posts can be changed.
 *
 * @typedef {Object} Props
 * @property {string} passage - The words it is on, as they read
 * @property {{out: string, in: string}|null} [change] - A suggestion's: what
 *   it takes out and what it puts in
 * @property {string} [settled] - How a suggestion ended: `accepted`,
 *   `rejected` or `withdrawn`
 * @property {string} [suggester] - Who suggested it, when it came from a
 *   linked Google Doc
 * @property {'open'|'stale'|'resolved'} [state]
 * @property {Array<{author: string, name?: string, by?: number, text: string}>} posts - What has been said, in order
 * @property {import('@/cloud/people.js').People|null} [people] - Who is who, where the project is shared
 * @property {boolean} [active] - Picked: the field to reply shows
 * @property {boolean} [autofocus] - The reply field takes the focus as it shows
 * @property {boolean} [popover] - Under the line or in the phone's bar, at the editor's size
 */
const props = defineProps({
  passage: { type: String, default: '' },
  change: { type: Object, default: null },
  settled: { type: String, default: '' },
  suggester: { type: String, default: '' },
  state: { type: String, default: 'open' },
  posts: { type: Array, required: true },
  people: { type: Object, default: null },
  active: { type: Boolean, default: false },
  autofocus: { type: Boolean, default: false },
  popover: { type: Boolean, default: false },
})

const emit = defineEmits([
  'activate',
  'resolve',
  'reopen',
  'accept',
  'reject',
  'reply',
  'edit',
  'delete',
  'close',
])

/** How a settled suggestion ended, as its card says it. */
const settledAs = computed(
  () =>
    ({ accepted: 'Accepted', rejected: 'Rejected', withdrawn: 'Taken back' })[props.settled] ??
    'Resolved'
)

const { isMobile } = useScreenSize()

// Under the line the thread is at the size of the comment it was; iOS zooms
// in on a field whose text is smaller than 16px, so on a phone it is 16px.
const textClass = computed(() =>
  props.popover
    ? isMobile.value
      ? 'text-base/[1.5rem]'
      : 'text-[0.9375rem]/[1.375rem]'
    : 'text-sm'
)
const fieldClass = computed(() =>
  isMobile.value
    ? '!text-base/[1.5rem]'
    : props.popover
      ? '!text-[0.9375rem]/[1.375rem]'
      : '!text-sm'
)

/**
 * A button's tooltip, where there is a pointer to hover with. On a phone a
 * tap shows it and leaves it up.
 *
 * @param {string} text
 * @returns {string|null}
 */
const tip = text => (isMobile.value ? null : text)

/** @type {import('vue').Ref<HTMLElement|null>} */
const host = ref(null)
/** @type {import('vue').Ref<HTMLElement|null>} */
const menuElement = ref(null)
/** The post whose menu is open. @type {import('vue').Ref<number|null>} */
const menuFor = ref(null)
/** Where the menu is, in the thread: under the dots, its right edge on theirs. */
const menuAt = ref({ top: 0, right: 0 })

/**
 * What can be done with the post whose menu is open: the writer's own can be
 * changed, while the thread is open (in a project shared, only their own,
 * not another's), and any can be deleted.
 *
 * @typedef {{label: string, icon: string, action: string, run: () => void}} MenuItem
 */
const menuItems = computed(() => {
  const index = menuFor.value
  if (index === null) return /** @type {MenuItem[]} */ ([])
  const post = /** @type {{author: string, by?: number}|undefined} */ (props.posts[index])
  return /** @type {MenuItem[]} */ ([
    ...(post && isMine(post, props.people) && props.state !== 'resolved'
      ? [{ label: 'Edit', icon: 'pi pi-pencil', action: 'edit-post', run: () => startEdit(index) }]
      : []),
    {
      label: 'Delete',
      icon: 'pi pi-trash',
      action: 'delete-post',
      run: () => deletePost(index),
    },
  ])
})

/**
 * Make a change that takes away what has the focus, holding the focus in the
 * thread meanwhile, then give it to the reply field. Taken from under the
 * focus, a field gives it to nothing, and under the line a thread that has
 * lost the focus is put away. Only for a thread picked: one only showing
 * leaves the focus in the text.
 *
 * @param {() => void} change
 */
const keepFocus = async change => {
  if (props.active) host.value?.focus({ preventScroll: true })
  change()
  if (!props.active) return
  await nextTick()
  replyField.value?.$el?.focus()
}

/**
 * Delete a post, and give the focus back to the reply field it was near: the
 * menu that had it is gone.
 *
 * @param {number} index
 */
const deletePost = index => keepFocus(() => emit('delete', index))

/** @param {MenuItem} item */
const pickItem = item => {
  menuFor.value = null
  item.run()
}

/**
 * Open a post's menu under its dots, or close it if it is open.
 *
 * @param {MouseEvent} event
 * @param {number} index
 */
const openMenu = (event, index) => {
  if (menuFor.value === index) {
    menuFor.value = null
    return
  }
  const dots = /** @type {HTMLElement} */ (event.currentTarget).getBoundingClientRect()
  const thread = host.value?.getBoundingClientRect()
  if (thread) menuAt.value = { top: dots.bottom - thread.top + 2, right: thread.right - dots.right }
  menuFor.value = index
}

/**
 * A press anywhere but in the menu closes it, as Escape does.
 *
 * @param {Event} event
 */
const closeOutside = event => {
  const target = /** @type {Element} */ (event.target)
  // The dots themselves toggle it, on the click that follows.
  if (target.closest?.('[data-action="post-menu"]') && host.value?.contains(target)) return
  if (!menuElement.value?.contains(target)) menuFor.value = null
}
/** @param {KeyboardEvent} event */
const closeOnEscape = event => {
  if (event.key !== 'Escape') return
  event.stopPropagation()
  menuFor.value = null
}

watch(menuFor, (open, was) => {
  if ((open === null) === (was === null)) return
  const on = open !== null
  // Capturing, so the press that closes it is seen before anything under it
  // can stop it.
  document[on ? 'addEventListener' : 'removeEventListener']('pointerdown', closeOutside, true)
  document[on ? 'addEventListener' : 'removeEventListener']('keydown', closeOnEscape, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeOutside, true)
  document.removeEventListener('keydown', closeOnEscape, true)
})

/** The post being changed, in place. @type {import('vue').Ref<number|null>} */
const editing = ref(null)
const editDraft = ref('')
/** @type {import('vue').Ref<Array<{ $el: HTMLTextAreaElement }>|null>} */
const editField = ref(null)

/**
 * Change a post where it is: picking the thread first, which is what keeps
 * it showing under the line while the field has the focus.
 *
 * @param {number} index
 */
const startEdit = async index => {
  emit('activate')
  editing.value = index
  editDraft.value = /** @type {{text: string}} */ (props.posts[index]).text
  await nextTick()
  const element = editField.value?.[0]?.$el
  element?.focus()
  element?.setSelectionRange(element.value.length, element.value.length)
}

/** @param {number} index */
const saveEdit = index => {
  if (!editDraft.value.trim()) return
  keepFocus(() => {
    emit('edit', index, editDraft.value.trim())
    editing.value = null
  })
}

/** Leave the post as it was. */
const cancelEdit = () =>
  keepFocus(() => {
    editing.value = null
  })

const reply = ref('')
/** @type {import('vue').Ref<{ $el: HTMLTextAreaElement }|null>} */
const replyField = ref(null)

const sendReply = () => {
  if (!reply.value.trim()) return
  emit('reply', reply.value.trim())
  reply.value = ''
}

/** Drop what was written, and put the thread down, as Escape does. */
const cancelReply = () => {
  reply.value = ''
  emit('close')
}

/**
 * Enter does what the field is for and Shift-Enter starts a new line, as in
 * the chat; on a touch screen Enter starts one, and the button does it.
 * Enter that ends a word being composed is the composing's.
 *
 * @param {KeyboardEvent} event
 * @param {() => void} done
 */
const onEnter = (event, done) => {
  if (event.isComposing || event.shiftKey) return
  submitOnEnter(event, done)
}

// The reply field takes the focus as the thread is picked, where asked to.
watch(
  () => props.active,
  async active => {
    if (!active) {
      editing.value = null
      return
    }
    if (!props.autofocus) return
    await nextTick()
    replyField.value?.$el?.focus()
  },
  { immediate: true }
)
</script>

<style scoped>
/* The thread is on the box's own ground, so a scrollbar shown only while it
   scrolls would give no sign that there is more of it: the thumb stays, on no
   track. Safari and Chrome keep a scrollbar they are given a style for. */
.keeps-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.keeps-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.keeps-scrollbar::-webkit-scrollbar-thumb {
  border-radius: 3px;
  background: rgb(128 128 128 / 0.45);
}
@supports not selector(::-webkit-scrollbar) {
  .keeps-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: rgb(128 128 128 / 0.45) transparent;
  }
}
</style>
