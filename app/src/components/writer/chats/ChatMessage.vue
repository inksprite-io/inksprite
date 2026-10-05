<template>
  <div class="group/message relative">
    <!-- What is asked of this message rather than of its turn, only when the
         two differ: a turn that is one message has these asked in its header
         (see ChatTurn), and every turn the writer takes is one message however
         it was taken (see useChatCommands). So this only ever floats over
         narration, where a strip reserved above it would cost more room than
         it is worth — never over segments, whose own buttons float in this
         corner. -->
    <div
      v-if="!alone && !isEditing"
      :class="[
        'absolute top-0 right-0 z-10 flex gap-1 rounded-lg bg-surface-0 dark:bg-surface-800 transition-opacity',
        isMobile ? 'opacity-60' : 'opacity-0 group-hover/message:opacity-100',
      ]"
    >
      <!-- Asking again is only offered where it could answer differently. A
           direction is the sentence it was given, so there is nothing to ask. -->
      <Button
        v-if="message?.role === 'assistant'"
        v-tooltip.top="command ? 'Ask again' : 'Regenerate message'"
        icon="pi pi-refresh"
        text
        rounded
        size="small"
        :disabled="command?.pending === true"
        @click="$emit('regenerate', null)"
      />
      <Button
        v-tooltip.top="showRaw ? 'Show rendered' : 'Show raw'"
        icon="pi pi-code"
        text
        rounded
        size="small"
        :class="{ '!text-primary-500': showRaw }"
        @click="showRaw = !showRaw"
      />
      <Button
        v-tooltip.top="command ? 'Edit command' : 'Edit message'"
        icon="pi pi-pencil"
        text
        rounded
        size="small"
        :disabled="command?.pending === true"
        @click="startEditing"
      />
      <Button
        v-tooltip.top="'Delete message'"
        icon="pi pi-trash"
        text
        rounded
        size="small"
        severity="danger"
        @click="$emit('delete', null)"
      />
    </div>

    <!-- What a consultation was asked. It is named by its turn, which is the
         whole point of giving it one, so nothing here repeats the name. -->
    <div
      v-if="command && !raw"
      class="rounded-lg bg-rose-500/10 border border-surface-200 dark:border-surface-700/50 px-3 py-2 flex flex-col gap-1 mb-3"
    >
      <div v-if="detail" class="flex items-center gap-2 text-xs">
        <span class="text-surface-400">{{ detail }}</span>
      </div>
      <div v-if="command.label" class="text-sm text-surface-600 dark:text-surface-300">
        {{ command.label }}
      </div>
      <!-- Only until the first words arrive: a consultation streams into the
           content below, and dots beside prose that is already being written
           say it has not started. -->
      <div
        v-if="command.pending && !message?.content"
        class="px-1 inline-flex items-center gap-2 text-surface-500 self-start"
      >
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
        <span class="typing-dot"></span>
      </div>
      <p v-if="command.error" class="text-xs text-surface-500 italic m-0">{{ command.error }}</p>
    </div>

    <!-- Context (collapsible, assistant only, kept while the Debug setting is on) -->
    <div
      v-if="contextSummary"
      class="rounded-lg bg-amber-500/15 border border-surface-200 dark:border-surface-700/50 overflow-hidden mb-3"
    >
      <button
        class="w-full text-left text-sm px-3 py-2 flex items-center gap-2 hover:bg-amber-400/10"
        @click="expandContext = !expandContext"
      >
        <i class="pi pi-file text-xs text-amber-700 dark:text-amber-300" />
        <span class="text-sm font-medium text-surface-500">Context sent</span>
        <span class="text-xs text-surface-400 truncate">{{ contextSummary }}</span>
      </button>
      <div
        v-if="expandContext"
        class="px-3 py-2 text-xs border-t-1 border-amber-500/20 flex flex-col gap-2"
      >
        <p class="text-surface-400 italic m-0">
          The request that opened this turn. Anything the turn went on to send is under the tool
          calls below.
        </p>
        <div v-for="(entry, index) in contextMessages" :key="index" class="flex flex-col gap-1">
          <div class="font-mono font-semibold text-amber-700 dark:text-amber-300">
            {{ entry.role }}
          </div>
          <pre
            v-if="entry.content"
            class="text-surface-600 dark:text-surface-400 whitespace-pre-wrap break-words m-0 pl-3 border-l-2 border-surface-300 dark:border-surface-700"
            >{{ entry.content }}</pre
          >
          <pre
            v-if="entry.calls"
            class="text-surface-500 whitespace-pre-wrap break-words m-0 pl-3 border-l-2 border-surface-300 dark:border-surface-700"
            >{{ entry.calls }}</pre
          >
        </div>
      </div>
    </div>

    <!-- Reasoning (collapsible, assistant only), and the turn's status: one
         line at the top of the message for what the model is doing. Thinking
         while it thinks; what it is waiting on while its tools run or it takes
         in what they returned; how long it thought once it writes. A model
         that does not think has the box only while it waits. -->
    <div
      v-if="hasThinkingBox"
      class="rounded-lg bg-violet-500/20 border border-surface-200 dark:border-surface-700/50 overflow-hidden mb-3"
      data-thinking-box
    >
      <button
        class="w-full text-left text-sm px-3 py-2 flex items-center gap-2"
        :class="canExpand ? 'hover:bg-violet-300/10' : 'cursor-default'"
        :aria-expanded="canExpand ? expandReasoning : undefined"
        @click="canExpand && toggleReasoning()"
      >
        <ChatStatus v-if="showStatus" :activity="activity" />
        <span v-else-if="isThinking" class="thinking-text text-sm font-medium">Thinking…</span>
        <span v-else-if="formattedThinkingTime" class="text-sm font-medium text-surface-500"
          >Thought for {{ formattedThinkingTime }}</span
        >
      </button>
      <div
        v-if="canExpand"
        v-show="expandReasoning"
        class="px-3 py-2 text-sm text-surface-600 dark:text-surface-300 prose dark:prose-invert prose-sm max-w-none border-t-1 border-violet-500/20"
        v-html="reasoningHtml"
      />
    </div>

    <!-- Each skill the turn consulted, as a block of its own: what it was
         asked, what it thought, the tools it called, what it answered. -->
    <div v-if="consultations.length > 0" class="flex flex-col gap-2 mb-3">
      <ChatConsultation
        v-for="consultation in consultations"
        :key="consultation.id"
        :consultation="consultation"
        :state-key="`${messageId}:consultation:${consultation.id}`"
      />
    </div>

    <!-- What the model is writing into a tool call, as it writes it. The
         prose of a chapter goes into the call rather than the message, and a
         writer waiting minutes on a spinner does not know it is being written. -->
    <div
      v-for="call in inFlight"
      :key="call.id"
      class="rounded-lg bg-sky-500/15 border border-surface-200 dark:border-surface-700/50 overflow-hidden mb-3"
    >
      <div class="text-sm px-3 py-2 flex items-center gap-2">
        <i class="pi pi-spin pi-spinner text-xs text-sky-600 dark:text-sky-300" />
        <span class="text-sm font-medium text-surface-500">{{ call.verb }}</span>
        <span v-if="call.path" class="text-sm text-surface-600 dark:text-surface-300 truncate">{{
          call.path
        }}</span>
      </div>
      <div
        v-if="call.old || call.prose"
        class="px-3 py-2 text-sm border-t-1 border-sky-500/20 flex flex-col gap-2 max-h-72 overflow-auto"
      >
        <pre
          v-if="call.old"
          class="whitespace-pre-wrap break-words m-0 text-surface-400 line-through"
          >{{ call.old }}</pre
        >
        <pre
          v-if="call.prose"
          class="whitespace-pre-wrap break-words m-0 text-surface-700 dark:text-surface-300"
          >{{ call.prose }}</pre
        >
      </div>
    </div>

    <!-- A server's tool the model wants to call, waiting on the writer: it
         does not say it only reads, so it runs only when they allow it. -->
    <div
      v-for="approval in approvals"
      :key="approval.id"
      class="rounded-lg bg-amber-500/10 border border-surface-200 dark:border-surface-700/50 overflow-hidden mb-3"
      data-approval
    >
      <div class="text-sm px-3 pt-2 flex items-start gap-2">
        <i class="pi pi-question-circle text-xs text-amber-600 dark:text-amber-300 mt-1" />
        <span class="text-sm text-surface-600 dark:text-surface-300 min-w-0">
          <span class="font-medium">{{ approval.server }}</span> wants to run
          <span class="font-mono">{{ approval.tool }}</span>
        </span>
      </div>
      <div class="px-3 pb-2 pt-1 flex flex-wrap justify-end gap-2">
        <Button
          label="Deny"
          size="small"
          text
          severity="secondary"
          data-action="deny"
          @click="answerApproval(approval.id, 'deny')"
        />
        <!-- The tool, or the whole server: a server whose every tool asks,
             one at a time, interrupts every turn. -->
        <Button
          label="Always allow"
          icon="pi pi-angle-down"
          icon-pos="right"
          size="small"
          text
          aria-haspopup="true"
          aria-controls="always_allow_menu"
          data-action="always"
          @click="openAlwaysAllow($event, approval)"
        />
        <Button
          label="Allow"
          size="small"
          severity="success"
          data-action="allow"
          @click="answerApproval(approval.id, 'allow')"
        />
      </div>
      <pre
        v-if="approval.args"
        class="px-3 py-2 text-xs border-t-1 border-amber-500/20 whitespace-pre-wrap break-words m-0 text-surface-600 dark:text-surface-400 max-h-48 overflow-auto"
        >{{ approval.args }}</pre
      >
    </div>

    <Menu
      id="always_allow_menu"
      ref="alwaysAllowMenu"
      :model="alwaysAllowChoices"
      :popup="true"
      data-always-allow-menu
    />

    <!-- What the assistant proposed, waiting on the writer or decided. The
         change is shown the way it was shown arriving; the buttons are what
         asking first was for. -->
    <div
      v-for="proposal in proposals"
      :key="`proposal_${proposal.index}`"
      class="rounded-lg bg-amber-500/10 border border-surface-200 dark:border-surface-700/50 overflow-hidden mb-3"
    >
      <div class="text-sm px-3 py-2 flex items-center gap-2">
        <i class="pi pi-pencil text-xs text-amber-600 dark:text-amber-300" />
        <span class="text-sm font-medium text-surface-500">{{ proposal.verb }}</span>
        <span class="text-sm text-surface-600 dark:text-surface-300 truncate flex-1">{{
          proposal.path
        }}</span>
        <template v-if="proposal.status === 'proposed'">
          <Button
            label="Reject"
            size="small"
            text
            severity="secondary"
            @click="$emit('reject', proposal.index)"
          />
          <Button
            label="Accept"
            size="small"
            severity="success"
            @click="$emit('accept', proposal.index)"
          />
        </template>
        <span v-else class="text-xs text-surface-400 capitalize">{{ proposal.status }}</span>
      </div>
      <div
        v-if="proposal.old || proposal.prose"
        class="px-3 py-2 text-sm border-t-1 border-amber-500/20 flex flex-col gap-2 max-h-72 overflow-auto"
      >
        <pre
          v-if="proposal.old"
          class="whitespace-pre-wrap break-words m-0 text-surface-400 line-through"
          >{{ proposal.old }}</pre
        >
        <pre
          v-if="proposal.prose"
          class="whitespace-pre-wrap break-words m-0 text-surface-700 dark:text-surface-300"
          >{{ proposal.prose }}</pre
        >
      </div>
    </div>

    <!-- Tool calls (collapsible, assistant only) -->
    <div
      v-if="toolCalls.length > 0"
      class="rounded-lg bg-sky-500/15 border border-surface-200 dark:border-surface-700/50 overflow-hidden mb-3"
    >
      <button
        class="w-full text-left text-sm px-3 py-2 flex items-center gap-2 hover:bg-sky-400/10"
        @click="expandToolCalls = !expandToolCalls"
      >
        <i class="pi pi-wrench text-xs text-sky-600 dark:text-sky-300" />
        <span class="text-sm font-medium text-surface-500"
          >{{ toolCalls.length }} tool call{{ toolCalls.length === 1 ? '' : 's' }}</span
        >
        <span class="text-xs text-surface-400 truncate">{{ toolCallSummary }}</span>
      </button>
      <div
        v-show="expandToolCalls"
        class="px-3 py-2 text-xs text-surface-600 dark:text-surface-300 border-t-1 border-sky-500/20 flex flex-col gap-2"
      >
        <div v-for="tc in toolCalls" :key="tc.id" class="flex flex-col gap-1">
          <div class="font-mono">
            <span class="font-semibold text-sky-700 dark:text-sky-300">{{ tc.name }}</span>
            <span class="text-surface-500">({{ formatToolArguments(tc.arguments) }})</span>
          </div>
          <div
            v-if="tc.result === null"
            class="text-surface-500 italic pl-3 border-l-2 border-surface-300 dark:border-surface-700"
          >
            running…
          </div>
          <pre
            v-else
            class="text-surface-600 dark:text-surface-400 whitespace-pre-wrap break-words m-0 pl-3 border-l-2 border-surface-300 dark:border-surface-700"
            >{{ tc.resultDisplay }}</pre
          >
          <!-- A server's answer is the model's for this turn only; this keeps
               it in the project. See mcp/saved.js. -->
          <div v-if="tc.savable" class="pl-3 flex items-center gap-2" data-saved-result>
            <template v-if="savedResults[tc.id]">
              <span class="text-surface-500">Saved as {{ savedPath(tc.id) }}</span>
              <button
                type="button"
                class="underline text-sky-700 dark:text-sky-300"
                data-action="open-saved"
                @click="documents().open(savedResults[tc.id])"
              >
                Open
              </button>
            </template>
            <Button
              v-else
              label="Save to project"
              icon="pi pi-file-plus"
              size="small"
              text
              data-action="save-to-project"
              @click="saving = tc"
            />
          </div>
        </div>
      </div>
    </div>

    <SaveToolResultDialog
      v-if="saving"
      :visible="Boolean(saving)"
      :story-id="storyId"
      :server="saving.server"
      :tool="saving.tool"
      :args="saving.arguments"
      :result="saving.result"
      @update:visible="open => !open && (saving = null)"
      @saved="document => markSaved(document)"
    />

    <!-- Edit mode. A command is edited as the line that would ask it, because
         that is the thing the writer wrote; what is stored is the answer it
         got. See formatCommand. -->
    <div v-if="isEditing" class="mb-2 flex flex-col gap-2">
      <Textarea
        ref="editTextarea"
        v-model="editContent"
        rows="4"
        auto-resize
        class="w-full"
        :placeholder="command ? 'Edit command...' : 'Edit message...'"
        @keydown="handleEditKeydown"
      />
      <div class="flex items-center gap-2">
        <span v-if="command" class="flex-1 text-xs text-surface-400">
          Keeps the answer it has. Ask again for a new one.
        </span>
        <span v-else class="flex-1" />
        <Button
          v-tooltip.top="'Cancel'"
          icon="pi pi-times"
          text
          rounded
          size="small"
          @click="cancelEdit"
        />
        <Button
          v-tooltip.top="'Save'"
          icon="pi pi-check"
          text
          rounded
          size="small"
          severity="success"
          @click="saveEdit"
        />
      </div>
    </div>

    <!-- What the model is sent: the whole turn, tags and all. Nothing else in
         here shows that, because nothing else in here is written for it. -->
    <div
      v-else-if="raw"
      class="bg-surface-50 dark:bg-surface-900 rounded-lg p-4 overflow-x-auto border border-surface-200 dark:border-surface-700"
    >
      <pre
        class="text-sm text-surface-700 dark:text-surface-300 whitespace-pre-wrap break-words m-0"
        >{{ message?.content }}</pre
      >
    </div>

    <!-- A turn the writer took, in the pieces they took it in. -->
    <div v-else-if="segments.length" class="flex flex-col gap-2">
      <ChatSegment
        v-for="(segment, index) in segments"
        :key="index"
        :segment="segment"
        :state-key="`${messageId}:${index}`"
        :alone="alone && segments.length === 1"
        @regenerate="$emit('regenerate', index)"
        @delete="$emit('delete', index)"
        @revise="(text, done) => $emit('revise', index, text, done)"
      />
    </div>

    <!-- Content. A consultation has already shown what it was asked. -->
    <div v-else-if="message?.content" class="prose dark:prose-invert prose-sm sm:prose max-w-none">
      <div v-html="contentHtml" />
    </div>

    <!-- Empty state for new messages. Not for a command: its own block is
         already saying it is waiting. Not under the thinking box either,
         which says what the turn is doing: dots that came back with every
         thought and went with every call made the turn jump. -->
    <div
      v-else-if="message && !message.content && !command && !hasThinkingBox"
      class="px-2 inline-flex items-center gap-2 text-surface-500"
    >
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
      <span class="typing-dot"></span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref, nextTick, toRaw } from 'vue'
