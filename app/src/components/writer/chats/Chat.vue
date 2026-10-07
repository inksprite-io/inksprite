<template>
  <!-- One root, so that a class the chat is given has somewhere to go: Vue
       hands a component's attributes to its root, and two siblings are not
       one. -->
  <div ref="root" class="w-full h-full">
    <!-- Settings takes over the chat's container, so this works the same
       wherever the chat is rendered. The chat is only hidden behind it, so
       that it comes back as it was left: its turns at the sizes they had and
       the writer where they were in it. -->
    <ChatSettings
      v-if="showSettings"
      :story-id="props.storyId"
      :chat-id="props.chatId"
      @back="closeSettings"
    />
    <div
      v-show="!showSettings"
      class="w-full h-full flex flex-col bg-surface-0 dark:bg-surface-800"
    >
      <!-- Header, the height of the editor's tab strip, since the two sit
         side by side. -->
      <div
        class="w-full h-9 flex-none flex items-center gap-1 px-1 bg-surface-100 dark:bg-surface-800 border-b border-surface-200 dark:border-surface-700"
      >
        <!-- Back to the list, where the list is behind this panel; otherwise
           whatever the panel puts here, which beside the editor is the
           toggle for it. -->
        <Button
          v-if="showBack"
          type="button"
          icon="pi pi-chevron-left"
          severity="secondary"
          size="small"
          rounded
          class="flex-none !w-7 !h-7 !p-0 !bg-transparent !border-transparent hover:!bg-surface-700"
          aria-label="Back"
          @click="handleBack"
        />
        <slot v-else name="header-start"><div class="w-7" /></slot>
        <!-- Chat title, and the profile the chat runs on beside it -->
        <h2 class="text-sm font-semibold truncate flex-1 min-w-0 px-1">
          {{ chatTitle }}
        </h2>
        <ChatProfileMenu :story-id="props.storyId" :chat-id="props.chatId" />
        <!-- Finding in the chat, which the browser's find cannot do for the
           turns not in the page. Here for a phone, which has no key for it. -->
        <Button
          v-if="!unstarted"
          v-tooltip.bottom="'Find in chat'"
          type="button"
          icon="pi pi-search"
          severity="secondary"
          size="small"
          rounded
          class="flex-none !w-7 !h-7 !p-0 !bg-transparent !border-transparent hover:!bg-surface-700"
          aria-label="Find in chat"
          data-action="find"
          @click="openFind"
        />
        <!-- A fresh conversation, without going back to the list for one. A
           chat not started yet is already one. -->
        <Button
          v-if="!unstarted"
          v-tooltip.bottom="'New chat'"
          type="button"
          icon="pi pi-plus"
          severity="secondary"
          size="small"
          rounded
          class="flex-none !w-7 !h-7 !p-0 !bg-transparent !border-transparent hover:!bg-surface-700"
          aria-label="New chat"
          @click="emit('new-chat')"
        />
      </div>
      <!-- Finding in the chat. See useChatFind. -->
      <FindBar
        v-if="finding"
        ref="findBar"
        :query="findQuery"
        :count="findCount"
        :current="findCurrent"
        @update:query="chatFind.lookFor"
        @next="chatFind.step(1)"
        @previous="chatFind.step(-1)"
        @close="chatFind.closeFind"
      />
      <!-- Messages. The scroll is listened for here, on its way down to the
         element PrimeVue makes for it: a scroll does not bubble. -->
      <div class="relative flex-1 min-h-0 flex flex-col" @scroll.capture.passive="onPanelScroll">
        <!-- Never sideways: on a phone a chat that can move sideways drifts
             under a finger scrolling it up or down. Anything wider than the
             column scrolls in a box of its own. -->
        <ScrollPanel
          ref="scrollPanel"
          class="flex-1 overflow-auto"
          :pt="{ content: { class: '!overflow-x-hidden' } }"
        >
          <div class="mx-auto w-full max-w-3xl pb-[10rem] flex flex-col gap-1 p-2 px-4">
            <!-- Display actual messages, folded into the turns they are -->
            <template v-for="(turn, index) in turns" :key="turn.id">
              <!-- Where the summary takes over. Everything above it is still the
               writer's to read; it is the model that has stopped reading it. -->
              <div
                v-if="compacted.has(index)"
                class="flex items-center gap-3 py-2 select-none text-xs text-surface-400"
              >
                <span class="flex-1 h-px bg-surface-200 dark:bg-surface-700" />
                <span>
                  {{ compacted.get(index) }} turn{{ compacted.get(index) === 1 ? '' : 's' }}
                  compacted
                </span>
                <span class="flex-1 h-px bg-surface-200 dark:bg-surface-700" />
              </div>
              <!-- A turn is in the page only while it is near the screen.
                 Further off it is an empty block at the height it last had,
                 or a guess at one. Mounting every turn of a long chat is
                 what took a few hundred megabytes, and laying them all out
                 on every change of the panel's width is what made dragging
                 its edge stutter. See useNearTurns. -->
              <div
                :ref="el => nearTurns.track(turn.id, /** @type {Element|null} */ (el))"
                :data-turn="turn.id"
                :style="
                  nearTurns.isMounted(turn.id)
                    ? undefined
                    : { height: `${nearTurns.heightOf(turn.id)}px` }
                "
              >
                <ChatTurn
                  v-if="nearTurns.isMounted(turn.id)"
                  :messages="turn.messages"
                  :story-id="props.storyId"
                  :role="turn.role"
                  :command="turn.command || ''"
                  :is-last="index === turns.length - 1 && !isGenerating"
                  :activity="chatGeneration.activity.value"
                  :compacted="turn.compacted"
                  :summarizable="!isGenerating && summarizable.has(turn.id)"
                  :voice-id="chat?.voiceId ?? null"
                  @regenerate="handleRegenerateMessage"
                  @alternate="handleSelectAlternate"
                  @resend="handleResendMessage"
                  @fork="handleForkMessage"
                  @delete="handleDeleteMessage"
                  @revise="handleRevise"
                  @rewind="handleRewind"
                  @summarize="handleSummarize"
                  @accept="handleAcceptEdit"
                  @reject="handleRejectEdit"
                />
              </div>
            </template>
            <!-- Room under a summary that is being written, so that its first line
             can be at the top of the panel with little or nothing below it. -->
            <div v-if="spacer > 0" :style="{ height: `${spacer}px` }" aria-hidden="true" />
          </div>
        </ScrollPanel>
        <!-- The way back to the end of a long chat, offered to somebody who is
           far from it and heading that way. See useJumpToBottom. -->
        <Transition
          enter-active-class="transition-opacity duration-150"
          leave-active-class="transition-opacity duration-150"
          enter-from-class="opacity-0"
          leave-to-class="opacity-0"
        >
          <Button
            v-if="jumpVisible"
            v-tooltip.top="'Scroll to bottom'"
            icon="pi pi-arrow-down"
            severity="secondary"
            rounded
            raised
            aria-label="Scroll to bottom"
            class="!absolute bottom-3 left-1/2 -translate-x-1/2 z-10"
            @click="jumpToBottom"
          />
        </Transition>
      </div>
      <!-- Nobody to answer. Said here, above the box, before a message is sent
         to nobody: the message stays in the box, and the way to a provider is
         a click away. Adding a turn without a reply still works. -->
      <div v-if="setupProblem" class="mx-auto w-full max-w-3xl px-2 pb-1">
        <div
          role="status"
          class="flex flex-wrap items-center gap-2 rounded-2xl px-3 py-2 text-sm bg-amber-500/10 text-surface-700 dark:text-surface-200"
        >
          <i
            class="pi pi-exclamation-circle text-amber-600 dark:text-amber-400"
            aria-hidden="true"
          />
          <span class="flex-1 min-w-0">{{ setupMessage }}</span>
          <Button
            :label="setupAction"
            size="small"
            severity="secondary"
            outlined
            data-action="setup-provider"
            @click="explainSetup"
          />
        </div>
      </div>
      <!-- Input Area -->
      <div class="relative mx-auto w-full max-w-3xl px-2 pb-2">
        <!-- The commands a slash at the start of a line could be starting. -->
        <ChatCommandMenu
          v-if="menuOpen"
          :id="menuId"
          :entries="menuEntries"
          :active="menuActive"
          class="absolute bottom-full inset-x-2 mb-1 z-20"
          @pick="pickCommand"
          @hover="menuActive = $event"
        />
        <!-- The buttons sit beside the draft while it fits on one line there,
           and drop under it once it does not, so a paragraph gets the whole
           width rather than the column a row of buttons leaves. The field
           takes the row to push them off it. See useMessageField.

           Keys reach the command menu first, on the way down, so that while
           it is open Enter finishes a name instead of sending the draft. -->
        <div
          ref="inputRow"
          class="w-full p-1 px-2 gap-1 flex flex-wrap items-end justify-end !rounded-4xl bg-surface-100 dark:bg-surface-900"
          @keydown.capture="onMenuKeydown"
        >
          <!-- Provider setup dialog -->
          <InitialProviderSetup
            v-model:visible="providerSetupDialogVisible"
            @dont-show-again="handleDontShowAgain"
          />

          <Textarea
            ref="messageField"
            v-model="userInput"
            placeholder="Let's brainstorm..."
            class="grow min-w-0 !bg-transparent !border-0 resize-none max-h-[20rem] !overflow-y-auto"
            :class="beside ? 'basis-0' : 'basis-full'"
            :disabled="isGenerating"
            rows="1"
            aria-autocomplete="list"
            :aria-controls="menuOpen ? menuId : undefined"
            :aria-activedescendant="menuOpen ? activeCommandId : undefined"
            @keydown.enter.exact.prevent="handleSendMessage"
            @keydown.enter.meta.exact.prevent="handleInsertMessage('user')"
            @keydown.enter.ctrl.exact.prevent="handleInsertMessage('user')"
            @keydown.enter.alt.exact.prevent="handleInsertMessage('assistant')"
          />
          <Button
            v-tooltip.top="'Chat settings'"
            type="button"
            icon="pi pi-cog"
            severity="secondary"
            size="small"
            rounded
            class="!bg-transparent !border-transparent hover:!bg-surface-700 mb-[0.25rem] !p-2"
            aria-label="Chat settings"
            @click="openSettings"
          />
          <!-- Send, with the two quieter destinations behind the caret. Enter is
             the whole story for most turns; pushing one in without a reply is
             not, so it waits in here with its shortcut written beside it. -->
          <div v-if="!isGenerating" class="flex-none flex items-end mb-[0.25rem]">
            <Button
              v-tooltip.top="'Send'"
              type="button"
              severity="secondary"
              size="small"
              rounded
              :disabled="!hasInput"
              class="!bg-transparent !border-transparent hover:!bg-surface-700 !p-2"
              aria-label="Send message"
              @click="handleSendMessage"
            >
              <template #icon>
                <SendIcon :size="18" class="text-surface-contrast" />
              </template>
            </Button>
            <Button
              v-tooltip.top="'Add without replying'"
              type="button"
              icon="pi pi-chevron-down"
              severity="secondary"
              size="small"
              rounded
              :disabled="!hasInput"
              aria-haspopup="true"
              aria-controls="chat_send_menu"
              class="!bg-transparent !border-transparent hover:!bg-surface-700 !p-1 !text-xs"
              aria-label="More ways to add this"
              @click="toggleSendMenu"
            />
            <Menu id="chat_send_menu" ref="sendMenu" :model="sendOptions" :popup="true">
              <template #item="{ item, props: itemProps }">
                <a
                  class="flex items-center gap-3 px-3 py-2 cursor-pointer"
                  v-bind="itemProps.action"
                >
                  <span :class="item.icon" />
                  <span class="flex-1">{{ item.label }}</span>
                  <span class="text-xs text-surface-400">{{ item.shortcut }}</span>
                </a>
              </template>
            </Menu>
          </div>
          <Button
            v-if="isGenerating"
            v-tooltip.top="'Stop generating (Esc)'"
            type="button"
            severity="secondary"
            size="small"
            rounded
            class="!bg-transparent !border-transparent hover:!bg-surface-700 mb-[0.25rem] !p-2"
            aria-label="Stop generating"
            @click="handleStopGenerating"
          >
            <template #icon>
              <StopIcon class="text-surface-contrast" />
            </template>
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, nextTick, computed, watch } from 'vue'
import { Textarea } from 'primevue'
import { Button } from 'primevue'
import ScrollPanel from 'primevue/scrollpanel'
import Menu from 'primevue/menu'
import StopIcon from '@/components/icons/StopIcon.vue'
import SendIcon from '@/components/icons/SendIcon.vue'
import ChatTurn from './ChatTurn.vue'
import ChatSettings from './ChatSettings.vue'
import ChatCommandMenu from './ChatCommandMenu.vue'
import ChatProfileMenu from './ChatProfileMenu.vue'
import FindBar from '@/components/common/FindBar.vue'
import InitialProviderSetup from '@/components/common/InitialProviderSetup.vue'
import { useChats } from '@/composables/useChats'
import { useJumpToBottom } from '@/composables/useJumpToBottom'
import { useNearTurns } from '@/composables/useNearTurns.js'
import { useChatFind } from '@/composables/useChatFind.js'
import { useFindKey } from '@/composables/useFindKey.js'
import { useToast } from '@/composables/useToast'
import { useConfirm } from 'primevue/useconfirm'
import { useAIChat } from '@/composables/useAIChat'
import { useProviderSetup } from '@/composables/useProviderSetup.js'
import { useSettingsPanel } from '@/composables/useSettingsPanel.js'
import { useMessageField } from '@/composables/useMessageField.js'
import { useCommandMenu, commandOptionId } from '@/composables/useCommandMenu.js'
import {
  COMPACT_COMMAND,
  compactionCover,
  firstSummarizable,
  isCompacting,
} from '@/ai/compaction.js'
import { compactedRuns, groupTurns } from '@/utils/turns.js'

