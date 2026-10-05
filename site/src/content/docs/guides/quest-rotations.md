---
title: Quest rotations
description: Make daily or weekly quests take turns, with only some offered each reset.
sidebar:
  order: 1.7
---

A **quest rotation** is a set of daily or weekly quests of which only some are offered at a time. At each daily or weekly reset the server picks again, so players see different quests each day or week.

Rotations are made on the **Quests** graph, from the quests you select.

## Make a rotation

1. On the Quests graph, select the quests: **Ctrl**-click each, or **Shift**-drag a box round them.
2. In the **Quest tools**, choose **Rotate these quests…**. The **Quest rotation** dialog opens.
3. Give the rotation a **Name**, and choose **Daily** or **Weekly**.
4. Set **Offered each reset**: how many of the quests are offered at a time.
5. Use **Remove** to take a quest out, and **Add a quest…** to put another in.
6. **Save**.

The quests in a rotation must all be daily or all weekly. If one is not, the dialog offers **Make _title_ daily** (or **weekly**), and **Make them all daily** (or **weekly**) fixes every quest at once. Saving sets the quests' daily or weekly flag in the same step.

If a quest you chose is already in another rotation, the dialog offers **Move _title_ here**. A quest can be in only one rotation.

On the graph, each quest in a rotation is tagged **Daily rotation: _name_** or **Weekly rotation: _name_**. The same tag line shows in the open quest's Flags summary. To change a rotation, click its tag on any of its quests' cards on the graph; the **Quest rotation** dialog opens. Selecting quests and choosing **Rotate these quests…** always makes a new rotation. **Delete rotation** removes it; the quests stay, and keep their daily or weekly flag.

Saving is one undo step. The rotation is listed in **Project changes**, goes out with the project patch, and the revert patch takes it away again.

## What the server refuses

The dialog lists the reasons a rotation cannot be saved, and **Save** stays off until there are none:

- **All daily or all weekly.** A rotation cannot mix them.
- **Every quest needs a giver.** A quest nobody offers is never shown. See [quest givers and enders](/acore-quest-creator/guides/givers-and-enders/).
- **One rotation per quest.**
- **At least two quests.** A rotation of one is no rotation.
- **Not nested, and no events.** A rotation cannot sit inside a spawn group, and does not follow a game event: the server rotates quests at the daily and weekly reset, apart from events. Groups of spawns can follow events; see [Spawn groups](/acore-quest-creator/guides/spawn-groups/).