import Button from 'primevue/button'
import Menu from 'primevue/menu'
import Textarea from 'primevue/textarea'
import ChatSegment from './ChatSegment.vue'
import ChatStatus from './ChatStatus.vue'
import ChatConsultation from './ChatConsultation.vue'
import { useChats } from '@/composables/useChats'
import { useScreenSize } from '@/composables/useScreenSize'
import { holdTurnWhile, useTurnState } from '@/composables/useNearTurns.js'
import { renderMarkdown } from '@/utils/markdown'
import { commandDetail, formatAnswered, formatTurn } from '@/ai/commands.js'
import { describeProgress, describeEdit, writesProse } from '@/ai/tools/progress.js'
import { formatThinkingTime, formatToolArguments, formatToolResult } from '@/utils/formatters'
import { consultationsIn, fromDirectorNote, isConsultation } from '@/ai/skills/consultations.js'
import { useToolApprovals } from '@/composables/useToolApprovals.js'
import { serverTool } from '@/mcp/servers.js'
import { canSave } from '@/mcp/saved.js'
import { useDocuments } from '@/composables/useDocuments.js'
import SaveToolResultDialog from './SaveToolResultDialog.vue'

const props = defineProps({
  messageId: { type: String, required: true },
  storyId: { type: String, required: true },
  showReasoning: { type: Boolean, default: true },
  // Whether this message is its whole turn, in which case the turn's header
  // asks its questions for it and it shows no buttons of its own.
  alone: { type: Boolean, default: false },
  // Shown as the model is sent it, when the turn's header asked for that.
  raw: { type: Boolean, default: false },
  // What the turn being generated into this message is doing right now, or
  // null when none is. Live, not stored: see TurnActivity in useAIChat.js.
  /** @type {import('vue').PropType<import('@/composables/useAIChat.js').TurnActivity|null>} */
  activity: { type: Object, default: null },
})

