<template>
  <div
    class="group/turn pb-4 border-b border-surface-200 dark:border-surface-700 transition-opacity"
    :class="{ 'border-none': isLast, 'opacity-40 hover:opacity-100': compacted }"
  >
    <!-- One header for the whole turn. A run of messages from one side is one
         turn taken in pieces — it reaches the model as a single message — and a
         name and a time repeated over each piece says the writer spoke three
         times. See utils/turns.js. -->
    <div class="flex items-center justify-between min-h-6 mb-2">
      <div class="flex items-center gap-2 text-xs text-surface-500 dark:text-surface-400">
        <span class="font-semibold" :class="authorClass">
          {{ author }}
        </span>
        <span v-if="formattedTime" aria-hidden>•</span>
        <span v-if="formattedTime">{{ formattedTime }}</span>
        <Tag
          v-if="edited"
          value="edited"
          severity="secondary"
          rounded
          class="!text-[10px] !px-2 !py-0"
        />
        <!-- Which model wrote it. A chat changes presets as it goes, and one
             brought in from elsewhere never ran on any of them. -->
        <span v-if="writtenBy" aria-hidden>•</span>
        <span v-if="writtenBy" v-tooltip.top="writtenBy.tooltip" data-test="turn-model">
          {{ writtenBy.name }}
        </span>
        <span v-if="formattedContextSize" aria-hidden>•</span>
        <span v-if="formattedContextSize" v-tooltip.top="usageTooltip" class="tabular-nums">
          {{ formattedContextSize }}
        </span>
        <!-- Where the answer stands among the others the message has had,
             when it has had any: asking again keeps what was said, and this
             is the way back to it. -->
        <template v-if="answers">
          <span aria-hidden>•</span>
          <span class="inline-flex items-center gap-0.5 tabular-nums">
            <Button
              v-tooltip.top="'Previous answer'"
              icon="pi pi-chevron-left"
              text
              rounded
              size="small"
              class="!w-5 !h-5 !p-0"
              :disabled="answers.at === 0"
              @click="$emit('alternate', lastId, answers.at - 1)"
            />
            <span>{{ answers.at + 1 }} / {{ answers.of }}</span>
            <Button
              v-tooltip.top="'Next answer'"
              icon="pi pi-chevron-right"
              text
              rounded
              size="small"
              class="!w-5 !h-5 !p-0"
              :disabled="answers.at === answers.of - 1"
              @click="$emit('alternate', lastId, answers.at + 1)"
            />
          </span>
        </template>
      </div>

      <!-- What is asked of the turn rather than of one message in it. A reply
           answers all of it and a fork takes everything up to the end of it, so
           both reach for its last message.

           A turn that is one message — which is every turn the writer takes —
           is asked the message's questions here as well. Its pieces float their
           own buttons over the corner a message's would go in, and a header
           nothing floats over is where "edit turn" is looked for anyway. -->
      <div
        :class="[
          'flex gap-1 transition-opacity',
          menuOpen
            ? 'opacity-100'
            : isMobile
              ? 'opacity-50'
              : 'opacity-0 group-hover/turn:opacity-100',
        ]"
      >
        <!-- Heard rather than read. The whole turn, in the chat's voice. -->
        <ReadAloudButton
          v-if="spoken"
          :story-id="storyId"
          :speech-key="`turn:${messages[0].id}`"
          :text="spoken"
          :voice-id="voiceId"
        />
        <Button
          v-if="spoken"
          v-tooltip.top="copied ? 'Copied' : 'Copy'"
          :icon="copied ? 'pi pi-check' : 'pi pi-copy'"
          text
          rounded
          size="small"
          @click="copy"
        />
        <Button
          v-if="role === 'user'"
          v-tooltip.top="'Resend turn'"
          icon="pi pi-arrow-right"
          text
          rounded
          size="small"
          @click="$emit('resend', lastId)"
        />
        <template v-if="only">
          <!-- Asking again is only offered where it could answer differently.
               The writer's own words are not going to, but a roll that is the
               whole of their turn is, and its piece shows no buttons here. -->
          <Button
            v-if="role === 'assistant' || lone"
            v-tooltip.top="command || lone ? 'Ask again' : 'Regenerate message'"
            icon="pi pi-refresh"
            text
            rounded
            size="small"
            :disabled="pending"
            @click="$emit('regenerate', only.id, lone ? 0 : null)"
          />
          <Button
            v-tooltip.top="
              role === 'user' ? 'Edit turn' : command ? 'Edit command' : 'Edit message'
            "
            icon="pi pi-pencil"
            text
            rounded
            size="small"
            :disabled="pending"
            @click="body[0]?.startEditing()"
          />
        </template>
        <!-- The rest, asked of a turn less often: how it is shown, where the
             conversation goes from it, and taking it out. -->
        <Button
          v-tooltip.top="'More'"
          icon="pi pi-ellipsis-h"
          text
          rounded
          size="small"
          aria-label="More actions"
          aria-haspopup="true"
          @click="menu?.toggle($event)"
        />
        <Menu
          ref="menu"
          :model="menuItems"
          popup
          @show="menuOpen = true"
          @hide="menuOpen = false"
        />
      </div>
    </div>

    <div class="flex flex-col gap-2">
      <ChatMessage
        v-for="message in messages"
        ref="body"
        :key="message.id"
        :message-id="message.id"
        :story-id="storyId"
        :alone="only !== null"
        :raw="showRaw"
        :activity="activity?.messageId === message.id ? activity : null"
        @regenerate="index => $emit('regenerate', message.id, index)"
        @delete="index => $emit('delete', message.id, index)"
        @revise="(index, text, done) => $emit('revise', message.id, index, text, done)"
        @accept="index => $emit('accept', message.id, index)"
        @reject="index => $emit('reject', message.id, index)"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import Button from 'primevue/button'
