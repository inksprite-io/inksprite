// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightImageZoom from 'starlight-image-zoom';

// Every page the old guide had sends its readers somewhere rather than to a
// 404, since the app and old posts still link to some of them: the ones about
// starting out and connecting a model to the getting-started guide, the rest
// to the About page (privacy, terms, credits) until the guide covers them.
const TO_GUIDE = [
	'/',
	'/welcome',
	'/getting_started',
	'/ai/chat',
	'/ai/configuration',
	'/ai/models',
	'/ai/overview',
	'/ai/provider',
	'/interface/chat',
	'/interface/editor',
	'/interface/outline',
];
const TO_ABOUT = [
	'/roadmap',
	'/ai/context',
	'/ai/parameters',
	'/ai/prompts',
	'/ai/write',
	'/interface/bookshelf',
	'/interface/lorebook',
	'/interface/reader',
	'/interface/settings',
];

// https://astro.build/config
export default defineConfig({
	redirects: {
		...Object.fromEntries(TO_GUIDE.map(page => [page, '/getting-started'])),
		...Object.fromEntries(TO_ABOUT.map(page => [page, '/about'])),
	},
	integrations: [
		starlight({
			title: 'inksprite',
			plugins: [starlightImageZoom({ showCaptions: false })],
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/inksprite-io/inksprite' }],
			customCss: ['./src/styles/media.css'],
			sidebar: [
				{ label: 'Getting started', link: '/getting-started' },
				{ label: 'Narration', link: '/narration' },
				{ label: 'Roleplay', link: '/roleplay' },
				{ label: 'About', link: '/about' },
			],
		}),
	],
});
