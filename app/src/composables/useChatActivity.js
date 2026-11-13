/**
 * @module composables/useChatActivity
 * @description Which chats the model is working in, app-wide.
 *
 * A chat's model is working while a turn of it is under way and nothing in
 * the turn is waiting on the writer: a call waiting for Allow has stopped the
 * work until it is answered. Each chat's `useAIChat` says when that changes,
 * and the chat panel's tabs and the chat list read it here, for a chat that
 * is busy and one the model has finished in while the writer was elsewhere
 * (`useChatTabs`).
 *
 * Live only, like a turn: a page reloaded mid-turn has no turn running.
 */
import { reactive } from 'vue'

/** The chats the model is working in, by id. @type {Set<string>} */
const working = reactive(new Set())

/** @typedef {(storyId: string, chatId: string) => void} StoppedListener */

/** @type {Set<StoppedListener>} */
const listeners = new Set()

/**
 * Say whether the model is working in a chat. Its stopping, for whatever
 * reason, is passed on to whoever listens.
 *
 * @param {string} storyId
 * @param {string} chatId
 * @param {boolean} now
 */
export function reportWorking(storyId, chatId, now) {
  if (now) {
    working.add(chatId)
    return
  }
  if (!working.delete(chatId)) return
  for (const listener of listeners) listener(storyId, chatId)
}

/**
 * Whether the model is working in a chat.
 *
 * @param {string} chatId
 * @returns {boolean}
 */
export function isWorking(chatId) {
  return working.has(chatId)
}

/**
 * Be told each time the model stops working in a chat.
 *
 * @param {StoppedListener} listener
 * @returns {() => void} What stops telling it
 */
export function onStoppedWorking(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Forget every chat's work and every listener (for testing).
 */
export function clearChatActivity() {
  working.clear()
  listeners.clear()
}