const emit = defineEmits(['regenerate', 'delete', 'revise', 'accept', 'reject'])

// Get chat API
const chatsApi = useChats(props.storyId)
const { isMobile } = useScreenSize()

// Get message data
/** @type {import('vue').ComputedRef<import('@/types/models.js').Message|null>} */
const message = chatsApi.getMessageById(props.messageId)

// Edit mode state. The turn stays in the page while it is open, so scrolling
// away does not lose what was typed. See useNearTurns.
const isEditing = ref(false)
const editContent = ref('')
const editTextarea = ref()
holdTurnWhile(isEditing)

// What the writer has opened in the message is kept by the chat rather than by
// this component, which goes when the turn is scrolled far enough away.

/** Whether to show the message as the model is sent it: the turn's word when it is the turn, else its own. */
const showRaw = useTurnState(`${props.messageId}:raw`, false)
const raw = computed(() => (props.alone ? props.raw : showRaw.value))

const startEditing = async () => {
  if (isEditing.value) return
  // The whole turn as the writer would have typed it: every piece, with the
  // answers written under the ones that got any. See formatTurn.
  editContent.value = segments.value.length
    ? formatTurn(segments.value)
    : command.value
      ? formatAnswered(command.value)
      : message.value?.content || ''
  isEditing.value = true
  await nextTick()
  editTextarea.value?.$el?.focus()
}

