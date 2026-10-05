---
title: Spawn groups
description: Make only some of a set of spawns appear at a time, with a chance for each, as the Time-Lost Proto-Drake does.
sidebar:
  order: 1.6
---

A **spawn group** is a set of spawns of which only some are up at a time. When the one that is up dies and its respawn time passes, the server rolls again and any member of the group can be the next. Rare spawns, rotating chests and herb patches that move around all work this way.

Groups are made in [the World](/acore-quest-creator/guides/the-world/), from the spawns you select.

## How a group works

- **Up at once** is how many members are up at the same time. Most groups use 1.
- Each member has a **Chance**, either a **Percentage** or an **Equal share**. An equal share is whatever is left after the percentages, divided evenly among the equal-share members.
- A member can be an NPC spawn, an object spawn, or another group. A group of groups is how you build a choice between several things that each have their own choice inside.
- The respawn time of each spawn decides how soon the next roll happens. See **Respawn time…** in [the right-click menu](/acore-quest-creator/guides/the-world/#place-copy-and-paste).

## Make a group

1. In the World, select the spawns: **Shift**-click them, or drag a box in Select mode.
2. Right-click one and choose **Group these spawns…**.
3. Give the group a **Name**, set **Up at once**, and set each member's **Chance**.
4. **Add a group…** adds another group on the same map as a member.
5. **Save**.

If a spawn you chose is already in another group, the dialog offers **Move _name_ here**. A spawn can be in only one group.

Saving is one undo step, and the group is listed in **Project changes** as **Group changed**. It goes out with the project patch, and the revert patch takes it away again.

## Example: the Time-Lost Proto-Drake

The Time-Lost Proto-Drake flies one of four flight paths, and on each path it may be replaced by Vyragosa. Only one of the four is up at a time. Built from scratch it is a group of four path groups:

1. For each path, place the NPCs that walk it: a drake and Vyragosa. Give them the path.
2. Select the drake and Vyragosa of one path, and choose **Group these spawns…**. Name it for the path, set **Up at once** to 1, give the drake a **Percentage** of 10 and leave Vyragosa on **Equal share** (she gets the remaining 90). **Save**. Do this for the other three paths.
3. Select one spawn from any of the four path groups, or right-click the ground, and make one more group. Choose **Add a group…** four times to add the path groups. Name it, set **Up at once** to 1, and leave all four on **Equal share**. **Save**.
4. Set the respawn time of all the spawns to 45 minutes (a 2700-second respawn) with **Respawn time of _n_ spawns…**.

One path is up at a time, and on it, the drake 10% of the time and Vyragosa the rest. When the one that is up dies and its respawn time has passed, the server rolls again and can pick any path.

## What the server refuses

The group dialog lists the reasons a group cannot be saved, as you work, and **Save** stays off until there are none. These are the server's own rules:

- **Chances.** A percentage is 0 to 100. With no equal-share member, the percentages must add up to exactly 100. With at least one, the percentages must not go over 100, and the equal-share members split the rest.
- **One map.** Every member of a group, and every group inside it, must be on the same map.
- **One group per spawn.** A spawn can be in only one group.
- **Objects that can be pooled.** Only chests (herbs and mining veins are chests), usable objects and fishing schools. A door, a book or a decoration cannot be pooled.
- **No loops.** A group cannot hold itself, directly or through the groups inside it.
- **Members.** A group needs at least one. A member the database no longer has is shown as missing, and has to be removed first.

The server will not spawn a group that breaks these, so the app will not write one.

## See and change groups

- Select a pooled spawn and the other members of its group are ringed, with lines to each. A card in the view shows the group's name, how many are up at a time, and each member's chance. The same goes for groups the database already has.
- **Find…** has a **Spawn group** option: search groups by name, and **Go** takes the camera to it. Each line shows how many of the group's members are up at a time, and a group inside a group is listed indented under the group that holds it. Searching a name finds a group inside another too, shown under its mother.
- Right-click a pooled spawn and open **Spawn group ▸**: **Edit group…** opens the dialog, **Show group** rings its members, and **Remove from group** takes this spawn out. Removing a spawn you placed also takes it out of its group, and removing the last member of a group you made deletes the group.
- A group the database already has can be edited too. The project patch rewrites its rows and the revert patch writes the originals back.

:::note
Groups tied to a game event, and rotating daily or weekly quests, are not made here yet. Editing an existing group keeps any event link it has.
:::
