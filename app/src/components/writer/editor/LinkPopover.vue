<template>
  <div
    ref="root"
    class="absolute z-10 max-w-full"
    :style="{ left: `${Math.max(0, left - shift)}px`, top: `${top}px` }"
    data-link-popover
  >
    <div
      class="flex items-center gap-1 rounded-md border border-surface-200 dark:border-surface-700 bg-surface-0 dark:bg-surface-800 shadow-md px-2 py-1 text-sm"
    >
      <!-- Pressing here leaves the caret in the editor, in the link; so does
           a right press, which opens the link's own menu. -->
      <div
        v-if="!editing"
        class="flex items-center gap-1 min-w-0"
        @mousedown.prevent
        @contextmenu.prevent.stop="openMenu"
      >
        <i
          class="pi flex-none text-surface-500 dark:text-surface-400"
          :class="document ? 'pi-file' : 'pi-link'"
        />
        <button
          type="button"
          class="min-w-0 max-w-80 truncate text-primary-600 dark:text-primary-400 hover:underline"
          :title="href"
          data-action="open-link"
          @click="$emit('open')"
        >
          {{ document || href }}
        </button>
        <Button
          v-tooltip.top="'Copy link'"
          icon="pi pi-copy"
          severity="secondary"
          text
          size="small"
          aria-label="Copy link"
          class="flex-none"
          data-action="copy-link"
          @click="$emit('copy')"
        />
        <Button
          v-tooltip.top="'Edit link'"
          icon="pi pi-pencil"
          severity="secondary"
          text
          size="small"
          aria-label="Edit link"
          class="flex-none"
          data-action="edit-link"
          @click="$emit('edit')"
        />
        <Button
          v-tooltip.top="'Remove link'"
          icon="pi pi-times"
          severity="secondary"
          text
          size="small"
          aria-label="Remove link"
          class="flex-none"
          data-action="remove-link"
          @click="$emit('remove')"
        />
      </div>

      <!-- Escape goes back to the text; going anywhere else just puts it away. -->
      <form
        v-else
        class="flex items-end gap-1"
        @submit.prevent="submit"
        @keydown.capture="onKeydown"
        @keydown.esc.stop.prevent="$emit('close', true)"
        @focusout="onFocusOut"
      >
        <!-- The link's words above, where it goes below. -->
        <div class="flex flex-col gap-1">
          <InputText
            v-if="withText"
            v-model="text"
            size="small"
            class="w-64"
            placeholder="Text"
            aria-label="Text"
            data-link-text
          />
          <InputText
            ref="addressField"
            v-model="address"
            size="small"
            class="w-64"
            placeholder="Link, or a document's name"
            aria-label="Link"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            role="combobox"
            :aria-expanded="showing"
            :aria-controls="listId"
            :aria-activedescendant="showing ? `${listId}-${active}` : undefined"
            data-link-address
            @input="typed = true"
          />
        </div>
        <Button
          v-tooltip.top="'Apply'"
          type="submit"
          icon="pi pi-check"
          severity="secondary"
          text
          size="small"
          aria-label="Apply"
          data-action="apply-link"
        />
      </form>
    </div>

    <LinkSuggestions
      v-if="showing"
      :id="listId"
      class="mt-1"
      :entries="entries"
      :active="active"
      @pick="pick"
      @hover="active = $event"
    />

    <ContextMenu ref="menu" :model="menuItems" @hide="$emit('menu', false)" />
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import Button from 'primevue/button'
import ContextMenu from 'primevue/contextmenu'
import InputText from 'primevue/inputtext'
import LinkSuggestions from './LinkSuggestions.vue'

/**
 * The link the caret is in, shown under it, or the field for making or
 * changing one (see `editor/links`). Placed by the editor, in its page.
 *
 * Typed into, the field lists the documents the words could name, and after
 * a `#` a document's headings, to pick from with the arrows and Enter or a
 * click; a web address typed in full lists nothing.
 *
 * @typedef {Object} Props
 * @property {string} href - Where the link goes, or the address to start the field with
 * @property {string} [document] - The name of the document it goes to, when it goes to one
 * @property {number} left - From the left of the page, in pixels
 * @property {number} top - From the top of the page, in pixels
 * @property {boolean} [editing] - The field rather than the link
 * @property {boolean} [withText] - The field asks for the link's words too
 * @property {string} [text] - Its words as they are, to change, for a link there
 * @property {(query: string) => import('@/composables/useDocumentLinks.js').LinkSuggestion[]} [suggest]
 */