const props = defineProps({
  storyId: { type: String, required: true },
  /** The chat, or the story's unstarted one, which starts on its first submission. */
  chatId: { type: String, required: true },
  title: { type: String, required: true },
  /** Whether the chats list is behind this panel, so a back button leads to it. */
  showBack: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['back', 'open-chat', 'new-chat'])

// Composables
const chatsApi = useChats(props.storyId)
const toast = useToast()
const confirm = useConfirm()
const chatGeneration = useAIChat(props.storyId, props.chatId)
const { providerSetupDialogVisible, handleDontShowAgain, isProviderSetupDialogEnabled } =
  useProviderSetup()
const settings = useSettingsPanel()

// Refs
const scrollPanel = ref(null)
const messageField = ref(null)
const inputRow = ref(null)

// Swaps this component between the conversation and its settings pane.
const showSettings = ref(false)

// User input with draft message persistence
const userInput = computed({
  get: () => chatsApi.getDraftMessage(props.chatId),
  set: value => chatsApi.setDraftMessage(props.chatId, value),
})

/** The textarea itself, inside PrimeVue's component. */
const fieldElement = computed(() => messageField.value?.$el ?? null)

// The field fits its draft, and its buttons stay beside it only while the
// draft fits beside them. See useMessageField.
const { beside } = useMessageField(fieldElement, inputRow, userInput)

// A slash at the start of a line opens the commands it could be starting.
// See useCommandMenu.
const {
  open: menuOpen,
  entries: menuEntries,
  active: menuActive,
  pick: pickCommand,
  onKeydown: onMenuKeydown,
} = useCommandMenu(fieldElement, userInput)
const menuId = computed(() => `chat-commands-${props.chatId}`)
const activeCommandId = computed(() => {
  const entry = menuEntries.value[menuActive.value]
  return entry ? commandOptionId(menuId.value, entry.name) : undefined
})

// Computed
const chat = computed(() => chatsApi.getChatById(props.chatId))
// Not a chat yet: the one "New chat" opens, until something is sent in it.
const unstarted = computed(() => chatsApi.isUnstarted(props.chatId))
const chatTitle = computed(() => chat.value?.title || props.title || 'Chat')
const messages = chatsApi.getMessagesForChat(props.chatId)

// Use chat generation state
const isGenerating = computed(() => chatGeneration.isGenerating.value)

// What the writer reads: the run of messages each side wrote in one go, shown
// as the one turn the model is sent, and dimmed where a summary now stands in
// for it. See utils/turns.js and ai/compaction.js.
const turns = computed(() => groupTurns(messages.value, compactionCover(messages.value)))

// Where the line goes: under the run the newest summary stands in for, which
// is above the summary itself. Never inside a turn — groupTurns will not let
// one span either end of a run.
const compacted = computed(() => compactedRuns(turns.value))

// The turns a summary could go in above. See firstSummarizable.
const summarizable = computed(() => {
  const from = firstSummarizable(messages.value)
  /** @type {Set<string>} */
  const turnIds = new Set()
  let at = 0
  for (const turn of turns.value) {
    if (at >= from) turnIds.add(turn.id)
    at += turn.messages.length
  }
  return turnIds
})

// The summary being written right now, if one is: asked for, or asked for
// again.
const summarising = computed(() => {
  if (!isGenerating.value) return null
  return messages.value.find(isCompacting)?.id || null
})

// The chat moves the writer for two things, and the text of a reply is
// neither of them.
//
// What they submit lands at the end of the chat, and they are shown it there:
// what they said, and the opening of the reply under it. From the end of a
// chat, where a message is usually sent from, that is a nudge of a few lines.
// Then the reply is theirs to read. The chat does not take them to the top of
// it, follow it down, or jump to the end of it when it stops: they are reading
// at their own speed, and the one thing known about where they have got to is
// that it is not where the model has.
//
// A summary is different because it is written somewhere else: above the turns
// it kept, which in a roleplay is screens away from the box it was asked for
// in. So the chat goes to the top of one when it starts, and then leaves them
// alone in the same way. With little or nothing under a summary its first line
// cannot be scrolled to the top of anything, so room is put under the chat for
// as long as it is being written, and afterwards only as much of that room is
// kept as the view is still resting on: taking the rest away would move what
// the writer is looking at.
const spacer = ref(0)
let restingAt = 0

// A submission on its way into the chat, and whether the writer has been shown
// where it landed or taken to the summary it asked for.
let submitting = false
let shown = false

/** The element that scrolls, inside PrimeVue's panel. */
const scroller = () => scrollPanel.value?.$el.querySelector('.p-scrollpanel-content') || null

// Finding in the chat, whose turns are mostly not in the page.
const chatFind = useChatFind(turns, scroller)
const { open: finding, query: findQuery, count: findCount, current: findCurrent } = chatFind
/** @type {import('vue').Ref<{ focus: () => void }|null>} */
const findBar = ref(null)

/** Open the find, or go back to it, with the caret in what to look for. */
const openFind = () => {
  chatFind.openFind()
  nextTick(() => findBar.value?.focus())
  return true
}

// Which turns are in the page: those near the screen, the newest two, the
// summary being written, which the chat is about to take the writer to, and
// the turn the find is on.
const nearTurns = useNearTurns(scroller, turns, () => [summarising.value, chatFind.holding.value])

// The way back down, for somebody a long way up and heading that way. The
// room kept under a summary is not content, so it is not part of how far away
// the end is. Whenever the chat moves the panel itself it says so first, or its
// own scrolling would read as the writer's.
const {
  visible: jumpVisible,
  far: farFromEnd,
  onScroll: onPanelScroll,
  hush: hushJump,
  jump: jumpToBottom,
} = useJumpToBottom(scroller, spacer)

watch(summarising, async (id, was) => {
  const panel = scroller()
  if (!panel) return

  if (!id) {
    if (!was) return
    const natural = panel.scrollHeight - spacer.value
    const resting = Math.max(panel.scrollTop, restingAt) + panel.clientHeight
    spacer.value = Math.max(0, Math.ceil(resting - natural))
    return
  }

  shown = true
  spacer.value = panel.clientHeight
  await nextTick()

  const target = panel.querySelector(`[data-turn="${id}"]`)
  if (!target) return

  const top = target.getBoundingClientRect().top - panel.getBoundingClientRect().top
  restingAt = Math.max(0, panel.scrollTop + top - 8)
  hushJump()
  panel.scrollTo?.({ top: restingAt, behavior: 'smooth' })
})

// A message landing at the end of the chat while a submission is going in.
// This runs before the message is drawn, so how far away the end is is how far
// away it was. The first thing to land is shown wherever the writer had got to,
// since they put it there. Anything after it is shown to somebody still at the
// end and not to somebody who has left it: a /write in their own turn gives
// them a passage to read before the reply opens under it.
watch(
  () => messages.value.length,
  async (count, was) => {
    if (!submitting || count <= was || summarising.value) return
    if (shown && farFromEnd()) return
    await showEnd()
  }
)

/** Go to the end of the chat, where there is no more use for room under it. */
const showEnd = async () => {
  shown = true
  spacer.value = 0
  await scrollToBottom()
}

/**
 * See a submission into the chat. One that lands no message, because it was
 * written into the turn the writer was already taking, is shown once it is in.
 *
 * @param {() => Promise<unknown>} submit
 */
const seeIn = async submit => {
  submitting = true
  shown = false
  try {
    await submit()
    if (!shown) await showEnd()
  } finally {
    submitting = false
  }
}

// Nothing to send is nothing to add either, so the whole group goes quiet
// together rather than offering three ways to submit an empty box.
const hasInput = computed(() => Boolean(userInput.value?.trim()))

// Why a message could not be answered right now: no provider, no key, no
// model picked. Shown above the box, and checked before a send.
const setupProblem = computed(() => chatGeneration.configurationError.value)
const providerMissing = computed(() => setupProblem.value?.name === 'ProviderNotConfiguredError')
const setupMessage = computed(() =>
  providerMissing.value
    ? 'No AI provider is connected, so nothing can reply yet.'
    : setupProblem.value?.message || ''
)
const setupAction = computed(() => (providerMissing.value ? 'Connect' : 'AI settings'))

/**
 * Take the writer to where the problem is fixed: the connect dialog for a
 * missing provider, unless they have asked not to see it, and the AI
 * settings for everything else.
 */
const explainSetup = () => {
  if (providerMissing.value && isProviderSetupDialogEnabled()) {
    providerSetupDialogVisible.value = true
  } else {
    settings.open('ai')
  }
}

// The modifier is named for the keyboard actually in front of the writer;
// telling a Linux user about ⌘ is worse than saying nothing.
const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iP(hone|ad|od)/.test(navigator.platform || navigator.userAgent || '')

const sendMenu = ref(null)

const sendOptions = computed(() => [
  {
    label: 'Add as user',
    icon: 'pi pi-user',
    shortcut: isMac ? '⌘↵' : 'Ctrl+↵',
    command: () => handleInsertMessage('user'),
  },
  {
    label: 'Add as assistant',
    icon: 'pi pi-sparkles',
    shortcut: isMac ? '⌥↵' : 'Alt+↵',
    command: () => handleInsertMessage('assistant'),
  },
])

const toggleSendMenu = event => {
  sendMenu.value?.toggle(event)
}

/**
 * Handle back button click
 */
const handleBack = () => {
  emit('back')
}

/**
 * Handle sending a message
 */
const handleSendMessage = async () => {
  const messageContent = userInput.value.trim()
  if (!messageContent) {
    return
  }

  // Nobody to answer: the message stays in the box rather than going into the
  // history unanswered, and the writer is shown where to fix that.
  if (setupProblem.value) {
    explainSetup()
    return
  }

  try {
    startIfUnstarted()
    // Clear draft immediately
    chatsApi.clearDraftMessage(props.chatId)

    console.log('Sending message:', messageContent)

    // Send message and get AI response
    await seeIn(() => chatGeneration.sendMessage(messageContent))
  } catch (error) {
    console.error('Failed to send message:', error)
    // A command that could not run wrote nothing, so the writer gets their
    // text back to fix rather than having to retype it. Anything failing later
    // than that has already recorded the message.
    if (error.name === 'CommandError') {
      userInput.value = messageContent
      toast.error(error.message)
      return
    }
    // Check if this is a provider not configured error
    if (error.name === 'ProviderNotConfiguredError') {
      if (isProviderSetupDialogEnabled()) {
        providerSetupDialogVisible.value = true
      } else {
        toast.error('Set up a provider in the settings menu to use chat.')
      }
    } else {
      toast.error(error.message || 'Failed to send message')
    }
  }
}

/**
 * Put what is in the box into the history without asking for a reply.
 *
 * The failure handling is `handleSendMessage`'s, minus the parts that can only
 * happen to a request: nothing here reaches a provider unless the writer typed
 * a command that consults, so a provider that is not set up is not this
 * button's problem to explain.
 *
 * @param {'user'|'assistant'} role - Whose turn to write it as
 */
const handleInsertMessage = async role => {
  const messageContent = userInput.value.trim()
  if (!messageContent) {
    return
  }

  try {
    startIfUnstarted()
    chatsApi.clearDraftMessage(props.chatId)
    await seeIn(() => chatGeneration.insertMessage(messageContent, role))
  } catch (error) {
    console.error('Failed to add message:', error)
    // Same bargain as sending: a command that could not run wrote nothing, so
    // the text goes back in the box rather than being retyped.
    if (error.name === 'CommandError') {
      userInput.value = messageContent
    }
    toast.error(error.message || 'Failed to add message')
  }
}

/**
 * Make the chat real, if it is the unstarted one, before the first thing goes
 * into it. It keeps its id, so everything here carries on as it was.
 */
const startIfUnstarted = () => {
  if (unstarted.value) chatsApi.startChat()
}

/**
 * Stop the answer being written. One stopped before it said anything goes,
 * and a retry goes back to the answer before it, whose changes are made
 * again where the writer has not been since.
 */
const handleStopGenerating = async () => {
  try {
    const { skipped } = await chatGeneration.stopGeneration()
    if (skipped.length > 0) {
      const kept = [...new Set(skipped.map(edit => edit.path))].join(', ')
      toast.info(`Left as you edited them: ${kept}`)
    }
  } catch (error) {
    console.error('Failed to stop:', error)
    toast.error(error.message || 'Failed to stop')
  }
}

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)