const saveEdit = () => {
  // A command goes back through the composable that owns them: it decides
  // whether the edit is asking again or only rewording the question, and it can
  // refuse a line that is no longer a command at all. The editor stays open
  // until it says otherwise, so a refused edit does not lose what was typed.
  if (command.value || segments.value.length) {
    emit('revise', null, editContent.value, error => {
      if (!error) {
        isEditing.value = false
        editContent.value = ''
      }
    })
    return
  }

  if (message.value && editContent.value !== message.value.content) {
    chatsApi.updateMessage(message.value.id, {
      content: editContent.value,
      edited: true,
      editedAt: Date.now(),
      updated: Date.now(),
    })
  }
  isEditing.value = false
}

const cancelEdit = () => {
  isEditing.value = false
  editContent.value = ''
}

// Opening the editor is this message's own business, and the one thing the
// turn's header reaches into it for.
defineExpose({ startEditing })

/**
 * Handle keyboard shortcuts in edit mode
 * @param {KeyboardEvent} event
 */
const handleEditKeydown = event => {
  // Cmd+Enter (Mac) or Ctrl+Enter (Windows/Linux) to save
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    saveEdit()
  }
  // Escape to cancel
  else if (event.key === 'Escape') {
    event.preventDefault()
    cancelEdit()
  }
}