const props = defineProps({
  href: { type: String, required: true },
  document: { type: String, default: '' },
  left: { type: Number, required: true },
  top: { type: Number, required: true },
  editing: { type: Boolean, default: false },
  withText: { type: Boolean, default: false },
  text: { type: String, default: '' },
  suggest: { type: Function, default: () => [] },
})

/** `menu`: its own menu opened (true) or put away (false). */
const emit = defineEmits(['open', 'copy', 'edit', 'remove', 'apply', 'close', 'menu'])

/** @type {import('vue').Ref<HTMLElement|null>} */
const root = ref(null)
/** @type {import('vue').Ref<{ $el: HTMLInputElement }|null>} */
const addressField = ref(null)
/** @type {import('vue').Ref<{ show: (event: Event) => void }|null>} */
const menu = ref(null)

const address = ref(props.href)
const text = ref(props.text)
/** Whether the field has been typed in: what it opened with lists nothing. */
const typed = ref(false)
/** Whether Escape put the list away, until the field is typed in again. */
const dismissed = ref(false)
const active = ref(0)
const listId = `link-suggestions-${useId()}`

/** A web or mail address, or a link with a scheme: nothing to look up. */
const ELSEWHERE = /^[a-z][a-z0-9+.-]*:/i

const entries = computed(() => {
  const query = address.value.trim()
  if (!props.editing || !typed.value || !query || ELSEWHERE.test(query)) return []
  return props.suggest(query)
})
const showing = computed(() => entries.value.length > 0 && !dismissed.value)

watch(address, () => {
  dismissed.value = false
  active.value = 0
})

/** How far left of where it was put it has to go to stay on the page. */
const shift = ref(0)

const fit = async () => {
  shift.value = 0
  await nextTick()
  const element = root.value
  const page = /** @type {HTMLElement|null} */ (element?.offsetParent ?? null)
  if (!element || !page) return
  shift.value = Math.max(0, element.offsetLeft + element.offsetWidth - page.clientWidth)
}

/** The field opens with the address in hand, to type over or paste into. */
const focusField = async () => {
  await nextTick()
  addressField.value?.$el.focus()
  addressField.value?.$el.select()
}

onMounted(() => {
  fit()
  if (props.editing) focusField()
})

watch(
  () => [props.left, props.top, props.href, props.editing],
  () => {
    fit()
    if (props.editing) {
      address.value = props.href
      text.value = props.text
      typed.value = false
      focusField()
    }
  }
)

/** @param {FocusEvent} event */
const onFocusOut = event => {
  const next = /** @type {Node|null} */ (event.relatedTarget)
  if (!next || !root.value?.contains(next)) emit('close', false)
}

/** Make the link to the one picked, its words the writer's or its name. */
const pick = (/** @type {number} */ index) => {
  const entry = entries.value[index]
  if (entry) emit('apply', { href: entry.href, text: text.value.trim() || entry.title })
}

const submit = () => {
  if (showing.value) pick(active.value)
  else emit('apply', { href: address.value, text: text.value })
}

/**
 * The list's keys, while it shows: the arrows move in it, and Escape puts it
 * away before it puts the field away.
 * @param {KeyboardEvent} event
 */
const onKeydown = event => {
  if (!showing.value) return
  const count = entries.value.length
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault()
    active.value = (active.value + (event.key === 'ArrowDown' ? 1 : count - 1)) % count
  } else if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    dismissed.value = true
  } else if (event.key === 'Tab' && !event.shiftKey) {
    event.preventDefault()
    pick(active.value)
  }
}

const menuItems = [
  { label: 'Open link', icon: 'pi pi-external-link', command: () => emit('open') },
  { label: 'Copy link', icon: 'pi pi-copy', command: () => emit('copy') },
  { label: 'Edit link…', icon: 'pi pi-pencil', command: () => emit('edit') },
  { label: 'Remove link', icon: 'pi pi-times', command: () => emit('remove') },
]

/** @param {MouseEvent} event */
const openMenu = event => {
  emit('menu', true)
  menu.value?.show(event)
}
</script>
