<template>
  <div class="group/segment relative">
    <!-- What is asked of this piece of the turn rather than of the turn: the
         name, the time and the reply belong to the whole of it and live in
         ChatTurn, and what the model is sent belongs to the message. Floating,
         because a strip of buttons reserved above every segment would cost more
         room than a run of them is worth — but the words make way for it (see
         below), so it never sits on top of them. A piece that is the whole of
         its turn shows none of its own: the turn's header asks for it. -->
    <div
      v-if="showActions"
      :class="[
        'absolute top-0 right-0 z-10 flex gap-1 rounded-lg bg-surface-0 dark:bg-surface-800 transition-opacity',
        isMobile ? 'opacity-60' : 'opacity-0 group-hover/segment:opacity-100',
      ]"
    >
      <!-- Asking again is only offered where it could answer differently. A
           direction is the sentence it was given, so there is nothing to ask. -->
      <Button
        v-if="repeatable"
        v-tooltip.top="'Ask again'"
        aria-label="Ask again"
        icon="pi pi-refresh"
        text
        rounded
        size="small"
        @click="$emit('regenerate')"
      />
      <Button
        v-tooltip.top="command ? 'Edit command' : 'Edit text'"
        :aria-label="command ? 'Edit command' : 'Edit text'"
        icon="pi pi-pencil"
        text
        rounded
        size="small"
        @click="startEditing"
      />
      <Button
        v-tooltip.top="command ? 'Delete command' : 'Delete text'"
        :aria-label="command ? 'Delete command' : 'Delete text'"
        icon="pi pi-trash"
        text
        rounded
        size="small"
        severity="danger"
        @click="$emit('delete')"
      />
    </div>

    <!-- Somebody speaking or acting. The opposite case to the block below: it
         is exactly something anybody said, so it gets a name and then prose,
         and none of the shape a tool record has. -->
    <div v-if="character" class="flex flex-col gap-1 mb-1">
      <span class="text-xs font-semibold text-primary-600 dark:text-primary-400">
        {{ character }}
      </span>
    </div>

    <!-- A tool the writer ran themselves. Its own shape, because it is not
         something anybody said. -->
    <div
      v-else-if="command"
      class="rounded-lg bg-rose-500/10 border border-surface-200 dark:border-surface-700/50 px-3 py-2 flex flex-col gap-1"
    >
      <div class="flex items-center gap-2 text-xs">
        <!-- A sparkle where a model answered it, as it means everywhere else
             in the app; a bolt for the rest, which answered at once. -->
        <i
          class="pi text-xs text-rose-600 dark:text-rose-300"
          :class="consulted ? 'pi-sparkles' : 'pi-bolt'"
          :data-icon="consulted ? 'model' : 'instant'"
          aria-hidden="true"
        />
        <span class="font-mono font-medium text-rose-700 dark:text-rose-300">{{
          command.name
        }}</span>
        <span v-if="detail" class="text-surface-400">{{ detail }}</span>
      </div>
      <!-- What it was asked. The answer on its own is half a record: "no" is
           not worth reading without the question it answers. -->
      <div v-if="command.label" class="text-sm text-surface-600 dark:text-surface-300">
        {{ command.label }}
      </div>
      <!-- Only until the first words arrive: the answer streams in below, and
           dots beside prose already being written say it has not started. -->
      <div
        v-if="command.pending && !command.result"
        class="px-1 inline-flex items-center gap-2 text-surface-500 self-start"
      >
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
      <!-- A saved prompt: what the writer typed is in the header, and the
           instructions it was filled into fold away under it. They are what
           the model reads, and too long to read every time the turn goes by. -->
      <div v-else-if="command.result && prompted" class="flex flex-col gap-1">
        <button
          type="button"
          class="self-start inline-flex items-center gap-1 text-xs text-surface-500 hover:text-surface-700 dark:hover:text-surface-200"
          :aria-expanded="expandInstructions"
          data-instructions-toggle
          @click="expandInstructions = !expandInstructions"
        >
          <i
            class="pi text-[0.6rem]"
            :class="expandInstructions ? 'pi-chevron-down' : 'pi-chevron-right'"
            aria-hidden="true"
          />
          Instructions
        </button>
        <div
          v-show="expandInstructions"
          class="text-sm text-surface-700 dark:text-surface-200 whitespace-pre-line"
          data-instructions
        >
          {{ command.result }}
        </div>
      </div>
      <div
        v-else-if="command.result && !prose"
        class="text-sm font-semibold text-surface-800 dark:text-surface-100 whitespace-pre-line"
      >
        {{ command.result }}
      </div>
      <p v-if="command.error" class="text-xs text-surface-500 italic m-0">{{ command.error }}</p>
    </div>

    <!-- Its working, when there was a model doing the working. The same block
         an assistant turn gets, because it is the same thing. -->
    <div
      v-if="command?.reasoning"
      class="rounded-lg bg-violet-500/20 border border-surface-200 dark:border-surface-700/50 overflow-hidden my-2"
    >
      <button
        class="w-full text-left text-sm px-3 py-2 flex items-center gap-2 hover:bg-violet-300/10"
        @click="expandReasoning = !expandReasoning"
      >
        <span v-if="command.pending" class="thinking-text text-sm font-medium">Thinking…</span>
        <span v-else-if="thoughtFor" class="text-sm font-medium text-surface-500"
          >Thought for {{ thoughtFor }}</span
        >
        <span v-else class="text-sm font-medium text-surface-500">Thinking</span>
      </button>
      <div
        v-show="expandReasoning"
        class="px-3 py-2 text-sm text-surface-600 dark:text-surface-300 prose dark:prose-invert prose-sm max-w-none border-t-1 border-violet-500/20"
        v-html="reasoningHtml"
      />
    </div>

    <!-- Edit mode. A piece of a turn is edited as the writer would have typed
         it — the command, and the answer written under it, which is what makes
         the text lossless enough to edit. See formatSegment. -->
    <div v-if="isEditing" class="mb-2 flex flex-col gap-2">
      <Textarea
        ref="editTextarea"
        v-model="editValue"
        rows="3"
        auto-resize
        class="w-full"
        :placeholder="command ? 'Edit command...' : 'Edit text...'"
        @keydown="handleEditKeydown"
      />
      <div class="flex items-center gap-2">
        <span v-if="command?.result" class="flex-1 text-xs text-surface-400">
          Clear the line under it to ask again.
        </span>
        <span v-else class="flex-1" />
        <Button
          v-tooltip.top="'Cancel'"
          aria-label="Cancel"
          icon="pi pi-times"
          text
          rounded
          size="small"
          @click="cancelEdit"
        />
        <Button
          v-tooltip.top="'Save'"
          aria-label="Save"
          icon="pi pi-check"
          text
          rounded
          size="small"
          severity="success"
          @click="saveEdit"
        />
      </div>
    </div>

    <!-- What was said: a text segment, or the line a character was given.
         The first line is kept clear of the buttons floating in the corner:
         a float they wrap around, the size of the strip. -->
    <div v-else-if="body" class="prose dark:prose-invert prose-sm sm:prose max-w-none">
      <div
        v-if="showActions"
        class="float-right h-7"
        :class="repeatable ? 'w-24' : 'w-16'"
        aria-hidden="true"
        data-actions-room
      />
      <div data-find-text v-html="bodyHtml" />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, nextTick } from 'vue'
