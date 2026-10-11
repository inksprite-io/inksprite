<template>
  <div class="w-full h-full flex flex-col">
    <PanelHeader title="Comments" />

    <ScrollPanel class="flex-1 min-h-0 overflow-auto">
      <p
        v-if="groups.length === 0"
        class="p-4 text-sm text-surface-500 dark:text-surface-400"
        data-notice="no-comments"
      >
        No comments in this project.
      </p>

      <div v-else class="flex flex-col gap-4 p-2 pb-16">
        <section
          v-for="group in groups"
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

          <div
            v-for="comment in group.comments"
            :key="comment.id"
            class="relative bg-surface-0 dark:bg-surface-900 shadow-sm rounded-lg hover:shadow-md transition-shadow duration-200"
            :class="{
              'ring-2 ring-primary-400 dark:ring-primary-500': isCurrent(
                group.documentId,
                comment.id
              ),
            }"
            :data-comment-entry="comment.id"
          >
            <!-- A long comment is cut to a few lines until it is picked, and
                 again when it is picked a second time. -->
            <button
              type="button"
              class="w-full flex flex-col gap-1.5 p-3 pr-10 text-left cursor-pointer"
              :data-expanded="isExpanded(group.documentId, comment.id) || undefined"
              data-action="go-to-comment"
              @click="pick(group.documentId, comment.id)"
            >
              <!-- The passage, edged as it is highlighted in the text. -->
              <span
                class="border-l-2 border-yellow-500 pl-2 text-xs text-surface-500 dark:text-surface-400 line-clamp-2"
              >
                {{ comment.passage }}
              </span>
              <span
                class="text-sm text-surface-900 dark:text-surface-0 whitespace-pre-line"
                :class="{ 'line-clamp-4': !isExpanded(group.documentId, comment.id) }"
                data-comment-said
              >
                {{ comment.comment }}
              </span>
            </button>
            <Button
              v-tooltip.left="'Resolve'"
              type="button"
              icon="pi pi-check"
              class="!absolute top-2 right-2"
              severity="secondary"
              text
              rounded
              size="small"
              aria-label="Resolve"
              data-action="resolve-comment"
              @click="resolve(group.documentId, comment.id)"
            />
          </div>
        </section>
      </div>
    </ScrollPanel>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import Button from 'primevue/button'
import ScrollPanel from 'primevue/scrollpanel'
import PanelHeader from '../layout/PanelHeader.vue'
import { useComments } from '@/composables/useComments.js'

/**
 * Every comment in the project, by document in the outline's order: the
 * passage each is on and what was said, a long one cut short. Picking one
 * opens its document, goes to it, and shows the whole of it, until it is
 * picked again; Resolve takes it off and leaves the passage. A comment is
 * written, and changed, in the text.
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
const { groups, current, resolve } = comments

/**
 * @param {string} documentId
 * @param {string} id
 */
const isCurrent = (documentId, id) =>
  current.value?.documentId === documentId && current.value.id === id

/** The comments shown whole, by document and id. */
const expanded = ref(new Set())

/**
 * @param {string} documentId
 * @param {string} id
 */
const keyOf = (documentId, id) => `${documentId} ${id}`

/**
 * @param {string} documentId
 * @param {string} id
 */
const isExpanded = (documentId, id) => expanded.value.has(keyOf(documentId, id))

/**
 * Go to the comment and show the whole of it, or cut it short again. It is
 * made current before its document opens, so the editor showing it finds it
 * waiting.
 *
 * @param {string} documentId
 * @param {string} id
 */
const pick = (documentId, id) => {
  const key = keyOf(documentId, id)
  if (!expanded.value.delete(key)) expanded.value.add(key)
  comments.goTo(documentId, id)
  emit('open-document', documentId)
}
</script>
