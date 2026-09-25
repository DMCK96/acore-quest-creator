---
title: What gets written to the database
description: The world database tables each feature of ACORE Quest Creator writes, for server admins reviewing patches.
sidebar:
  order: 3
---

For server admins reviewing a patch: which world database tables each part of the app writes. The **Changes** dialog lists the exact rows for any quest.

The app only writes when you **Export patch** (to a file) or **Apply to dev DB** (to your dev database). It never writes to the world database you connect with.

| Feature | Tables |
| --- | --- |
| The quest, dialogue and rewards | `quest_template`, `quest_template_addon`, `quest_offer_reward`, `quest_request_items` |
| Quest givers and enders | `creature_queststarter`, `creature_questender`, `gameobject_queststarter`, `gameobject_questender`, and `npcflag` on `creature_template` so NPCs offer quests |
| Explore objectives | `areatrigger_involvedrelation` |
| Map marker | `quest_poi`, `quest_poi_points` |
| Seasonal and pooled quests | `game_event_creature_quest`, `game_event_gameobject_quest`, `pool_quest` |
| Requirements | `conditions` |
| New NPCs | `creature_template`, `creature_template_model`, `creature_equip_template` (weapons), `creature` (spawns) |
| New objects | `gameobject_template`, `gameobject` (spawns) |
| Readable objects | `page_text` |
| Loot | `creature_loot_template`, `gameobject_loot_template` |
| Quest scripting scenes | `smart_scripts`, `creature_text`, `gossip_menu`, `gossip_menu_option`, `npc_text`, `conditions`, `areatrigger`, `areatrigger_scripts`, `waypoints` (escort paths) |
| Combat wizard | `smart_scripts`, `creature_text` |
| Patrols | `creature_addon`, `waypoint_data`, and `smart_scripts` / `creature_text` for point actions |

## IDs for new rows

New quests, NPCs, objects and spawns get IDs in high ranges the app picks so they do not collide with existing rows; a new quest starts at `60000`. The app refuses to export when an ID it would write is already taken.

Scripts the app writes carry a comment naming the quest and scene, so they are easy to find in `smart_scripts`.
