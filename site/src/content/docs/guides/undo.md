---
title: Undo and redo
description: Take back any change to your project, wherever you made it.
sidebar:
  order: 13
---

Every change you make to a project can be undone: a quest's title or objectives, its NPCs, objects, items and loot, its scripts and fights, a patrol on the quest map, quests added to or moved on the graph, the project's name, and everything you place, move, turn or reroute in the World.

## The keys

- **Ctrl+Z** undoes the last change, wherever you made it. If your last change was a quest's title and you're now in the World, Ctrl+Z puts the title back.
- **Ctrl+Y** (or **Ctrl+Shift+Z**) does it again.

Hold Ctrl+Z to keep going back one change at a time.

While you're typing in a text field, Ctrl+Z and Ctrl+Y undo your typing in that field, as in any other app. Click outside the field to undo changes to the project again.

## Undo, Redo and History

The **Undo** and **Redo** buttons in the bar at the top do the same as the keys. Hover over them to see which change each would take back or do again.

The small arrow beside them opens **History**: every change in this session, newest first, with the one you're at marked. Click any change to go back to just after it, or forward to it again. **Start of this session** goes back to before your first change. The change you last saved at is marked **Saved**; going back to it makes the project saved again.

## What was undone

Each undo or redo shows a short note at the bottom of the window, such as "Undid: Moved Stormwind Guard". **Show** takes you to it: the quest it was in, or the place in the World.

Sometimes a change can't be brought back, for example a spawn you placed whose ID the world database has since given to another spawn. The note says so, and the rest of the change still comes back.

## What it covers

- One step is one thing you did: typing a title is one step, dragging three NPCs together is one step, pasting a group is one step, and *Start a new quest from this NPC* is one step.
- While you draw a new path in the World, Ctrl+Z takes back its last point. The path becomes one step when you finish it.
- The history lasts until you close the project, open or create another one, or quit. Saving doesn't clear it.
- Undo doesn't reach outside the project: SQL files you exported and changes applied to your dev database stay as they are. Undo the change in the project, then export or apply again.
