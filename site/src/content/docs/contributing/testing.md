---
title: Testing
description: Unit, integration and end-to-end tests for ACORE Quest Creator, and what each needs.
sidebar:
  order: 3
---

| Command | What it runs | Needs |
| --- | --- | --- |
| `npm run typecheck` | TypeScript over main and renderer | nothing |
| `npm test` | Unit tests (Vitest): `tests/core`, `tests/main`, `tests/renderer` and more | nothing |
| `npm run test:int` | Integration tests (`*.int.test.ts`) against a real world database | `ACQC_TEST_MYSQL_URL`, `ACQC_AC_SQL_DIR` |
| `npm run test:e2e` | End-to-end tests (Playwright) that build and drive the app | `ACQC_TEST_MYSQL_URL` |

Run `npm run typecheck` and `npm test` before every pull request.

## Integration and end-to-end tests

Both need a MySQL world database. Point them at it with:

```sh
ACQC_TEST_MYSQL_URL=mysql://user:password@127.0.0.1:3306/acore_world
```

They do not skip when it is missing; they fail, so a green run always means they ran.

- Integration tests that read AzerothCore's base SQL also need `ACQC_AC_SQL_DIR`, the `data/sql` folder of your AzerothCore checkout.
- End-to-end tests that use the map read `ACQC_WORLD_DB_DBC_DIR` (the server's `dbc/` folder) and `ACQC_TEST_CLIENT_DIR` (the game client folder).
- End-to-end tests launch the app with a fresh `ACQC_USER_DATA` folder, so they never touch your own connection details or projects.

:::caution
Do not `source` your `.env` in a shell to set these: unquoted Windows paths lose their backslashes. Set `ACQC_TEST_MYSQL_URL` directly.
:::

## Writing tests

- Logic belongs in `src/core` and is tested there in plain Node.
- Interface behaviour is tested with Testing Library in `tests/renderer` (jsdom).
- End-to-end tests drive the app through roles and labels, the way a person would: `getByRole('button', { name: 'New quest' })`, not CSS selectors.
