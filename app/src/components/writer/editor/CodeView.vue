<template>
  <div ref="host" class="code-view h-full w-full min-h-0 overflow-hidden" data-file-code></div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { LanguageDescription, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { classHighlighter } from '@lezer/highlight'

/**
 * A file's text as code: read-only, with line numbers, highlighted for the
 * language its name says. CodeMirror draws only what is on screen, so a long
 * file costs what a short one does.
 *
 * The highlighting is classes (`tok-keyword`, `tok-string`, …) coloured
 * below for light and dark, so it follows the app's theme without a second
 * CodeMirror theme to switch. Each language's parser is loaded the first
 * time a file of it is opened.
 *
 * Loaded on its own, the first time a file of text is opened, so the editor
 * and its languages are not in the app until then.
 *
 * @typedef {Object} Props
 * @property {string} content - The text
 * @property {string} filename - Its name, which decides the highlighting
 */
const props = defineProps({
  content: { type: String, default: '' },
  filename: { type: String, default: '' },
})

/** @type {import('vue').Ref<HTMLElement|null>} */
const host = ref(null)
/** @type {EditorView|null} */
let view = null
const language = new Compartment()

const layout = EditorView.theme({
  '&': { height: '100%', fontSize: '13px', backgroundColor: 'transparent' },
  '.cm-scroller': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
    lineHeight: '1.55',
  },
  '.cm-content': { padding: '12px 0 50vh' },
  '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid var(--code-rule)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 12px 0 16px', color: 'var(--code-gutter)' },
  '.cm-line': { padding: '0 16px' },
})

/**
 * The highlighting for a file, by its name, or nothing when no language
 * claims it or its parser will not load.
 *
 * @param {string} filename
 */
async function languageFor(filename) {
  const found = LanguageDescription.matchFilename(languages, filename)
  if (!found) return []
  try {
    return await found.load()
  } catch {
    return []
  }
}

/** Set the highlighting for the current file, if it is still the one shown. */
async function highlight() {
  const asked = props.filename
  const support = await languageFor(asked)
  if (view && props.filename === asked) view.dispatch({ effects: language.reconfigure(support) })
}

onMounted(() => {
  if (!host.value) return
  view = new EditorView({
    parent: host.value,
    state: EditorState.create({
      doc: props.content,
      extensions: [
        lineNumbers(),
        EditorState.readOnly.of(true),
        EditorView.editable.of(false),
        syntaxHighlighting(classHighlighter),
        language.of([]),
        layout,
      ],
    }),
  })
  highlight()
})

watch(
  () => props.content,
  content => {
    if (!view || view.state.doc.toString() === content) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: content } })
  }
)

watch(
  () => props.filename,
  () => highlight()
)

onBeforeUnmount(() => {
  view?.destroy()
  view = null
})
</script>

<style>
.code-view {
  --code-rule: #e5e7eb;
  --code-gutter: #8c959f;
  color: #1f2328;
}
.dark .code-view {
  --code-rule: #30363d;
  --code-gutter: #6e7681;
  color: #e6edf3;
}

.code-view .tok-keyword,
.code-view .tok-operatorKeyword,
.code-view .tok-modifier {
  color: #cf222e;
}
.code-view .tok-string,
.code-view .tok-string2,
.code-view .tok-url {
  color: #0a3069;
}
.code-view .tok-number,
.code-view .tok-bool,
.code-view .tok-atom,
.code-view .tok-literal,
.code-view .tok-propertyName {
  color: #0550ae;
}
.code-view .tok-comment {
  color: #6e7781;
  font-style: italic;
}
.code-view .tok-typeName,
.code-view .tok-className,
.code-view .tok-namespace {
  color: #953800;
}
.code-view .tok-definition,
.code-view .tok-macroName,
.code-view .tok-meta {
  color: #8250df;
}
.code-view .tok-heading,
.code-view .tok-strong {
  font-weight: 600;
}
.code-view .tok-emphasis {
  font-style: italic;
}
.code-view .tok-invalid {
  color: #82071e;
}

.dark .code-view .tok-keyword,
.dark .code-view .tok-operatorKeyword,
.dark .code-view .tok-modifier {
  color: #ff7b72;
}
.dark .code-view .tok-string,
.dark .code-view .tok-string2,
.dark .code-view .tok-url {
  color: #a5d6ff;
}
.dark .code-view .tok-number,
.dark .code-view .tok-bool,
.dark .code-view .tok-atom,
.dark .code-view .tok-literal,
.dark .code-view .tok-propertyName {
  color: #79c0ff;
}
.dark .code-view .tok-comment {
  color: #8b949e;
}
.dark .code-view .tok-typeName,
.dark .code-view .tok-className,
.dark .code-view .tok-namespace {
  color: #ffa657;
}
.dark .code-view .tok-definition,
.dark .code-view .tok-macroName,
.dark .code-view .tok-meta {
  color: #d2a8ff;
}
.dark .code-view .tok-invalid {
  color: #ffa198;
}
</style>
