// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightImageZoom from 'starlight-image-zoom';

// Every page the old guide had sends its readers somewhere rather than to a
// 404, since the app and old posts still link to some of them: each to the
// page that covers it now, and what none covers to the About page (privacy,
// terms, credits).
const MOVED = {
	'/': '/getting-started',
	'/welcome': '/getting-started',
	'/getting_started': '/getting-started',
	'/ai/overview': '/getting-started',
	'/ai/configuration': '/providers',
	'/ai/models': '/providers',
	'/ai/parameters': '/providers',
	'/ai/provider': '/providers',
	'/ai/chat': '/chats',
	'/ai/context': '/chats',
	'/ai/prompts': '/chats',
	'/interface/chat': '/chats',
	'/ai/write': '/skills',
	'/interface/editor': '/editor',
	'/interface/outline': '/projects',
	'/interface/bookshelf': '/projects',
	'/interface/lorebook': '/roleplay',
	'/interface/reader': '/files',
	'/interface/settings': '/about',
	'/roadmap': '/about',
};

// https://astro.build/config
export default defineConfig({
	redirects: MOVED,
	integrations: [
		starlight({
			title: 'inksprite',
			plugins: [starlightImageZoom({ showCaptions: false })],
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/inksprite-io/inksprite' }],
			customCss: ['./src/styles/media.css'],
			sidebar: [
				{ label: 'Getting Started', link: '/getting-started' },
				{
					label: 'Guides',
					items: [
						{ label: 'Research', link: '/research' },
						{ label: 'Roleplay', link: '/roleplay' },
						{ label: 'Narration', link: '/narration' },
					],
				},
				{
					label: 'Writing',
					items: [
						{ label: 'Projects', link: '/projects' },
						{ label: 'The Editor', link: '/editor' },
						{ label: 'Comments', link: '/comments' },
						{ label: 'PDFs, Images, and Ebooks', link: '/files' },
						{ label: 'Code Repositories', link: '/repositories' },
						{ label: 'Google Docs', link: '/google-docs' },
					],
				},
				{
					label: 'AI',
					items: [
						{ label: 'Chats', link: '/chats' },
						{ label: 'AI Providers', link: '/providers' },
						{ label: 'Skills', link: '/skills' },
						{ label: 'Web Search', link: '/web-search' },
						{ label: 'MCP Servers', link: '/mcp' },
					],
				},
				{ label: 'Sync Between Devices', link: '/sync' },
				{ label: 'The Desktop App', link: '/desktop' },
				{ label: 'About', link: '/about' },
			],
		}),
	],
});
