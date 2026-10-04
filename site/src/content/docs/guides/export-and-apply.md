---
title: Exporting and applying
description: Review a quest's changes, export them as an SQL patch or apply them to a dev database.
sidebar:
  order: 12
---

Your work leaves the app as SQL. The quest's header has three buttons for it: **Changes**, **Export patch** and **Apply to dev DB**.

## Review the changes

**Changes** lists every database row the quest adds or changes, grouped by table. An existing quest you opened but did not edit says *No changes since this quest was loaded.*

![The Changes dialog, listing the new rows for a quest](../../../assets/screenshots/changes.png)

## Export a patch

**Export patch** writes the quest's changes to an `.sql` file and shows where it saved it. Files go to the **Export folder** set in [Settings](/acore-quest-creator/reference/settings/#folders), or to `Documents/ACORE Quest Creator/sql` when none is set. Run the file against your world database, or hand it to your server admin.

The app refuses to export a quest it cannot write back faithfully. The button is then disabled and says why: *Unsafe to export*. It also refuses while a module has an error, listing what to fix.

## Apply to a dev database

**Apply to dev DB** writes the changes straight into your dev database, after asking you to confirm. It is disabled until you add a dev database in [Settings](/acore-quest-creator/getting-started/connect/#dev-database-optional).

Then [test it in game](/acore-quest-creator/guides/test-in-game/).

## World changes

Changes made in [the World](/acore-quest-creator/guides/the-world/) to spawns that belong to no quest (moved or placed spawns, changed routes, new paths and wander) are not part of any quest's patch. Open **World changes** in the World's Layers card and choose **Export world patch**. It writes two files to the same export folder, numbered per day:

- `<date>_<nn>_world.sql`: the changes.
- `<date>_<nn>_world_revert.sql`: puts the database back as it was before them.

A spawn placed in the World is written with a new spawn ID, and the patch deletes that ID first so it can be run again. An NPC given a new path gets its own addon row, copied from its template's so it keeps its mount and auras.

:::caution
The dev database should be a copy on a test server. Never point it at your live world database.
:::