useFindKey(() => root.value, openFind)

/**
 * Escape stops the answer being written, from anywhere in the chat, or from
 * nowhere: the field is disabled while it is written, and the focus falls to
 * the page. Not from the editor beside it, and not when something on top — a
 * dialog, a message being edited — has had the key.
 *
 * @param {KeyboardEvent} event
 */
const stopOnEscape = event => {
  if (event.key !== 'Escape' || event.defaultPrevented) return
  if (document.querySelector('.p-dialog-mask')) return
  const target = /** @type {Node|null} */ (event.target)
  if (target !== document.body && !root.value?.contains(target)) return
  event.preventDefault()
  handleStopGenerating()
}

const unbindEscape = () => document.removeEventListener('keydown', stopOnEscape)
watch(isGenerating, generating =>
  generating ? document.addEventListener('keydown', stopOnEscape) : unbindEscape()
)
onBeforeUnmount(unbindEscape)

/**
 * Handle regenerating a message
 * @param {string} messageId
 * @param {number|null} [index] - Which piece of the turn, when it has pieces
 */
const handleRegenerateMessage = async (messageId, index = null) => {
  // On a command, regenerating means rolling again — the same question, and
  // whatever the dice say this time. A piece of a turn is always one.
  const message = chatsApi.getMessageById(messageId)?.value
  if (index !== null || message?.metadata?.command) {
    try {
      await chatGeneration.rerunCommand(messageId, index)
    } catch (error) {
      toast.error(error.message)
    }
    return
  }

  try {
    // Regenerate the message
    await chatGeneration.regenerateMessage(messageId)
  } catch (error) {
    console.error('Failed to regenerate message:', error)
    // Check if this is a provider not configured error
    if (error.name === 'ProviderNotConfiguredError') {
      if (isProviderSetupDialogEnabled()) {
        providerSetupDialogVisible.value = true
      } else {
        toast.error('Set up a provider in the settings menu to use chat.')
      }
    } else {
      toast.error(error.message || 'Failed to regenerate message')
    }
  }
}