const contentHtml = computed(() => {
  if (!message.value?.content) return ''
  return renderMarkdown(message.value.content)
})

const reasoningHtml = computed(() => {
  if (!message.value?.reasoningContent) return ''
  return renderMarkdown(message.value.reasoningContent)
})

// Saved context display. Only present when the Debug setting was on for this
// turn; every other message shows nothing here.
const expandContext = useTurnState(`${props.messageId}:context`, false)

/**
 * The request that opened this turn, flattened for display.
 *
 * Tool calls are rendered beside the content they came with rather than
 * dropped: an assistant entry replayed from an earlier turn often has no text
 * at all, and an empty block says nothing about what the model actually sent.
 *
 * @type {import('vue').ComputedRef<Array<{role: string, content: string, calls: string}>>}
 */
const contextMessages = computed(() => {
  const context = message.value?.metadata?.context
  if (!Array.isArray(context)) return []

  return context.map(entry => ({
    role: entry.tool_call_id ? `${entry.role} (${entry.tool_call_id})` : entry.role,
    content: typeof entry.content === 'string' ? entry.content : '',
    calls: entry.tool_calls ? JSON.stringify(entry.tool_calls, null, 2) : '',
  }))
})

/**
 * How much was sent, so the panel is worth opening or it isn't.
 *
 * Counted off the raw request rather than `contextMessages`: a long chat keeps
 * hundreds of these, each hundreds of entries long, and going through the
 * reactive copy would put a proxy and a dependency on every entry of every one
 * of them for a line of text that never changes.
 */
