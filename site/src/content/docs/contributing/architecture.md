---
title: Architecture
description: How ACORE Quest Creator's code is laid out and how a quest travels from the editor to SQL.
sidebar:
  order: 2
---

ACORE Quest Creator is an [Electron](https://www.electronjs.org/) app written in TypeScript, with a React interface.

## Layout

```
src/
  core/       Pure logic: no Electron, no React. Quest model, schema, SQL, scripts, map maths.
  main/       Electron's main process: the IPC API, the project store, database connections, map tiles.
  preload/    The bridge that exposes the main process's API to the interface.
  renderer/   The React interface: views, modules, editors, the map.
  shared/     Types shared by main and renderer, such as the IPC contract.
drizzle/      Migrations for the local project store.
tests/        core, main, renderer, integration, e2e and docs tests.
site/         This documentation site.
```

`src/core` never imports Electron or React, so almost everything the app decides can be unit-tested in plain Node.

Inside `src/core`, each feature has its own folder: `scripts` (quest scripting scenes), `combat` (the combat wizard), `entities` (new NPCs and objects), `patrol`, `map`, `client` (reading the game client's MPQ archives and BLP images), `game` (server data such as DBC files, map heights and navmesh), `export`, `sql` and more.

## Processes

- The **main process** (`src/main`) owns everything with side effects: the MySQL connection to the world database (read-only) and optional dev database, the local project store (SQLite through Drizzle), the file system, the game client and server data folders, and the `acqc-map://` protocol that serves map tiles.
- The **renderer** (`src/renderer`) is the interface. It talks to the main process only through the API that `src/preload` exposes; state lives in [Zustand](https://zustand.docs.pmnd.rs/) stores in `src/renderer/state`.

## From the editor to SQL

1. **Load.** Opening an existing quest reads its rows from the world database and turns them into the app's quest model. A quest that would not read back exactly is marked unsafe to export.
2. **Edit.** Modules edit the quest model. Scenes, fights, new NPCs and patrols are kept in author terms (for example "when the quest is accepted, say this"), not as rows.
3. **Validate.** Each module reports warnings and errors, shown as badges.
4. **Compile.** Export turns the model into rows: the quest's own tables, plus scripts compiled from scenes, fights and patrol actions.
5. **Write.** The rows become an SQL patch file, or are applied to the dev database. The **Changes** dialog shows the same rows before you commit to either.

See [What gets written to the database](/acore-quest-creator/reference/database-tables/) for the tables involved.

## Interface conventions

- Creating and editing happen in **centred modals**. The side panel is only for previews (the quest map is the exception).
- Copy is written in **author terms**: quests, givers, NPCs, scenes. Table and column names appear only where an admin needs them, such as the Changes dialog.