import Menu from 'primevue/menu'
import Tag from 'primevue/tag'
import ChatMessage from './ChatMessage.vue'
import ReadAloudButton from '../narration/ReadAloudButton.vue'
import { useScreenSize } from '@/composables/useScreenSize'
import { useToast } from '@/composables/useToast.js'
import { useTurnHolder, useTurnState } from '@/composables/useNearTurns.js'
import { commandRepeatable, commandTag } from '@/ai/commands.js'

const props = defineProps({
  /** @type {import('vue').PropType<import('@/types/models.js').Message[]>} */
  messages: { type: Array, required: true },
  storyId: { type: String, required: true },
  role: { type: String, required: true },
  // The command this turn is the answer of, when it is one rather than
  // something anybody said. See utils/turns.js.
  command: { type: String, default: '' },
  isLast: { type: Boolean, default: false },
  // The voice the chat is read aloud in; the project's default when it names none.
  voiceId: { type: String, default: null },
  // Dimmed rather than hidden: a summary stands in for this turn in the
  // request, but the turn is still the writer's record of their own story.
  compacted: { type: Boolean, default: false },
  // Whether a summary could go in above this turn and stand in for something.
  // See firstSummarizable in ai/compaction.js.
  summarizable: { type: Boolean, default: false },
  // What the turn being generated is doing, when it is writing into one of
  // these messages. See TurnActivity in composables/useAIChat.js.
  /** @type {import('vue').PropType<import('@/composables/useAIChat.js').TurnActivity|null>} */
  activity: { type: Object, default: null },
})

const emit = defineEmits([
  'regenerate',
  'alternate',
  'resend',
  'fork',
  'delete',
  'revise',
  'rewind',
  'accept',
  'reject',
  'summarize',
])

const { isMobile } = useScreenSize()
const toast = useToast()

/**
 * The message, when the turn is one — which is every turn the writer takes and
 * most of the assistant's. The header then asks its questions for it.
 */
const only = computed(() => (props.messages.length === 1 ? props.messages[0] : null))