/**
 * Turn the last message to another of its answers. What the two answers did
 * to the project follows, and what could not be put back is said, the way a
 * rewind says it.
 *
 * @param {string} messageId
 * @param {number} index - Which answer
 */
const handleSelectAlternate = async (messageId, index) => {
  try {
    const { skipped } = await chatGeneration.selectAlternate(messageId, index)
    if (skipped.length > 0) {
      const kept = [...new Set(skipped.map(edit => edit.path))].join(', ')
      toast.info(`Left as you edited them: ${kept}`)
    }
  } catch (error) {
    console.error('Failed to show another answer:', error)
    toast.error(error.message || 'Failed to show another answer')
  }
}

/**
 * Rewrite a turn, or one piece of it, from the text the writer edited.
 *
 * The composable takes the text apart the way a submission is taken apart:
 * anything unchanged keeps the record it had, anything new is run, and an
 * answer the writer wrote is taken at their word. The callback says whether it
 * worked, because a refused edit keeps the editor open rather than losing what
 * was typed.
 *
 * @param {string} messageId
 * @param {number|null} at - Which piece, or null for the whole turn
 * @param {string} text - The turn as the writer has now written it
 * @param {(error?: Error) => void} done - Told how it went, for the editor
 */
const handleRevise = async (messageId, at, text, done) => {
  try {
    await chatGeneration.editCommand(messageId, at, text)
    done()
  } catch (error) {
    console.error('Failed to edit:', error)
    toast.error(error.message || 'Failed to edit')
    done(error)
  }
}

