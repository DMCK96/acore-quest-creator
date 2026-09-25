// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightLinksValidator from 'starlight-links-validator';

// Served from GitHub Pages as a project site, so every URL lives under the repo name.
export default defineConfig({
	site: 'https://dmck96.github.io',
	base: '/acore-quest-creator',
	integrations: [
		starlight({
			title: 'ACORE Quest Creator',
			description: 'Build and script AzerothCore quests, NPCs and objects without editing database tables by hand.',
			logo: { src: './src/assets/logo.svg' },
			favicon: '/favicon.svg',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/DMCK96/acore-quest-creator' }],
			editLink: { baseUrl: 'https://github.com/DMCK96/acore-quest-creator/edit/main/site/' },
			customCss: ['./src/styles/theme.css'],
			plugins: [starlightLinksValidator()],
			sidebar: [
				{ label: 'Getting started', items: [{ autogenerate: { directory: 'getting-started' } }] },
				{ label: 'Guides', items: [{ autogenerate: { directory: 'guides' } }] },
				{ label: 'Reference', items: [{ autogenerate: { directory: 'reference' } }] },
				{ label: 'Contributing', items: [{ autogenerate: { directory: 'contributing' } }] },
			],
		}),
	],
});
