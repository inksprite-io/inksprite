<template>
  <audio
    ref="audio"
    :src="url"
    controls
    preload="metadata"
    class="w-full h-9"
    aria-label="Narration"
    data-player
    @timeupdate="report"
    @play="report"
    @pause="report"
    @seeked="report"
  ></audio>
</template>

<script setup>
import { ref } from 'vue'

/**
 * The track, with the browser's own controls: play, pause, scrub. It says
 * where it is as it goes, so the paragraph list can follow, and can be sent
 * to a moment, so the list can lead.
 *
 * @typedef {Object} Props
 * @property {string} url - The track, as an object URL
 */
defineProps({
  url: { type: String, required: true },
})

const emit = defineEmits(['time'])

/** @type {import('vue').Ref<HTMLAudioElement|null>} */
const audio = ref(null)

const report = () => {
  if (audio.value) emit('time', audio.value.currentTime)
}

/**
 * Go to a moment in the track and play from there.
 * @param {number} seconds
 */
const seek = seconds => {
  const element = audio.value
  if (!element) return
  element.currentTime = seconds
  element.play()?.catch?.(() => {})
}

defineExpose({ seek })
</script>
