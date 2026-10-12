<template>
  <!-- eslint-disable-next-line vue/no-v-html -- terms.md is ours, and markdown-it escapes HTML -->
  <div
    class="px-2 pt-2 pb-1 prose prose-sm dark:prose-invert max-w-none text-surface-700 dark:text-surface-200 prose-headings:text-surface-800 dark:prose-headings:text-surface-100 prose-h3:text-sm prose-h3:font-semibold [&>:first-child]:mt-0 prose-h3:mt-5 prose-h3:mb-2 prose-p:my-2 prose-ul:my-2 prose-li:my-0.5 prose-a:font-normal prose-a:no-underline hover:prose-a:underline prose-a:text-primary-600 dark:prose-a:text-primary-400"
    data-terms
    v-html="html"
  />
</template>

<script setup>
/**
 * The Terms of Service, as the docs' About page has them. `terms.md` is a
 * copy of that section, and a test fails when the two differ.
 */
import MarkdownIt from 'markdown-it'
import terms from './terms.md?raw'

const markdown = new MarkdownIt()

// A link leaves the app for a tab of its own, as every link out of it does.
markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noopener noreferrer')
  return self.renderToken(tokens, index, options)
}

const html = markdown.render(terms)
</script>