import Button from 'primevue/button'
import Textarea from 'primevue/textarea'
import { useScreenSize } from '@/composables/useScreenSize'
import { holdTurnWhile, useTurnState } from '@/composables/useNearTurns.js'
import { renderMarkdown } from '@/utils/markdown'
import {
  commandRepeatable,
  commandIsCharacter,
  commandWritesProse,
  commandConsults,
  commandIsPrompt,
  commandDetail,
  formatSegment,
  segmentProse,
} from '@/ai/commands.js'
import { formatThinkingTime } from '@/utils/formatters'

const props = defineProps({
  /** @type {import('vue').PropType<import('@/types/models.js').MessageSegment>} */
  segment: { type: Object, required: true },
  /**
   * Whether this piece is the whole of its turn, in which case the turn's
   * header asks its questions for it and it shows no buttons of its own.
   */
  alone: { type: Boolean, default: false },
  /**
   * What the piece's open panels are kept under while the chat is open: its
   * message and where in it the piece is. See useTurnState.
   */
  stateKey: { type: String, default: '' },
})

const emit = defineEmits(['regenerate', 'delete', 'revise'])

const { isMobile } = useScreenSize()

const isEditing = ref(false)
const editValue = ref('')
const editTextarea = ref()
holdTurnWhile(isEditing)

