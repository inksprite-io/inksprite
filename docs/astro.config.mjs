// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// The guide is being rewritten. Until it is, the site is the About page
// (privacy, terms, credits), and every page the old guide had sends its
// readers there rather than to a 404 — the app and old posts still link to
// some of them.
const OLD_PAGES = [
	'/',
	'/welcome',
	'/getting_started',
	'/roadmap',
	'/ai/chat',
	'/ai/configuration',
	'/ai/context',
	'/ai/models',
	'/ai/overview',
	'/ai/parameters',
	'/ai/prompts',
	'/ai/provider',
	'/ai/write',
	'/interface/bookshelf',
	'/interface/chat',
	'/interface/editor',
	'/interface/lorebook',
	'/interface/outline',
	'/interface/reader',
	'/interface/settings',
];

// https://astro.build/config
export default defineConfig({
	redirects: Object.fromEntries(OLD_PAGES.map(page => [page, '/about'])),
	integrations: [
		starlight({
			title: 'inksprite',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/inksprite-io/inksprite' }],
			sidebar: [{ label: 'About', link: '/about' }],
		}),
	],
});
