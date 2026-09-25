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
			// The app icon's orb: bare light on the dark header, on its own dark disc on the light one.
			logo: { dark: './src/assets/logo-dark.png', light: './src/assets/logo-light.png', alt: '' },
			favicon: '/favicon.png',
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/DMCK96/acore-quest-creator' }],
			editLink: { baseUrl: 'https://github.com/DMCK96/acore-quest-creator/edit/main/site/' },
			customCss: ['./src/styles/theme.css'],
			components: { Hero: './src/components/Hero.astro' },
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
