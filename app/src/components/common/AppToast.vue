<template>
  <!-- Every toast, in the one stack. What is in each is drawn by ToastContent,
       so a toast with something to do in it — an Undo — stacks with the rest
       rather than in a corner of its own. -->
  <Toast @mouse-enter="hold" @mouse-leave="hold">
    <template #message="{ message }">
      <ToastContent :message="message" />
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
</script>
