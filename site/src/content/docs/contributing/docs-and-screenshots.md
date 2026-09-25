---
title: Docs and screenshots
description: Work on this documentation site and regenerate its screenshots.
sidebar:
  order: 4
---

This site is an [Astro Starlight](https://starlight.astro.build/) project in the repository's `site/` folder, with its own `package.json`.

## Run it locally

```sh
npm --prefix site ci
npm run docs:dev      # live preview
npm run docs:build    # production build into site/dist
```

The build fails on a broken internal link or a missing image, so run it before you push.

## Add or change a page

- Pages live in `site/src/content/docs/`, one folder per sidebar group: `getting-started`, `guides`, `reference`, `contributing`.
- Each page's frontmatter sets its `title`, `description` and `sidebar.order`.
- Link to other pages with the full path, including the site's base: `/acore-quest-creator/guides/quest-map/`.
- Write for quest authors: name things the way the app does, in author terms. Table names belong on the [database tables](/acore-quest-creator/reference/database-tables/) page only.

## Screenshots

Screenshots are taken from the real app by a Playwright script, `tests/docs/screenshots.docs.ts`. It connects with your `.env` world database, builds a demo quest from scratch and saves each screen as a 1440×900 PNG in `site/src/assets/screenshots/`.

```sh
npm run docs:screenshots
```

It needs `.env` with a world database, the server data folder and the game client folder, and fails before launching the app if any is missing. It swaps your user name and folders for generic ones in the login and Settings images.

Regenerate the screenshots after a change to a screen the docs show, and before a release. Check each image before committing. Pages use them with Markdown image syntax, such as `![The quest map](../../../assets/screenshots/quest-map.png)`.

## Publishing

The **Docs** workflow builds the site on every push to `main` that touches `site/`, and deploys it to GitHub Pages once the repository is public.
