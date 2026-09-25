---
title: Development setup
description: Get ACORE Quest Creator running from source.
sidebar:
  order: 1
---

## Prerequisites

- **Node.js 24** and npm.
- **Git**.
- A **MySQL AzerothCore world database** to connect to. The integration and end-to-end tests need one too.
- Build tools for native modules, used when `better-sqlite3` has no prebuilt binary for your platform: Visual Studio Build Tools on Windows, Xcode Command Line Tools on macOS, `build-essential` and Python on Linux.

## Get it running

```sh
git clone https://github.com/DMCK96/acore-quest-creator.git
cd acore-quest-creator
npm ci
cp .env.example .env   # then fill in your world database
npm run dev
```

`npm run dev` starts the app with hot reload. With a filled-in `.env`, the login screen is ready and you only choose **Connect**. See [Environment variables](/acore-quest-creator/reference/environment-variables/).

## Native module rebuilds

The app's project store uses `better-sqlite3`, a native module that must be built for whichever runtime loads it:

- `npm test` rebuilds it for **Node** (Vitest runs in Node).
- `npm run dev`, `npm run build` and `npm run dist` rebuild it for **Electron**.

Each script rebuilds before it runs, so switching between them just works, but it takes a few seconds. If you run tools directly (for example `npx vitest` or `npx playwright test`), run `npm run rebuild:node` or `npm run rebuild:electron` first.

## Useful scripts

| Script | What it does |
| --- | --- |
| `npm run dev` | Run the app from source with hot reload. |
| `npm run build` | Build the app into `out/`. |
| `npm run dist` | Build installers for your platform into `dist/`. |
| `npm run typecheck` | Type-check the main and renderer code. |
| `npm test` | Unit tests. |
| `npm run test:int` | Integration tests against a real world database. |
| `npm run test:e2e` | End-to-end tests that drive the built app. |
| `npm run docs:dev` | Run this docs site locally. |
| `npm run docs:screenshots` | Regenerate the docs screenshots. |
