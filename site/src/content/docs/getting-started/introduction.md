---
title: Introduction
description: What ACORE Quest Creator is for, who it is for and what you need to use it.
sidebar:
  order: 1
---

ACORE Quest Creator is a desktop app for building quests for an [AzerothCore](https://www.azerothcore.org/) server, including the Conquest of AzerothCore fork. You describe a quest the way a player would see it: who offers it, what they ask for, what an NPC says, where a chest stands and how a boss fights. The app turns that into the SQL your server needs.

You never edit database tables by hand, and the app never writes to your live world database. Your work becomes an SQL patch file, or you apply it to a separate dev database to try it out.

## Who it is for

- **Quest authors** rebuilding or restoring quests for a server, especially those whose work stalls on scripting and NPC set-up.
- **Server admins** who want quest changes as reviewable SQL patches.

## What you need

- **Your world database.** The app reads quests, NPCs, items and spells from your server's world database over MySQL (usually called `acore_world`). A read-only user is enough.
- **The server data folder** (optional). The worldserver's data folder, the one holding `dbc/`. With it the app shows values the server reads from its DBC files, such as how much XP each reward tier gives, lets you search spells and models by name, and can snap spawns to the ground.
- **Your game client folder** (optional). The folder with `Wow.exe`. With it the quest map shows the game's zone art and minimap.
- **A dev database** (optional). A separate world database on a test server, for **Apply to dev DB**.

## How a session goes

1. [Connect](/acore-quest-creator/getting-started/connect/) to your world database.
2. Lay out quests on the canvas: make new ones, or bring in existing chains to build on.
3. Open a quest and fill in its parts: givers, objectives, dialogue, rewards, scripts, NPCs and objects.
4. Place NPCs and objects on the map and draw their patrols.
5. Review the changes, then export an SQL patch or apply it to your dev database, and [test it in game](/acore-quest-creator/guides/test-in-game/).

Ready? [Install the app](/acore-quest-creator/getting-started/install/), then walk through [your first quest](/acore-quest-creator/getting-started/first-quest/).