const contextSummary = computed(() => {
  const context = toRaw(message.value?.metadata?.context)
  if (!Array.isArray(context) || context.length === 0) return ''
  const characters = context.reduce(
    (total, entry) =>
      total +
      (typeof entry.content === 'string' ? entry.content.length : 0) +
      (entry.tool_calls ? JSON.stringify(entry.tool_calls, null, 2).length : 0),
    0
  )
  const count = context.length
  return `${count} message${count === 1 ? '' : 's'} · ${characters.toLocaleString()} characters`
})

/**
 * The tool the writer ran, when this message is the record of one rather than
 * something they typed. Absent on every ordinary message, and the whole block
 * with it.
 *
 * @type {import('vue').ComputedRef<import('@/types/models.js').ChatCommand|undefined>}
 */
const command = computed(() => message.value?.metadata?.command)

/**
 * What the turn was made of, when the writer took it in pieces.
 *
 * Empty on a message somebody else spoke: a consultation is one speaker saying
 * one thing, and carries its record in `metadata.command` instead.
 *
 * @type {import('vue').ComputedRef<import('@/types/models.js').MessageSegment[]>}
 */
const segments = computed(() => message.value?.segments || [])

/**
 * The working beside a consultation's answer: how much of the conversation a
 * compaction was told to keep. Never sent — the model is reading the record.
 */
const detail = computed(() => (command.value ? commandDetail(command.value) : ''))

/**
 * Every skill the turn consulted, answered or still running. A turn from when
 * a chat could run the Director ahead of the assistant kept a note of it
 * instead, and that note is the first block.
 */
const consultations = computed(() => {
  const note = message.value?.metadata?.director
  return [
    ...(note ? [fromDirectorNote(note)] : []),
    ...consultationsIn(message.value?.metadata?.apiTrajectory, message.value?.pendingToolCalls),
  ]
})

