<template>
  <div class="flex flex-col gap-5 px-2 pt-2 pb-1 text-xs text-surface-500 dark:text-surface-400">
    <section class="flex flex-col gap-2 text-sm text-surface-700 dark:text-surface-200">
      <p v-if="version" data-version>inksprite {{ version }}</p>
      <p>Copyright © 2025–2026 The inksprite Authors.</p>
      <p>
        inksprite is free software under the
        <a :href="LICENSE_URL" target="_blank" rel="noopener noreferrer" :class="LINK"
          >GNU General Public License, version 3 or later</a
        >, and comes with no warranty.
      </p>
      <p>
        <a :href="SOURCE_URL" target="_blank" rel="noopener noreferrer" :class="LINK"
          >Source code</a
        >
      </p>
      <p>
        <a :href="ISSUES_URL" target="_blank" rel="noopener noreferrer" :class="LINK"
          >Report an issue</a
        >
      </p>
    </section>

    <ExpandableSection title="Credits" subsection content-wrapper-class="flex flex-col gap-5 pt-2">
      <section
        v-for="program in PROGRAM_CREDITS"
        :key="program.name"
        class="flex flex-col gap-1"
        :data-credits="program.name"
      >
        <h3 class="font-medium text-surface-700 dark:text-surface-200">{{ program.use }}</h3>
        <p>
          <a :href="program.url" target="_blank" rel="noopener noreferrer" :class="LINK">{{
            program.name
          }}</a>
          by {{ program.by }}, under the
          <a :href="program.license.url" target="_blank" rel="noopener noreferrer" :class="LINK">{{
            program.license.name
          }}</a
          >.
        </p>
      </section>
      <section class="flex flex-col gap-1" data-credits="icons">
        <h3 class="font-medium text-surface-700 dark:text-surface-200">Icons</h3>
        <p>
          From the
          <a
            href="https://thenounproject.com"
            target="_blank"
            rel="noopener noreferrer"
            :class="LINK"
            >Noun Project</a
          >, under
          <a :href="ICON_LICENSE.url" target="_blank" rel="noopener noreferrer" :class="LINK">{{
            ICON_LICENSE.name
          }}</a
          >:
        </p>
        <ul class="flex flex-col gap-0.5">
          <li v-for="icon in ICON_CREDITS" :key="icon.id">
            <a :href="iconUrl(icon.id)" target="_blank" rel="noopener noreferrer" :class="LINK">{{
              icon.title
            }}</a>
            by {{ icon.creator }}
          </li>
        </ul>
      </section>
    </ExpandableSection>
  </div>
</template>

<script setup>
/**
 * The notices the GPL asks an interactive program to show (copyright, no
 * warranty, the license), where the source and the issues are, and the
 * credit the icons ask for wherever they are used — which, for a build
 * someone paid for, means inside the app.
 */
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import { ICON_CREDITS, ICON_LICENSE, PROGRAM_CREDITS, iconUrl } from '@/config/credits.js'

defineProps({
  /**
   * The release this is: a release build's from its tag
   * (.github/workflows/release.yml), any other build's the newest release in
   * the changelog (vite.config.js). A build that can't read the changelog,
   * such as the test server's, has none.
   */
  version: { type: String, default: import.meta.env.VITE_APP_VERSION || '' },
})

const LICENSE_URL = 'https://www.gnu.org/licenses/gpl-3.0.html'
const SOURCE_URL = 'https://github.com/inksprite-io/inksprite'
const ISSUES_URL = `${SOURCE_URL}/issues`
const LINK = 'text-primary-600 dark:text-primary-400 hover:underline'
</script>
