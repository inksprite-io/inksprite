<template>
  <!-- Every toast, in the one stack. What is in each is drawn by ToastContent,
       so a toast with something to do in it — an Undo — stacks with the rest
       rather than in a corner of its own. -->
  <Toast @mouse-enter="hold" @mouse-leave="hold">
    <template #message="{ message }">
      <ToastContent :message="message" @keep="keep(message)" />
    </template>
  </Toast>
</template>

<script setup>
import Toast from 'primevue/toast'
import ToastContent from './ToastContent.vue'

/**
 * Nothing of its own to do. PrimeVue only pauses a toast's timer under the
 * pointer, and starts it again on the way out, when there is a handler for
 * each — so this is what turns that on.
 */
const hold = () => {}

/**
 * Keep a toast until it is closed. The pointer is on it when this is asked
 * for, so its timer is already paused; with no life left in it, the timer
 * does not start again when the pointer leaves.
 * @param {{life?: number|null}} message
 */
const keep = message => {
  message.life = null
}
</script>