/**
 * Rewind the conversation to a message, after saying what that undoes.
 *
 * The turns after it go, and what their tools did to the project is undone
 * where the writer has not been since — a passage they have edited stands,
 * and they are told which.
 *
 * @param {string} messageId
 */
const handleRewind = messageId => {
  const plan = chatGeneration.rewindPlan(messageId)
  const count = plan.messages.length
  const turns = `${count} message${count === 1 ? '' : 's'}`
  const paths = plan.documents.map(document => document.path)
  const message =
    paths.length === 0
      ? `Removes the ${turns} after this one.`
      : `Removes the ${turns} after this one and puts ${paths.length === 1 ? 'this document' : 'these documents'} back as ${paths.length === 1 ? 'it was' : 'they were'}: ${paths.join(', ')}. A passage you have edited since is left as you have it.`

  confirm.require({
    header: 'Rewind the conversation?',
    message,
    icon: 'pi pi-history',
    rejectProps: { label: 'Cancel', severity: 'secondary', outlined: true },
    acceptProps: { label: 'Rewind', severity: 'danger' },
    accept: () => {
      try {
        const { skipped } = chatGeneration.rewindTo(messageId)
        if (skipped.length > 0) {
          const kept = [...new Set(skipped.map(edit => edit.path))].join(', ')
          toast.info(`Left as you edited them: ${kept}`)
        }
      } catch (error) {
        console.error('Failed to rewind:', error)
        toast.error(error.message || 'Failed to rewind')
      }
    },
  })
}