/**
 * The messages as rendered, for the header's Edit to reach into. Opening the
 * editor is the message's own business, and it exposes exactly that.
 *
 * @type {import('vue').Ref<Array<{startEditing: () => void}>>}
 */
const body = ref([])

/**
 * The turn as it is read aloud: what each message says, in order. The words
 * only — what the model thought on the way, and what its tools did, are for
 * reading.
 */
const spoken = computed(() =>
  props.messages
    .map(message => message?.content?.trim())
    .filter(Boolean)
    .join('\n\n')
)

/** The ⋯ menu, and whether it is open: the header stays up while it is. */
const menu = ref()
const menuOpen = ref(false)

/**
 * What the ⋯ menu offers. Show raw and Delete belong to the one message, so
 * only a turn that is one has them; Rewind has nothing after the last turn to
 * take back, and Summarize is only where a summary would stand for something.
 */
const menuItems = computed(() => [
  ...(only.value
    ? [
        {
          label: showRaw.value ? 'Show rendered' : 'Show raw',
          icon: 'pi pi-code',
          command: () => (showRaw.value = !showRaw.value),
        },
      ]
    : []),
  {
    label: 'Fork from here',
    icon: 'pi pi-share-alt',
    command: () => emit('fork', lastId.value),
  },
  ...(props.summarizable
    ? [
        {
          label: 'Summarize up to here',
          icon: 'pi pi-angle-double-up',
          command: () => emit('summarize', props.messages[0].id),
        },
      ]
    : []),
  ...(props.isLast
    ? []
    : [
        {
          label: 'Rewind to here',
          icon: 'pi pi-history',
          command: () => emit('rewind', lastId.value),
        },
      ]),
  ...(only.value
    ? [
        { separator: true },
        {
          label: props.role === 'user' ? 'Delete turn' : 'Delete message',
          icon: 'pi pi-trash',
          command: () => emit('delete', only.value.id, null),
        },
      ]
    : []),
])

/** Whether the turn has just been copied, for the button to say so. */
const copied = ref(false)

/**
 * Put the turn on the clipboard: the words, as they are read aloud. Quietly,
 * past the button's tick: only a copy that could not be made is worth a word.
 */