// Reasoning expansion state
const expandReasoning = useTurnState(`${props.messageId}:reasoning`, false)
const toggleReasoning = () => {
  expandReasoning.value = !expandReasoning.value
}

// Tool call display
const expandToolCalls = useTurnState(`${props.messageId}:tools`, false)

/**
 * Flatten an assistant message's apiTrajectory into a display-ready list of
 * tool calls, each paired with its result content (if available). A call to a
 * skill is a consultation, with a block of its own, and not listed here.
 *
 * @typedef {Object} ToolCallDisplay
 * @property {string} id
 * @property {string} name
 * @property {any} arguments  - Parsed JSON object, or raw string if parse failed
 * @property {string|null} result  - Raw JSON content from tool result, or null if still running
 * @property {string} resultDisplay  - Truncated, prettified version of `result` for display
 * @property {string} server - For a server's tool, the server, as the writer named it
 * @property {string} tool - For a server's tool, the tool, as its server names it
 * @property {boolean} savable - A server's answer that can be kept in the project
 */
const toolCalls = computed(() => {
  /** @type {ToolCallDisplay[]} */
  const out = []
  const trajectory = message.value?.metadata?.apiTrajectory
  if (!Array.isArray(trajectory) || trajectory.length === 0) return out

  const resultsById = new Map()
  for (const item of trajectory) {
    if (item.role === 'tool' && item.tool_call_id) {
      resultsById.set(item.tool_call_id, item)
    }
  }

  for (const item of trajectory) {
    if (item.role !== 'assistant' || !Array.isArray(item.tool_calls)) continue
    for (const tc of item.tool_calls) {
      if (isConsultation(tc.function?.name || '', resultsById.get(tc.id))) continue
      const rawArgs = tc.function?.arguments ?? ''
      let parsedArgs = rawArgs
      try {
        parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs
      } catch {
        // Keep raw string if not valid JSON
      }
      const result = resultsById.has(tc.id) ? resultsById.get(tc.id).content : null
      const name = tc.function?.name || 'unknown'
      // A server's tool, by the server still connected, or by its name's
      // prefix for one that has gone since.
      const found = serverTool(name)
      const prefixed = name.includes('__') ? name.split('__') : null
      out.push({
        id: tc.id,
        name,
        arguments: parsedArgs,
        result,
        resultDisplay: result === null ? '' : formatToolResult(result),
        server: found?.server.name || prefixed?.[0] || '',
        tool: found?.tool.title || found?.tool.name || prefixed?.slice(1).join('__') || name,
        savable: Boolean(found || prefixed) && canSave(result),
      })
    }
  }
  return out
})

/** The project's documents, reached only once a result has been saved. */
const documents = () => useDocuments(props.storyId)

/** The tool call whose result is being saved, while the dialog is open. */
const saving = ref(/** @type {ToolCallDisplay|null} */ (null))

/** Results saved from this turn, by call: the document each became. */
const savedResults = useTurnState(
  `${props.messageId}:saved-results`,
  /** @type {Record<string, string>} */ ({})
)

/** @param {{id: string}} document */
const markSaved = document => {
  if (!saving.value) return
  savedResults.value = { ...savedResults.value, [saving.value.id]: document.id }
}

/** @param {string} callId */
const savedPath = callId => documents().pathOf(savedResults.value[callId]) || 'a document'

/**
 * The calls still in flight, described from however much of them has come.
 * One the trajectory already has a result for is done, whatever the message
 * still says.
 */
const inFlight = computed(() => {
  const pending = message.value?.pendingToolCalls
  if (!Array.isArray(pending) || pending.length === 0) return []
  const done = new Set(toolCalls.value.filter(tc => tc.result !== null).map(tc => tc.id))
  // Only the calls with prose to watch grow. The rest are said in the status
  // line, which stays one line high: a box that came and went with every
  // search made the turn jump on every round.
  return pending
    .filter(call => !done.has(call.id) && writesProse(call.name))
    .map((call, index) => ({
      id: call.id || `pending_${index}`,
      ...describeProgress(call.name, call.arguments),
    }))
})

const { pending: pendingApprovals, answer: answerApproval } = useToolApprovals(
  () => props.messageId
)