/** Whether the piece has buttons of its own to show. */
const showActions = computed(() => !props.alone && !isEditing.value)

/** The record, when this piece of the turn is a tool the writer ran. */
const command = computed(() =>
  props.segment.type === 'command' ? props.segment.command : undefined
)

/**
 * Who is speaking, when the writer said it was somebody.
 *
 * Empty for every real command, and the whole difference in how this renders:
 * a character's line is prose under a name, not an answer in a box.
 */
const character = computed(() => {
  if (!command.value || !commandIsCharacter(command.value)) return ''
  const { name } = command.value
  return name.charAt(0).toUpperCase() + name.slice(1)
})

/** Whether a model answered it, rather than a die or the writer's own words. */
const consulted = computed(() => Boolean(command.value && commandConsults(command.value)))

/** Whether asking again could answer differently — dice, or a model. */
const repeatable = computed(() => Boolean(command.value && commandRepeatable(command.value)))

/** The working beside the answer: the odds a question was asked at. */
const detail = computed(() => (command.value ? commandDetail(command.value) : ''))

/**
 * Whether this answer wants the room a paragraph needs: a character's line, or
 * something a model wrote. An oracle's four words do not.
 */
const prose = computed(() => Boolean(command.value && commandWritesProse(command.value)))

/** The prose of it, which a character and an interpretation have. */
const body = computed(() => segmentProse(props.segment))

const bodyHtml = computed(() => renderMarkdown(body.value))

const expandReasoning = useTurnState(`${props.stateKey}:reasoning`, false)

/** Whether this is a saved prompt, whose instructions fold away under what was typed. */
const prompted = computed(() => Boolean(command.value && commandIsPrompt(command.value)))
const expandInstructions = useTurnState(`${props.stateKey}:instructions`, false)
const reasoningHtml = computed(() => renderMarkdown(command.value?.reasoning || ''))

/** How long it thought, measured to its first word rather than its last. */
const thoughtFor = computed(() =>
  command.value?.thought ? formatThinkingTime(command.value.thought) : ''
)

const startEditing = async () => {
  editValue.value = formatSegment(props.segment)
  isEditing.value = true
  await nextTick()
  editTextarea.value?.$el?.focus()
}

const cancelEdit = () => {
  isEditing.value = false
  editValue.value = ''
}

/**
 * The editor stays open until whoever handles this says it worked, so an edit
 * that is refused does not take what was typed with it.
 */
const saveEdit = () => {
  emit('revise', editValue.value, error => {
    if (!error) cancelEdit()
  })
}

/** @param {KeyboardEvent} event */
const handleEditKeydown = event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    saveEdit()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelEdit()
  }
}
</script>

<style scoped>
/* A table or a link with no spaces in it can be wider than the chat on a
   phone. The table scrolls on its own and the link breaks, rather than the
   whole chat scrolling sideways. */
.prose {
  overflow-wrap: break-word;
}

.prose :deep(table) {
  display: block;
  overflow-x: auto;
}

.typing-dot {
  width: 4px;
  height: 4px;
  border-radius: 9999px;
  background: color-mix(in oklab, currentColor 70%, transparent);
  display: inline-block;
  animation: td 1.2s infinite ease-in-out;
}
.typing-dot:nth-child(2) {
  animation-delay: 0.15s;
}
.typing-dot:nth-child(3) {
  animation-delay: 0.3s;
}

.thinking-text {
  animation: pulse 1.5s infinite ease-in-out;
}

@keyframes td {
  0%,
  60%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }
  30% {
    opacity: 1;
    transform: translateY(-2px);
  }
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}
</style>