/**
 * Make a change the assistant proposed. A document that has changed since
 * refuses it, and the writer is told rather than having their version
 * written over.
 *
 * @param {string} messageId
 * @param {number} index - Which of the turn's proposals
 */
const handleAcceptEdit = async (messageId, index) => {
  try {
    await chatGeneration.acceptEdit(messageId, index)
  } catch (error) {
    console.error('Failed to accept edit:', error)
    toast.error(error.message || 'Failed to accept edit')
  }
}

/**
 * @param {string} messageId
 * @param {number} index
 */
const handleRejectEdit = (messageId, index) => {
  try {
    chatGeneration.rejectEdit(messageId, index)
  } catch (error) {
    console.error('Failed to reject edit:', error)
    toast.error(error.message || 'Failed to reject edit')
  }
}

/**
 * Handle resending a user message
 * @param {string} messageId
 */
const handleResendMessage = async messageId => {
  try {
    // Resend the message
    await chatGeneration.resendMessage(messageId)
  } catch (error) {
    console.error('Failed to resend message:', error)
    // Check if this is a provider not configured error
    if (error.name === 'ProviderNotConfiguredError') {
      if (isProviderSetupDialogEnabled()) {
        providerSetupDialogVisible.value = true
      } else {
        toast.error('Set up a provider in the settings menu to use chat.')
      }
    } else {
      toast.error(error.message || 'Failed to resend message')
    }
  }
}

