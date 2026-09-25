---
title: Testing
description: Unit, integration and end-to-end tests for ACORE Quest Creator, and what each needs.
sidebar:
  order: 3
---

| Command | What it runs | Needs |
| --- | --- | --- |
| `npm run typecheck` | TypeScript over main and renderer | nothing |
| `npm test` | Unit tests (Vitest): `tests/core`, `tests/main`, `tests/renderer` and more | the fork's base SQL |
| `npm run test:int` | Integration tests (`*.int.test.ts`) against a real world database | `ACQC_TEST_MYSQL_URL`, the fork's base SQL |
| `npm run test:e2e` | End-to-end tests (Playwright) that build and drive the app | `ACQC_TEST_MYSQL_URL`, the server data and game client folders |

The unit tests read table layouts from the Conquest of AzerothCore fork's base SQL (`data/sql/base/db_world`). They find it beside the server data folder you set in `.env` (`ACQC_WORLD_DB_DBC_DIR`), or at `ACQC_AC_SQL_DIR`. Tests read `.env` themselves, the way the app does; a variable already set in your shell wins.

Run `npm run typecheck` and `npm test` before every pull request.

## Integration and end-to-end tests

Both need a MySQL world database. Point them at it with:

```sh
ACQC_TEST_MYSQL_URL=mysql://user:password@127.0.0.1:3306/acore_world
```

They do not skip when it is missing; they fail, so a green run always means they ran.

- End-to-end tests that use the map read the server data and game client folders from `ACQC_WORLD_DB_DBC_DIR` and `ACQC_WORLD_DB_CLIENT_DIR`.
- A test that needs a folder you have not set fails and names the variable to set.
- End-to-end tests launch the app with a fresh `ACQC_USER_DATA` folder, so they never touch your own connection details or projects.

:::caution
Do not `source` your `.env` in a shell to set these: unquoted Windows paths lose their backslashes. Set `ACQC_TEST_MYSQL_URL` directly.
:::

## Writing tests

- Logic belongs in `src/core` and is tested there in plain Node.
- Interface behaviour is tested with Testing Library in `tests/renderer` (jsdom).
- End-to-end tests drive the app through roles and labels, the way a person would: `getByRole('button', { name: 'New quest' })`, not CSS selectors.