const copy = async () => {
  try {
    await navigator.clipboard.writeText(spoken.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch (error) {
    console.error('Failed to copy message:', error)
    toast.error('Could not copy the message. The browser did not allow it here.')
  }
}

/**
 * The writer's command, when it is the whole of their turn and could answer
 * differently if asked again. Its piece is alone in the turn, so it floats no
 * buttons of its own and the header has to offer the retry for it.
 */
const lone = computed(() => {
  const segments = only.value?.segments
  if (props.role !== 'user' || segments?.length !== 1) return null
  const [segment] = segments
  return segment.type === 'command' && commandRepeatable(segment.command) ? segment.command : null
})

/** Whether the one message is still being answered, which nothing may change under. */
const pending = computed(
  () => only.value?.metadata?.command?.pending === true || lone.value?.pending === true
)

/**
 * Whether the one message is shown as the model is sent it. Kept by the chat,
 * so that it is still how the writer left it when the turn comes back.
 */
const showRaw = useTurnState(`${props.messages[0].id}:turn-raw`, false)

// An editor open in the turn keeps it in the page while the writer scrolls.
useTurnHolder(() => props.messages[0].id)

/**
 * Where the turn's last message stands among its answers, when there is
 * anywhere else to stand: which it is showing, and how many it has.
 *
 * Only on the last turn. Everything after a message was written to the
 * answer it was showing, so an earlier one cannot turn without taking the
 * rest with it, and offers nothing. Nor while an answer is still being
 * written, which `isLast` already covers.
 *
 * @type {import('vue').ComputedRef<{at: number, of: number}|null>}
 */
const answers = computed(() => {
  if (!props.isLast) return null
  const last = props.messages[props.messages.length - 1]
  const of = last?.alternates?.length || 0
  if (last?.role !== 'assistant' || of < 2) return null
  return { at: last.alternate ?? 0, of }
})

/**
 * Whose turn this is, by the name that says the most about it.
 *
 * A command that takes a turn of its own is in the assistant's slot but is not
 * the assistant: `/compact` was asked for a summary and produced one. Naming
 * the turn for what answered says why it is not narration without a word of
 * explanation.
 */
const author = computed(() => {
  if (props.command) {
    // The record, not the name: what a command's answer is called is the
    // command's to say, and `/compact` produces a summary.
    const asked = props.messages[0]?.metadata?.command
    const named = asked ? commandTag(asked) : props.command
    return named.charAt(0).toUpperCase() + named.slice(1)
  }
  return props.role === 'user' ? 'You' : 'Assistant'
})

/** Named in the colour its own block is drawn in, so the two read as one thing. */
const authorClass = computed(() => {
  if (props.command) return 'text-rose-700 dark:text-rose-300'
  return props.role === 'user' ? 'text-primary-600 dark:text-primary-400' : ''
})

/**
 * Whether the writer has been back to change any of this.
 *
 * A command's own turn is left out of it: its answer is written into its
 * content, so every one that ever answered would count as edited and the tag
 * would say nothing. The writer's commands are pieces of the writer's turn, and
 * an answer arriving in one of those is written without counting as an edit,
 * so on that turn the tag means what it says.
 */
const edited = computed(() =>
  props.messages.some(message => message?.edited && !message?.metadata?.command)
)

/** What everything asked of the turn as a whole is asked of. */
const lastId = computed(() => props.messages[props.messages.length - 1]?.id)

/** When the turn started, which is when the first thing in it was written. */
const formattedTime = computed(() => {
  const t = props.messages[0]?.created
  if (!t) return ''

  const d = typeof t === 'string' ? new Date(t) : typeof t === 'number' ? new Date(t) : t
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d)
  } catch {
    return ''
  }
})

/**
 * What the turn cost, from the last message in it that reported anything.
 *
 * Only a generated message carries usage. A turn pushed in by hand has none,
 * and one that was generated and then had a paragraph pushed after it still
 * only ever reported it once, so the last figure there is is the turn's.
 *
 * @type {import('vue').ComputedRef<import('@/types/models.js').TurnUsage|null>}
 */
const usage = computed(() => {
  for (let i = props.messages.length - 1; i >= 0; i--) {
    const reported = props.messages[i]?.metadata?.usage
    if (reported) return reported
  }
  return null
})

/**
 * Which model wrote the turn, from the last message in it that says.
 *
 * The name is the model's without whoever published it — `glm-5.3` rather than
 * `z-ai/glm-5.3` — since the header is one line and the rest is in the tooltip,
 * with where it ran.
 *
 * @type {import('vue').ComputedRef<{name: string, tooltip: string}|null>}
 */
const writtenBy = computed(() => {
  for (let i = props.messages.length - 1; i >= 0; i--) {
    const { model, provider } = props.messages[i]?.metadata || {}
    if (model) {
      return {
        name: model.slice(model.lastIndexOf('/') + 1) || model,
        tooltip: provider ? `${model} · ${provider}` : model,
      }
    }
  }
  return null
})

/**
 * Prompt tokens for this turn — how large the conversation had grown by the
 * time it was sent. Absent when the provider reports no usage.
 */
const formattedContextSize = computed(() => {
  const prompt = usage.value?.promptTokens
  if (!prompt) return ''
  return prompt >= 1000 ? `${(prompt / 1000).toFixed(1)}k ctx` : `${prompt} ctx`
})

const usageTooltip = computed(() => {
  if (!usage.value) return ''
  const { promptTokens, completionTokens, requests } = usage.value
  const parts = [
    `${promptTokens.toLocaleString()} prompt tokens`,
    `${completionTokens.toLocaleString()} generated`,
  ]
  // Only worth mentioning when tools made the turn span several requests.
  if (requests > 1) parts.push(`${requests} requests`)
  return parts.join(' · ')
})
</script>
