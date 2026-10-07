---
title: Introduction
description: What Azeroth World Editor is for, who it is for and what you need to use it.
sidebar:
  order: 1
---

Azeroth World Editor (AWE) is a desktop world editor for an [AzerothCore](https://www.azerothcore.org/) server, including the Conquest of AzerothCore fork. It started as a quest creator and now covers the world around the quests: walk it in 3D, and place, move and script the NPCs and objects in it. You describe a quest the way a player would see it: who offers it, what they ask for, what an NPC says, where a chest stands and how a boss fights. The app turns that into the SQL your server needs.

You never edit database tables by hand, and the app never writes to your live world database. Your work becomes an SQL patch file, or you apply it to a separate dev database to try it out.

## Who it is for

- **Quest authors** rebuilding or restoring quests for a server, especially those whose work stalls on scripting and NPC set-up.
- **World builders** placing, moving and grouping NPCs and objects in the game world.
- **Server admins** who want quest and world changes as reviewable SQL patches.

## What you need

- **Your world database.** The app reads quests, NPCs, items and spells from your server's world database over MySQL (usually called `acore_world`). A read-only user is enough.
- **The server data folder** (optional). The worldserver's data folder, the one holding `dbc/`. With it the app shows values the server reads from its DBC files, such as how much XP each reward tier gives, lets you search spells and models by name, and can snap spawns to the ground.
- **Your game client folder** (optional, but the app is built around it). The folder with `Wow.exe`. With it the app draws [the World](/azeroth-world-editor/guides/the-world/) in 3D, where it opens.
- **A dev database** (optional). A separate world database on a test server, for **Apply to dev DB**.

## How a session goes

1. [Connect](/azeroth-world-editor/getting-started/connect/) to your world database. The app opens on [the World](/azeroth-world-editor/guides/the-world/).
2. Find the place you are working on, and select, move, place and group its NPCs and objects; fix or draw the paths they walk. Right-click anything for what you can do with it.
3. For a quest, start it from an NPC in the World or in the **Quests** dock, and fill in its parts: givers, objectives, dialogue, rewards, scripts. Opening a quest takes the World to its NPCs.
4. Review the changes in **Project changes**, then export an SQL patch or apply it to your dev database, and [test it in game](/azeroth-world-editor/guides/test-in-game/).

Ready? [Install the app](/azeroth-world-editor/getting-started/install/), then walk through [your first quest](/azeroth-world-editor/getting-started/first-quest/).
