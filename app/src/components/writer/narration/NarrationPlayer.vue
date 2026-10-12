<template>
  <div
    class="flex items-center h-9 px-1 gap-1 rounded-full bg-surface-200 dark:bg-surface-700/50 text-surface-900 dark:text-surface-0"
    :class="{ '*:opacity-60': !url }"
    role="group"
    aria-label="Narration"
    :data-empty="!url || undefined"
    data-player
  >
    <audio
      v-if="url"
      ref="audio"
      :src="url"
      preload="metadata"
      @timeupdate="report"
      @seeked="report"
      @play="playing = true"
      @pause="playing = false"
      @volumechange="muted = !!audio?.muted"
      @loadedmetadata="measure"
      @durationchange="measure"
      @emptied="reset"
    ></audio>
    <button
      type="button"
      :class="BUTTON"
      :aria-label="playing ? 'Pause' : 'Play'"
      :disabled="!url"
      data-action="toggle-play"
      @click="toggle"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <path :d="playing ? PAUSE : PLAY" />
      </svg>
    </button>
    <span class="shrink-0 text-sm tabular-nums text-surface-700 dark:text-surface-200" data-time>
      {{ clock(time) }} / {{ clock(duration) }}
    </span>
    <input
      type="range"
      class="scrubber flex-1 min-w-0 mx-2"
      min="0"
      :max="duration || 0"
      step="0.01"
      :value="time"
      :disabled="!duration"
      :style="{ '--played': `${played}%` }"
      aria-label="Position"
      :aria-valuetext="`${clock(time)} of ${clock(duration)}`"
      data-scrubber
      @input="scrub"
    />
    <button
      type="button"
      :class="BUTTON"
      :aria-label="muted ? 'Unmute' : 'Mute'"
      :aria-pressed="muted"
      :disabled="!url"
      data-action="toggle-mute"
      @click="toggleMute"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
        <path d="M3.5 9H7l4.5-4v14L7 15H3.5z" fill="currentColor" />
        <path
          :d="muted ? CROSS : WAVES"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    </button>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

/**
 * The track: play or pause it, scrub through it, mute it. Drawn after the
 * browser's own controls, which the panel had first, but not those: in a
 * panel this narrow Chromium's squeeze the timeline to a stub and lay the
 * volume slider over it, and Safari's are another thing again. There is no
 * volume but the system's. It says where it is as it goes, so the segment
 * list can follow, and can be sent to a moment, so the list can lead. With
 * no track it stays where it is, greyed out, rather than come and go.
 *
 * @typedef {Object} Props
 * @property {string} [url] - The track, as an object URL; none while there is nothing to play
 */
const props = defineProps({
  url: { type: String, default: '' },
})

const emit = defineEmits(['time'])

const BUTTON =
  'shrink-0 w-8 h-8 flex items-center justify-center rounded-full enabled:cursor-pointer enabled:hover:bg-black/5 dark:enabled:hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-primary-500'

const PLAY = 'M8 5.5v13l10.5-6.5z'
const PAUSE = 'M7 5.5h3.5v13H7zM13.5 5.5H17v13h-3.5z'
const WAVES = 'M14.5 9.5a3.5 3.5 0 0 1 0 5M17 7a7 7 0 0 1 0 10'
const CROSS = 'M15 9.5l5 5M20 9.5l-5 5'

/** @type {import('vue').Ref<HTMLAudioElement|null>} */
const audio = ref(null)

const playing = ref(false)
const muted = ref(false)
/** Where the track is, in seconds. */
const time = ref(0)
/** How long it is, in seconds; 0 until it is known. */
const duration = ref(0)

/** How much of the track is behind the playhead, as a percentage, for the timeline's fill. */
const played = computed(() => (duration.value ? (time.value / duration.value) * 100 : 0))

const report = () => {
  if (!audio.value) return
  time.value = audio.value.currentTime
  emit('time', time.value)
}

const measure = () => {
  const length = audio.value?.duration
  duration.value = Number.isFinite(length) ? /** @type {number} */ (length) : 0
}

// A track joined again starts over, and a track gone leaves nothing to be at.
const reset = () => {
  playing.value = false
  time.value = 0
  duration.value = 0
  emit('time', 0)
}

watch(
  () => props.url,
  url => {
    if (!url) reset()
  }
)

const toggle = () => {
  const element = audio.value
  if (!element) return
  if (element.paused) element.play()?.catch?.(() => {})
  else element.pause()
}

const toggleMute = () => {
  if (audio.value) audio.value.muted = !audio.value.muted
}

/** @param {Event} event */
const scrub = event => {
  const element = audio.value
  if (!element) return
  element.currentTime = Number(/** @type {HTMLInputElement} */ (event.target).value)
  report()
}

/**
 * A time the way the player shows it: `1:05`.
 * @param {number} seconds
 */
const clock = seconds => {
  const whole = Math.max(0, Math.floor(seconds || 0))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
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

<style scoped>
/* A thin timeline in the text's colour: dark for what has played, faint for
   the rest, with a dot to drag. The input is taller than the line it draws,
   to be easy to catch. */
.scrubber {
  --fill: color-mix(in srgb, currentColor 70%, transparent);
  --rest: color-mix(in srgb, currentColor 22%, transparent);
  appearance: none;
  height: 16px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.scrubber:disabled {
  cursor: default;
}

.scrubber:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
  border-radius: 4px;
}

.scrubber::-webkit-slider-runnable-track {
  height: 4px;
  border-radius: 9999px;
  background: linear-gradient(
    to right,
    var(--fill) var(--played, 0%),
    var(--rest) var(--played, 0%)
  );
}

.scrubber::-webkit-slider-thumb {
  appearance: none;
  width: 12px;
  height: 12px;
  margin-top: -4px;
  border-radius: 9999px;
  background: currentColor;
}

.scrubber::-moz-range-track {
  height: 4px;
  border-radius: 9999px;
  background: var(--rest);
}

.scrubber::-moz-range-progress {
  height: 4px;
  border-radius: 9999px;
  background: var(--fill);
}

.scrubber::-moz-range-thumb {
  width: 12px;
  height: 12px;
  border: 0;
  border-radius: 9999px;
  background: currentColor;
}
</style>
