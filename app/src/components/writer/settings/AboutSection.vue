<template>
  <div class="flex flex-col gap-5 px-2 pt-2 pb-1 text-xs text-surface-500 dark:text-surface-400">
    <section class="flex flex-col gap-1">
      <p class="text-sm text-surface-700 dark:text-surface-200">
        inksprite is free software under the
        <a :href="LICENSE_URL" target="_blank" rel="noopener noreferrer" :class="LINK"
          >GNU Affero General Public License, version 3 or later</a
        >. Its source is at
        <a :href="SOURCE_URL" target="_blank" rel="noopener noreferrer" :class="LINK">{{
          SOURCE_URL.replace('https://', '')
        }}</a
        >.
      </p>
      <p>The license covers the app. What you write with it is yours.</p>
    </section>

    <ExpandableSection title="Credits" subsection content-wrapper-class="flex flex-col gap-5 pt-2">
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

      <section class="flex flex-col gap-1" data-credits="fonts">
        <h3 class="font-medium text-surface-700 dark:text-surface-200">Font</h3>
        <p v-for="font in FONT_CREDITS" :key="font.name">
          <a :href="font.url" target="_blank" rel="noopener noreferrer" :class="LINK">{{
            font.name
          }}</a>
          by {{ font.creator }}, under the
          <a :href="font.license.url" target="_blank" rel="noopener noreferrer" :class="LINK">{{
            font.license.name
          }}</a
          >.
        </p>
      </section>
    </ExpandableSection>
  </div>
</template>

<script setup>
/**
 * What inksprite is released under, where its source is, and the credit the
 * icons and the font ask for wherever they are used — which, for a build
 * someone paid for, means inside the app.
 */
import ExpandableSection from '@/components/common/ExpandableSection.vue'
import { FONT_CREDITS, ICON_CREDITS, ICON_LICENSE, iconUrl } from '@/config/credits.js'

const LICENSE_URL = 'https://www.gnu.org/licenses/agpl-3.0.html'
const SOURCE_URL = 'https://github.com/inksprite-io/inksprite'
const LINK = 'text-primary-600 dark:text-primary-400 hover:underline'
</script>
