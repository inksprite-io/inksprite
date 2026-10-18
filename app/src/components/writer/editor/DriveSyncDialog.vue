<template>
  <Dialog
    :visible="!!question"
    :header="question?.kind === 'clashes' ? 'Both changed the same words' : 'First sync'"
    :modal="true"
    class="w-full max-w-2xl mx-4"
    data-sync-dialog
    @update:visible="shown => !shown && cancel()"
  >
    <div v-if="question?.kind === 'first'" class="flex flex-col gap-3 text-sm" data-sync-first>
      <p>
        “{{ question.title }}” and its Google Doc haven’t been synced before, so one of them is
        taken as it is.
      </p>
      <p class="text-surface-600 dark:text-surface-300">
        Keep mine undoes in the Doc the edits made there since the import. Use the Doc’s loses the
        edits made here.
      </p>
    </div>

    <div v-else-if="question?.kind === 'clashes'" class="flex flex-col gap-4" data-sync-clashes>
      <p class="text-sm">“{{ question.title }}” and its Google Doc both changed these words.</p>
      <section
        v-for="(clash, i) in shown"
        :key="i"
        class="flex flex-col gap-2"
        :data-sync-clash="i"
      >
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <button
            v-for="side in SIDES"
            :key="side.value"
            type="button"
            class="text-left rounded border p-3 text-sm whitespace-pre-wrap break-words focus-visible:outline-2 focus-visible:outline-primary-500"
            :class="
              chosen[i] === side.value
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-950'
                : 'border-surface-200 dark:border-surface-700 hover:border-surface-400'
            "
            :aria-pressed="chosen[i] === side.value"
            :data-sync-side="side.value"
            @click="chosen[i] = side.value"
          >
            <span class="block text-xs font-medium text-surface-500 mb-1">{{ side.label }}</span>
            <span v-if="clash[side.value].length === 0" class="italic text-surface-500">
              Deleted
            </span>
            <template v-for="(piece, k) in clash[side.value]" v-else :key="k">
              <mark v-if="piece.changed" class="bg-amber-200 dark:bg-amber-700 rounded-sm">{{
                piece.text
              }}</mark>
              <template v-else>{{ piece.text }}</template>
            </template>
          </button>
        </div>
      </section>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" text data-sync-cancel @click="cancel" />
      <template v-if="question?.kind === 'first'">
        <Button
          label="Use the Doc’s"
          severity="secondary"
          outlined
          data-sync-theirs
          @click="answerFirst('theirs')"
        />
        <Button label="Keep mine" data-sync-mine @click="answerFirst('mine')" />
      </template>
      <Button v-else label="Sync" data-sync-go @click="answerClashes" />
    </template>
  </Dialog>
</template>

<script setup>
/**
 * What a sync with a Google Doc asks the writer, once for the app: at a
 * first sync, which side to take whole; where both sides changed the same
 * words, which side's to keep for each, the words that differ marked. See
 * `useDriveSync`.
 */
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import { useSyncQuestion } from '@/composables/useDriveSync.js'
import { diffSequences } from '@/utils/diff.js'

/** @typedef {import('@/drive/sync.js').Side} Side */
/** @typedef {import('prosemirror-model').Node} Node */

/** @type {Array<{value: Side, label: string}>} */
const SIDES = [
  { value: 'mine', label: 'This document' },
  { value: 'theirs', label: 'Google Doc' },
]

const { question } = useSyncQuestion()

/** @type {import('vue').Ref<Side[]>} Each clash's side, this document's until chosen. */
const chosen = ref([])
watch(
  question,
  asked => {
    chosen.value = asked?.kind === 'clashes' ? asked.clashes.map(() => 'mine') : []
  },
  { immediate: true }
)

/**
 * Blocks as the text they show, a blank line between them.
 *
 * @param {Node[]} blocks
 * @returns {string}
 */
const textOf = blocks =>
  blocks.map(node => node.textBetween(0, node.content.size, '\n', '\n')).join('\n\n')

/**
 * Text in words and the spaces between them.
 *
 * @param {string} text
 * @returns {string[]}
 */
const wordsOf = text => text.match(/\s+|[^\s]+/g) ?? []

/**
 * Each clash's two sides as pieces of text, those the other side lacks marked.
 */
const shown = computed(() => {
  const asked = question.value
  if (asked?.kind !== 'clashes') return []
  return asked.clashes.map(clash => {
    const mine = wordsOf(textOf(clash.mine))
    const theirs = wordsOf(textOf(clash.theirs))
    const steps = diffSequences(mine, theirs) ?? []
    /** @type {Record<Side, Array<{text: string, changed: boolean}>>} */
    const out = { mine: [], theirs: [] }
    for (const step of steps) {
      if (step.op === 'equal') {
        out.mine.push({ text: mine[step.a], changed: false })
        out.theirs.push({ text: theirs[step.b], changed: false })
      } else if (step.op === 'delete') {
        out.mine.push({ text: mine[step.a], changed: /\S/.test(mine[step.a]) })
      } else {
        out.theirs.push({ text: theirs[step.b], changed: /\S/.test(theirs[step.b]) })
      }
    }
    return out
  })
})

/** @param {Side} side */
const answerFirst = side => {
  const asked = question.value
  if (asked?.kind === 'first') asked.answer(side)
}

const answerClashes = () => {
  const asked = question.value
  if (asked?.kind === 'clashes') asked.answer([...chosen.value])
}

const cancel = () => question.value?.answer(null)
</script>