/** The call whose Always allow is open, and the choice it offers. */
const alwaysAllowMenu = ref(/** @type {any} */ (null))
const alwaysAllowFor = ref(/** @type {{id: string, server: string, tool: string}|null} */ (null))

const alwaysAllowChoices = computed(() => {
  const approval = alwaysAllowFor.value
  if (!approval) return []
  return [
    { label: 'This tool', command: () => answerApproval(approval.id, 'always') },
    {
      label: `Everything from ${approval.server}`,
      command: () => answerApproval(approval.id, 'always-server'),
    },
  ]
})

/**
 * @param {Event} event
 * @param {{id: string, server: string, tool: string}} approval
 */
const openAlwaysAllow = (event, approval) => {
  alwaysAllowFor.value = approval
  alwaysAllowMenu.value?.toggle(event)
}

/**
 * The calls this turn is waiting on the writer to allow, named the way they
 * were named when the server was added: the server, and the tool's own name.
 */
const approvals = computed(() =>
  pendingApprovals.value.map(approval => {
    const found = serverTool(approval.name)
    let args = approval.arguments
    try {
      args = JSON.stringify(JSON.parse(approval.arguments || '{}'), null, 2)
    } catch {
      // Shown as the model wrote it
    }
    return {
      id: approval.id,
      server: found?.server.name || 'A server',
      tool: found?.tool.title || found?.tool.name || approval.name,
      args: args === '{}' ? '' : args,
    }
  })
)

/**
 * The changes this turn put to the writer, decided or not, in the order the
 * turn made them. A change that went straight in is the tool panel's to show.
 */
const proposals = computed(() => {
  const edits = message.value?.metadata?.documentEdits
  if (!Array.isArray(edits)) return []
  return edits
    .map((edit, index) => ({ index, status: edit.status, ...describeEdit(edit) }))
    .filter(proposal => proposal.status)
})

const toolCallSummary = computed(() => {
  if (toolCalls.value.length === 0) return ''
  const names = toolCalls.value.map(tc => tc.name)
  const unique = Array.from(new Set(names))
  return unique.slice(0, 3).join(', ') + (unique.length > 3 ? '…' : '')
})

// Thinking right now. The turn says so when it is streaming thought, in
// whichever round: a model thinks again after every tool result, long after
// its first thought ended. A consultation has no live turn, and is thinking
// until it first stops.
const isThinking = computed(() => {
  if (props.activity?.phase === 'thinking') return true
  return Boolean(
    message.value?.reasoningContent &&
      message.value?.streamingStartTime &&
      !message.value?.thinkingFinishTime
  )
})

// A call being written, a tool running, or a request out with nothing back
// yet: the stretches the status line speaks for.
const showStatus = computed(() =>
  ['calling', 'running', 'waiting'].includes(props.activity?.phase ?? '')
)

// Whether the box has thinking to open onto, rather than only a status.
const canExpand = computed(() => props.showReasoning && hasReasoning.value)

// The box at the top: thinking to open, or a status to say.
const hasThinkingBox = computed(() => canExpand.value || isThinking.value || showStatus.value)

// Check if we have reasoning content to display
// Not the assistant's alone any more: a command that consults a model has
// thinking of its own, and it is the same thinking this block was built for.
const hasReasoning = computed(() => Boolean(message.value?.reasoningContent))

// Every stretch the turn thought for, added up; a turn from before that was
// kept thought from its start until its thinking first stopped.
const formattedThinkingTime = computed(() => {
  if (message.value?.thinkingTime) return formatThinkingTime(message.value.thinkingTime)
  if (!message.value?.thinkingFinishTime || !message.value?.streamingStartTime) return ''
  const thinkingDuration = message.value.thinkingFinishTime - message.value.streamingStartTime
  return formatThinkingTime(thinkingDuration)
})
</script>

<style scoped>
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

/* Enable line wrapping in code blocks */
.prose :deep(pre) {
  overflow-x: auto;
  white-space: pre-wrap;
  word-wrap: break-word;
}

.prose :deep(pre code) {
  white-space: pre-wrap;
  word-wrap: break-word;
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
    opacity: 0.6;
  }
  50% {
    opacity: 1;
  }
}
</style>
