# Contributing to ACORE Quest Creator

Thanks for helping. This is the short version; the [contributor pages](https://dmck96.github.io/acore-quest-creator/contributing/) go into more depth.

## Prerequisites

- Node.js 24 and npm, and Git.
- A MySQL AzerothCore world database to connect to. The integration and end-to-end tests need one too.
- Build tools for native modules, used when `better-sqlite3` has no prebuilt binary for your platform (Visual Studio Build Tools, Xcode Command Line Tools, or `build-essential` and Python).

## Setup

```sh
npm ci
cp .env.example .env   # then fill in your world database
npm run dev
```

With a filled-in `.env`, the login screen is ready and you only choose **Connect**. The installed app ignores `.env`.

More: [Development setup](https://dmck96.github.io/acore-quest-creator/contributing/development-setup/)

## Native module rebuilds

`better-sqlite3` must be built for whichever runtime loads it. `npm test` rebuilds it for Node; `npm run dev`, `npm run build` and `npm run dist` rebuild it for Electron. If you run `npx vitest` or `npx playwright test` directly, run `npm run rebuild:node` or `npm run rebuild:electron` first.

## Project layout

| Path | What lives there |
| --- | --- |
| `src/core` | Pure logic with no Electron or React: quest model, schema, SQL, scripts, combat, map maths. |
| `src/main` | Electron's main process: the IPC API, the project store, database connections, map tiles. |
| `src/preload` | The bridge exposing the main process's API to the interface. |
| `src/renderer` | The React interface. |
| `src/shared` | Types shared by main and renderer. |
| `drizzle/` | Migrations for the local project store. |
| `tests/` | `core`, `main`, `renderer`, `integration`, `e2e` and `docs` tests. |
| `site/` | The documentation site. |

More: [Architecture](https://dmck96.github.io/acore-quest-creator/contributing/architecture/)

## Tests

| Command | Runs | Needs |
| --- | --- | --- |
| `npm run typecheck` | TypeScript | nothing |
| `npm test` | Unit tests (Vitest) | nothing |
| `npm run test:int` | Integration tests | `ACQC_TEST_MYSQL_URL`, `ACQC_AC_SQL_DIR` |
| `npm run test:e2e` | End-to-end tests (Playwright) | `ACQC_TEST_MYSQL_URL` |

`ACQC_TEST_MYSQL_URL` is `mysql://user:password@host:port/database`. Set it directly; do not `source` your `.env`, which mangles Windows paths.

More: [Testing](https://dmck96.github.io/acore-quest-creator/contributing/testing/)

## Conventions

- **Commits** follow [Conventional Commits](https://www.conventionalcommits.org/) with a scope: `feat(quest): …`, `fix(ui): …`, `docs(site): …`.
- **Logic goes in `src/core`** and is unit-tested there. Write the failing test first.
- **Creating and editing happen in centred modals**; the side panel is only for previews (the quest map is the exception).
- **Interface copy is written in author terms**: quests, givers, NPCs, scenes — not table and column names.
- **Comments explain why**, not what.

## Docs

The docs site is in `site/` (Astro Starlight). Run it with `npm --prefix site ci` then `npm run docs:dev`; `npm run docs:build` fails on broken links or missing images. `npm run docs:screenshots` regenerates the screenshots from the real app using your `.env`.

More: [Docs and screenshots](https://dmck96.github.io/acore-quest-creator/contributing/docs-and-screenshots/)

## Releases

1. `npm version X.Y.Z -m "chore(release): %s"` bumps `package.json` and `package-lock.json` together, commits and tags `vX.Y.Z`. Don't edit `version` by hand, or the lockfile falls behind.
2. `git push origin main vX.Y.Z`.
3. The Release workflow checks the tag matches, runs the tests, and builds unsigned installers for Windows, macOS and Linux into a draft release.
4. Edit the draft's notes on the Releases page and publish it.

More: [Releases](https://dmck96.github.io/acore-quest-creator/contributing/releases/)

## Pull requests

- One topic per pull request.
- `npm run typecheck` and `npm test` pass.
- Include screenshots for interface changes, and update the docs when behaviour changes.

## License

By contributing, you agree your contributions are licensed under [GPL-3.0-or-later](LICENSE).