/**
 * Handle deleting a message
 * @param {string} messageId
 */
const handleDeleteMessage = (messageId, index = null) => {
  try {
    // A turn made of pieces loses the piece; a turn with nothing left in it
    // goes with it. See useChatCommands.
    chatGeneration.removeCommand(messageId, index)
  } catch (error) {
    console.error('Failed to delete message:', error)
    toast.error('Failed to delete message')
  }
}

/**
 * Fold everything above a turn into a summary, keeping the turn and everything
 * after it: `/compact`, counting what to keep from here to the end.
 *
 * @param {string} messageId - The first message of the turn
 */
const handleSummarize = async messageId => {
  const keep = messages.value.length - messages.value.findIndex(m => m.id === messageId)
  if (keep > messages.value.length) return

  if (setupProblem.value) {
    explainSetup()
    return
  }

  try {
    await seeIn(() => chatGeneration.sendMessage(`/${COMPACT_COMMAND}(${keep})`))
  } catch (error) {
    console.error('Failed to summarize:', error)
    toast.error(error.message || 'Failed to summarize')
  }
}

/**
 * Handle forking the conversation from a specific message
 * @param {string} messageId
 */
const handleForkMessage = messageId => {
  try {
    const forkedChat = chatsApi.forkChat(props.chatId, messageId)
    // Emit event to parent to navigate to the new chat
    emit('open-chat', { chatId: forkedChat.id, title: forkedChat.title })
  } catch (error) {
    console.error('Failed to fork conversation:', error)
    toast.error('Failed to fork conversation')
  }
}

// Where the writer was in the chat when they opened its settings. A hidden
// panel has no scroll position to keep, so it is put back by hand.
let settingsLeftAt = 0

/** Hide the chat behind its settings. */
const openSettings = () => {
  settingsLeftAt = scroller()?.scrollTop ?? 0
  showSettings.value = true
}

/** Give the chat back, where the writer left it. */
const closeSettings = async () => {
  showSettings.value = false
  await nextTick()
  const panel = scroller()
  if (!panel) return
  hushJump()
  panel.scrollTop = settingsLeftAt
}

/**
 * Scroll to the bottom of the chat: the same jump the button makes, once the
 * DOM has what was just added. See `jump` in useJumpToBottom.
 */
const scrollToBottom = async () => {
  await nextTick()
  await jumpToBottom()
}

// Initialize and scroll when component mounts
onMounted(async () => {
  await chatsApi.init()
  scrollToBottom()
})
</script>
