---
title: The World in 3D
description: Walk the game world in 3D, place and move NPCs and objects, draw their paths, and tie them to your quest from a right-click menu.
sidebar:
  order: 1.5
---

The **World** tab is the game world in 3D, drawn from your own game client. Walk it, place NPCs and objects that already exist, move them, draw the paths they walk, and tie them to the quest you have open. Changes to spawns that belong to no quest are kept as **world changes** and exported as a patch of their own.

![The World over Northshire Abbey, with Marshal McBride selected](../../../assets/screenshots/world.png)

The World needs the **game client folder**, set when you [connect](/acore-quest-creator/getting-started/connect/). Without it the tab says so and offers Settings.

## Find your way

- The first time a project opens here, a **Welcome** offers well-known places to start, **Find an NPC or object**, **Start a quest** and **Just look around**.
- The card in the top left names the area under the camera. **Teleport** lists named places, with a box to find a place or zone. **Find…** searches NPCs and objects by name or ID and lists every spawn of the one you pick, nearest first; **Go** takes the camera there and selects it. **Coordinates** takes a map and an X, Y and Z.
- The World opens where you left it.

To move the camera:

| Input | Does |
| --- | --- |
| Right-drag | Look around |
| Left-drag | Orbit round the point under the cursor (Camera mode) |
| Middle-drag | Pan |
| Wheel | Move forward and back |
| **W** / **S**, **A** / **D** | Fly forward and back, strafe |
| **Q** / **E** | Turn left and right |
| **Space** / **X** | Rise and sink |
| **Shift** | Faster |

Keys work once the view has been clicked. The **?** in the bottom right lists every control.

## What is shown

The **Layers** card turns parts of the world on and off: **Buildings**, **Trees & props**, **NPCs**, **Objects** and **Paths**. With buildings hidden, clicks land on the ground under them.

**Event** draws the world during one game event: its NPCs and objects appear, and those it takes away go. **No event** is the everyday world; **All events** shows every spawn the database has.

## Select and move

Click an NPC or object to select it. Its card shows what it is and where it stands. Selecting an NPC shows its route and wander circle.

The bar at the top switches between **Camera** and **Select** (**Tab** flips it). In Select mode a left-drag draws a box round what to select, **Shift**-click adds, **Ctrl**-click takes away, and **Alt**+drag orbits.

With something selected:

- **G** moves it and **R** turns it, with the handles on the selection. A moved spawn drops onto the server's floor where you let go.
- On a shown route, click a point to pick it, **Shift**-click (Alt-click in Select mode) to add one, and **Delete** to remove the picked points. A route keeps at least two points.
- **O** turns on **Falloff**: nearby route points follow a move, less the further they are. **[** and **]** change its radius.
- **Ctrl+Z** and **Ctrl+Y** undo and redo, one whole move or turn at a time.

When a route is walked by more than one spawn, the app asks before it changes it for all of them.

## The right-click menu

Right-click (without dragging) for a menu about what is under the cursor: a route point, an NPC or object, or the ground. An NPC or object you right-click is selected first. An item that cannot be used says why, such as *Copy something first*. The **ContextMenu** key and **Shift+F10** open it too.

![The right-click menu on the ground, with a quest open](../../../assets/screenshots/world-menu.png)

### Place, copy and paste

- **Place NPC here…** and **Place object here…**: pick an existing NPC or object, and one is put down where you right-clicked, facing you, on the server's floor. **Place…** in the Layers card places one with each click instead, until **Esc**.
- **Copy**, **Paste here** and **Duplicate** (also **Ctrl+C**, **Ctrl+V** and **Ctrl+D**): a copied group keeps its layout and facing. **Ctrl+V** pastes under the cursor, and Duplicate puts the copy beside the original. A paste copies what a spawn is and how it faces, not its path or wander.
- **Remove**: takes away a spawn you placed. Spawns already in the database are not deleted.
- **Copy coordinates**: puts `.go xyz` with the place's X, Y, Z and map on the clipboard, ready to paste in game.

Placing, pasting and removing are undone with **Ctrl+Z** like any other change.

### How an NPC moves

- **Start path here**: with one NPC selected that has no route, right-click the ground where its path should begin. Each click then adds the next point. **Enter** or **Esc** finishes, **Ctrl+Z** takes back the last point, and **Cancel path** puts everything back. A path needs at least two points.
- **Change wander distance…**: how far the NPC roams from where it stands, 0 to 100 yards. Its circle follows what you type.
- **Remove path**: the NPC stands still. A path the database already has is left in place for any other NPC that walks it.

These work for the NPCs of the database and for your quest's own.

### Your quest

With a quest open:

- **Spawn quest NPC here** lists the quest's own NPCs and objects, then the existing ones it names, and puts one where you right-clicked.
- On an NPC or object, **Quest giver**, **Quest ender** and **Kill objective** (**Use objective** for an object) show whether it already plays that part, and add or remove it. See [quest givers and enders](/acore-quest-creator/guides/givers-and-enders/).
- On an NPC, **Start a new quest from this NPC** makes a quest it gives and takes back. **Start the next quest in this chain** does the same and puts the new quest after the open one.
- **Show quest spawns** and **Show chain spawns** ring every spawn the quest (or its whole chain) uses and list them in the Find dialog by quest and part, so you can jump to any of them. **Hide quest spawns** takes the rings away.

The open quest's own NPCs and objects are drawn and edited in the World too, so a move or a path you give one is part of the quest.

## World changes

Changes to spawns that are not your quest's go to the project's **world changes**: spawns moved or turned, routes changed, spawns placed, and NPCs' movement. **World changes (_n_)** in the Layers card lists each with what it was before and after. **Revert** or **Remove** takes one back; a new path and the movement that walks it go back together.

![The World changes list: a placed guard, its new path and its movement](../../../assets/screenshots/world-changes.png)

**Export world patch** writes the changes and a patch that undoes them. See [exporting and applying](/acore-quest-creator/guides/export-and-apply/#world-changes).

:::note
A change shows as *Changed in the database since* when the world database no longer matches what it was when you first changed it. Check those before applying the patch.
:::
